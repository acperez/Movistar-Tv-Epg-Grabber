var http = require("http"),
  qs = require('querystring'),
  fs = require('fs'),
  util = require('util'),
  xml2json = require('xml2json'),
  entities = require('entities'),
  rmdir = require('rimraf'),
  dgram = require('dgram'),
  path = require('path'),
  generator = require('./epg_generator.js'),
  logger = require('../conf/logger.js');

const HEADER_BYTES = 12;
const FOOTER_BYTES = 4;
const CRC_BYTES = 4;

const DEMARCATION_PAYLOAD_ID              = 1;
const CHANNELS_DESCRIPTION_PAYLOAD_ID     = 2;
const CHANNELS_SUBSCRIPTION_PAYLOAD_ID    = 5;
const CHANNELS_EPG_DESCRIPTION_PAYLOAD_ID = 6;
const SEGMENT_ID                          = 0;

const DEMARCATION_ID              = packIDs(DEMARCATION_PAYLOAD_ID, SEGMENT_ID);
const CHANNELS_DESCRIPTION_ID     = packIDs(CHANNELS_DESCRIPTION_PAYLOAD_ID, SEGMENT_ID);
const CHANNELS_SUBSCRIPTION_ID    = packIDs(CHANNELS_SUBSCRIPTION_PAYLOAD_ID, SEGMENT_ID);
const CHANNELS_EPG_DESCRIPTION_ID = packIDs(CHANNELS_EPG_DESCRIPTION_PAYLOAD_ID, SEGMENT_ID);

const LOC_PROVIDER_ID = [ DEMARCATION_ID ];
const SUBSCRIPTION_ID = [ CHANNELS_DESCRIPTION_ID,
                          CHANNELS_SUBSCRIPTION_ID,
                          CHANNELS_EPG_DESCRIPTION_ID ];

const EPG_SERVER = '239.0.2.13';
const EPG_PORT = 3937;

const METADATA_SERVER = '172.26.22.23';
const METADATA_PORT = 2001;
const METADATA_BASE_URL = 'http://' + METADATA_SERVER + ':' + METADATA_PORT;

const CLIENT_URL =           METADATA_BASE_URL + '/appserver/mvtv.do?action=getClientProfile';
const PLATFORM_URL =         METADATA_BASE_URL + '/appserver/mvtv.do?action=getPlatformProfile';
const PROGRAM_METADATA_URL = METADATA_BASE_URL + '/appserver/mvtv.do?action=getEpgInfo&extInfoID=%s&tvWholesaler=1'

const LOGO_URL =             METADATA_BASE_URL + '/appclient/incoming/epg/';
const AGE_RATING_URL =       METADATA_BASE_URL + '/appclient/res/external_res/40x40/agerating_%s.png';
const COVER_URL =            METADATA_BASE_URL + '/appclient/incoming/covers/programmeImages/landscape/big/%s/%s.jpg'

var rootDir = path.dirname(process.mainModule.filename);

const DATA_PATH =               path.join(rootDir, 'data');
const DATA_PUBLIC_PATH =        path.join(DATA_PATH, 'public');
const DATA_EPG_PATH =           path.join(DATA_PUBLIC_PATH, 'epg');

const DATA_CHANNELS_PATH =      path.join(DATA_PUBLIC_PATH, 'channels.json');
const DATA_CHANNELS_M3U_PATH =  path.join(DATA_PUBLIC_PATH, 'channels.m3u');
const DATA_CHANNELS_META_PATH = path.join(DATA_PATH, 'channels_metadata.json');
const DATA_CONFIG_PATH =        path.join(DATA_PATH, 'config.json');

const DAY_ID_MAP = [0, 1, -1, 2, 3, -2, -3];
// 0 -> today                          1 -> tomorrow                    2 -> yesterday
// 3 -> day after tomorrow             4 -> day after after tomorrow    5 -> day before yesterday
// 6 -> day before before yesterday

var log=logger.LOG;

var config = {};
var channels = [];
var channelMetadatas = {};

function getProgramDetails(data, callback, retries) {
  var url = util.format(PROGRAM_METADATA_URL, data.id);
  var request = http.get(url, function(response) {
    var payload = '';

    response.on('data', function(chunk) {
      payload += chunk;
    });

    response.on('end', function() {
      var response = JSON.parse(payload.toString('utf-8')).resultData;
      data.genre = response.genre;
      data.subgenre = response.subgenre;
      data.countries = response.countries ? response.countries.join(', ') : null;
      data.date = response.productionDate ? response.productionDate.join(', ') : null;
      data.description = response.description;
      data.directors = response.directors ? response.directors.join(', ') : null;
      data.actors = response.mainActors ? response.mainActors.join(', ') : null;
      data.originalTitle = response.originalTitle ? response.originalTitle.join(', ') : null;
      callback(data);
    });
  });

  request.on('error', function(e) {
    if (retries > 0) {
      retries--;
      getProgramDetails(data, callback, retries);
      return;
    }

    log.error('[EPG] Error getting program details at ' + epgMetadataHttpOptions + ' : ' + e.message);
    callback(data);
  });
}

function parseProgram(program, callback) {
  var id = program.Program.crid;
  id = id.substring(id.lastIndexOf('/') + 1);
  var parentalGuidance = program.InstanceDescription.ParentalGuidance['mpeg7:ParentalRating'].href;
    
  var hours = /\d*(?=H)/.exec(program.EventDuration);
  var minutes = /\d*(?=M)/.exec(program.EventDuration);
  hours = hours ? parseInt(hours[0]) : 0;
  minutes = minutes ? parseInt(minutes[0]) : 0;
  var duration = hours * 60 + minutes;

  var data = {
    id: id,
    title: entities.decodeHTML(program.InstanceDescription.Title),
    genre: program.InstanceDescription.Genre.Name,
    startTime: Date.parse(program.EventStartTime),
    duration: duration,
    ageRating: util.format(AGE_RATING_URL, parentalGuidance.substring(parentalGuidance.lastIndexOf(':') + 1)),
    cover: util.format(COVER_URL, id.substring(0,4), id)
  };

  getProgramDetails(data, callback, 3);
}

function searchChannelBySegmentId(segmentId) {
  for (var i in channelMetadatas) {
    var metadata = channelMetadatas[i];
    if (metadata.segmentId == segmentId) {
      return metadata.id & 0x000fff;
    }
  }
}

function saveChannelEPG(segmentId, timestamp, epg, data, channels, fullEpg, callback) {
  var channel = searchChannelBySegmentId(segmentId);
  fs.writeFile(path.join(DATA_EPG_PATH, timestamp.toString(), channel.toString() + '.json'), JSON.stringify(epg), function (err) {
    if (err) {
      log.error('[EPG] Could not save epg for channel ' + channel + ': ' + err);
    }

    fullEpg.push({ id: channel,
                   epg: epg });

    parseEPG(timestamp, data, channels, fullEpg, callback);
  });
}

function parseEPG(timestamp, data, channels, fullEpg, callback) {
  var segmentId = channels.shift();
  if (!segmentId) {
    log.info('Loaded EPG for ' + timestamp);
    callback();
    return;
  }

  var channel = data[segmentId];
  delete data[segmentId];

  channel = channel.replace(/\n/g," ");

  var json = xml2json.toJson(channel);
  var schedule = JSON.parse(json).TVAMain.ProgramDescription.ProgramLocationTable.Schedule;

  var epg = [];

  var programs = schedule.ScheduleEvent;
  if (!programs) {
    programs = [];
  }

  if (!Array.isArray(programs)) {
    programs = [programs];
  }

  var pendingItems = programs.length;
  if (pendingItems == 0) {
    saveChannelEPG(segmentId, timestamp, epg, data, channels, fullEpg, callback);
    return;
  }

  var index = 0;
  var parser = function () {
    program = programs.shift();
    if (program) {
      parseProgram(program, function(index, result) {
        epg[index] = result;
        pendingItems--;
        if (pendingItems < 1) {
          saveChannelEPG(segmentId, timestamp, epg, data, channels, fullEpg, callback);
        }
      }.bind(null, index));

      index++;
      parser();
    }
  }

  parser();
}

function getEPG(timestamp, days) {
  // The multicast addresses where the EPG is being transmitted are provided through
  // the services detailed in the xml with payloadID = 6 (downloaded in
  // getSubrcribedChannels method). As downloading the file in a multicast environment
  // is slow and these addresses don't change, hardcoded addresses are used.
  //
  // The xml provides a list of sources 'EPG_x.imagenio.es' where 'x' is an integer
  // from 0 to 7, for each source there is a multicast group 239.0.2.13x and the
  // default dvbsrvdesc port 3937. Values from 0 to 7 represent the day of the epg:
  //   0 -> today
  //   1 -> tomorrow
  //   2 -> yesterday
  //   3 -> day after tomorrow
  //   4 -> day after after tomorrow
  //   5 -> day before yesterday
  //   6 -> day before before yesterday
  //
  // That xml also provides the payloadId, segmentId and segmentVersion of the
  // channels in each source, however is not necessary to parse it because the
  // segmentId is the same as the serviceName of the subscribed channels.
  var day = days.shift();
  if (day == undefined) {
    log.info('EPG updated');
    generator.generateEPG();
    return;
  }

  var mcast_epg_group = EPG_SERVER + day;
  var epgTimestamp = getNextTimestamp(timestamp, day);

  var segmentIds = [];
  for (var i in channelMetadatas) {
    segmentIds.push(channelMetadatas[i].segmentId);
  };

  log.debug('[EPG] Grab epg data for ' + epgTimestamp + ' from multicast');
  getMulticastData(mcast_epg_group, EPG_PORT, segmentIds, function(data) {
    fs.mkdir(path.join(DATA_EPG_PATH, epgTimestamp.toString()), function(e) {

    log.debug('[EPG] Parse epg data');
      var fullEpg = [];
      parseEPG(epgTimestamp, data, Object.keys(data), fullEpg, function() {





        // TEST
        var aux = [];
        fullEpg.forEach(function(channel) {
          var algo = [];
          channel.epg.forEach(function(program){
            var title = program.title;
            var startTime = program.startTime;
            var duration = program.duration;
            delete program.title;
            delete program.startTime;
            delete program.duration;
            var metadata = JSON.stringify(program);
            algo.push({title: title,
                       startTime: startTime,
                       duration: duration,
                       metadata: metadata });
          });

          aux.push({ id: channel.id,
                     epg: algo });
        });
        fs.writeFile(path.join(DATA_EPG_PATH, timestamp.toString(), 'epg.json'), JSON.stringify(aux), function (err) {






        //fs.writeFile(path.join(DATA_EPG_PATH, timestamp.toString(), 'epg.json'), JSON.stringify(fullEpg), function (err) {
          if (err) {
            log.error('[EPG] Could not save full epg: ' + err);
          }

          getEPG(timestamp, days);
        });
      });
    });
  });
}

function getCurrentTimestamp() {
  var now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

function getNextTimestamp(timestamp, dayId) {
  if (dayId < 0 || dayId > 6) {
    throw('Invalid day ID');
  }

  var days = DAY_ID_MAP[dayId];

  return timestamp + days * 24 * 60 * 60 * 1000;
}

function updateEPG() {
  log.info('Update EPG data');
  var timestamp = getCurrentTimestamp();
  var firstDay = getNextTimestamp(timestamp, 6);

  fs.mkdir(DATA_EPG_PATH, function(e) {
    fs.readdir(DATA_EPG_PATH, function (err, files) {

      var filesReady = [];
      var syncFile = function() {
        var file = parseInt(files.shift());
        if (!file) {
          // Calculate the days to be requested
          var days = [];
          for (var i = 0; i < 7; i++) {
            if (filesReady.indexOf(getNextTimestamp(timestamp, i)) < 0) {
              days.push(i);
            }
          }

          getEPG(timestamp, days);
          return;
        }

        if (file < firstDay) {
          rmdir(path.join(DATA_EPG_PATH, file.toString()), syncFile);
          return;
        }

        filesReady.push(file);
        syncFile();
      }

      syncFile();
    });
  });
}

function createM3uList() {
  var list = '#EXTM3U\n';

  channels.forEach(function (channel) {
    list += "#EXTINF:-1 tvg-id=\"" + channel.number + "\" tvg-name=\"" + channel.name +
            "\" tvg-logo=\"" + channel.logo + "\" group-title=\"" + channel.genre +
            "\"," + channel.name + "\nrtp://@" + channel.address + ":" + channel.port + "\n";
  });

  fs.writeFile(DATA_CHANNELS_M3U_PATH, list, function (err) {
    if (err) log.error('[Channels] Could not save channels m3u list: ' + err);
    updateEPG();
  });
}

function parseSubscribedChannels(xml) {
  // Parse channels available in user subscription
  log.debug('[Channels] Parse subscribed channels');

  var json = xml2json.toJson(xml[CHANNELS_SUBSCRIPTION_ID]);
  var packages = JSON.parse(json).ServiceDiscovery.PackageDiscovery.Package;

  var tvPackages = JSON.parse(JSON.stringify(config.tvPackages));

  for (var i = 0; i < packages.length; i++) {
    var index = tvPackages.indexOf(packages[i].PackageName['$t']);
    if (index >= 0) {
      var services = packages[i].Service;
      services.forEach(function (service){
        channelMetadatas[service.TextualID.ServiceName] = { id: null,
                                                            segmentId: null,
                                                            number: service.LogicalChannelNumber };
      });

      tvPackages.splice(index, 1);
      if (tvPackages.length <= 0) {
        break;
      }
    }
  }

  // Parse channels metadata
  log.debug('[Channels] Parse channels metadata');

  var channelsXml = xml[CHANNELS_DESCRIPTION_ID];
  channelsXml = channelsXml.replace(/\n/g," ");
  json = xml2json.toJson(channelsXml);
  var channelsData = JSON.parse(json).ServiceDiscovery.BroadcastDiscovery.ServiceList.SingleService;

  channelsData.forEach(function (channel) {
    if (channel.TextualIdentifier.ServiceName in channelMetadatas) {
      var metadata = channelMetadatas[channel.TextualIdentifier.ServiceName];

      var data = {
        serviceName: channel.TextualIdentifier.ServiceName,
        number: metadata.number,
        serviceType: channel.SI.ServiceType,
        serviceInfo: channel.SI.ServiceInfo,
        name: channel.SI.Name['$t'],
        shortName: channel.SI.ShortName['$t'],
        description: channel.SI.Description['$t'],
        genre: channel.SI.Genre['urn:Name'],
        logo: LOGO_URL + channel.TextualIdentifier.logoURI,
        address: channel.ServiceLocation.IPMulticastAddress.Address,
        port: channel.ServiceLocation.IPMulticastAddress.Port
      };

      // Movistar sets msb 4 bits to 0001
      var segmentId = parseInt(data.serviceName);// + 0x1000;
      segmentId = packIDs(0xf1, segmentId);

      metadata.id = segmentId;
      metadata.segmentId = segmentId;

      if (channel.SI.ReplacementService) {
        data.replacementService = channel.SI.ReplacementService.TextualIdentifier.ServiceName;
        segmentId = parseInt(data.replacementService);// + 0x1000;
        segmentId = packIDs(0xf1, segmentId);
        metadata.segmentId = segmentId;
      }

      channels.push(data);
    }
  });

  channels.sort(function(a, b) {
    return a.number - b.number;
  });

  log.info('Subscribed channels retrieved successfully');

  fs.writeFile(DATA_CHANNELS_PATH, JSON.stringify(channels), function (err) {
    if (err) log.error('[Channels] Could not save channels: ' + err);

    fs.writeFile(DATA_CHANNELS_META_PATH, JSON.stringify(channelMetadatas), function (err) {
      if (err) log.error('[Channels] Could not save channels metadata: ' + err);

      createM3uList();
    });
  });
}

function getSubscribedChannels() {
  log.debug('[Channels] Grab channels data from multicast');
  getMulticastData(config.local_mcast_group, config.local_mcast_port, SUBSCRIPTION_ID, parseSubscribedChannels);
}

function parseLocationProvider(providersXml) {
  log.debug('[Config] Parse location provider');

  var json = xml2json.toJson(providersXml[DEMARCATION_ID]);
  var providers = JSON.parse(json).ServiceDiscovery.ServiceProviderDiscovery.ServiceProvider;
  for (var i = 0; i < providers.length; i++) {
    if (providers[i].DomainName === 'DEM_' + config.demarcation + '.imagenio.es') {
      config.local_mcast_group = providers[i].Offering.Push.Address;
      config.local_mcast_port = providers[i].Offering.Push.Port;

      log.info('Configuration retrieved successfully');

      fs.writeFile(DATA_CONFIG_PATH, JSON.stringify(config), function (err) {
        if (err) log.error('[Config] Could not save config: ' + err);
      });

      log.info('Subscribed channels not found, going to grab it from Movistar server');
      getSubscribedChannels();
      return;
    }
  }

  log.error('Your demarcation is not available');
}

function packIDs(payloadId, segmentId) {
  if (payloadId > 0xff || segmentId > 0x0fff)
    throw ('Invalid payloadId or segmentId');

  return (payloadId << 16) + segmentId;
}

function getMulticastData(mcast_group, mcast_port, payloadIDs, callback) {
  // parse chunks according to the specification of DVBSTP. See the end of the file
  var socket = dgram.createSocket('udp4');

  var doClose = function (message, remote) {
    socket.dropMembership(mcast_group);
    socket.close();

    log.debug('[DVBSTP client] Multicast stream processed and closed');

    callback(payload);
  }

  var counter = 0;

  var doRun = function (message, remote) {
    counter++;

    var buffer = new Buffer(message);
    var crc_bytes = 0;
    var id = (buffer[4] << 16) + ((buffer[5] & 0x0f) << 8) + buffer[6];

    if (buffer[0] == 1) {
      // Last section
      crc_bytes = CRC_BYTES;
      if (id == firstId) {
        // Last segment
        socket.on('message', doClose);
        socket.removeListener('message', doRun);
      }
    }

    if (!(id in payload)) {
      return;
    }

    // Drop header
    payload[id] += buffer.toString('utf8', HEADER_BYTES, buffer.length - crc_bytes);
  };

  var doSync = function (message, remote) {
    var buffer = new Buffer(message);
    if (buffer[0] == 0) {
      return;
    }

    log.debug('[DVBSTP client] Sync with multicast stream done, start reading stream');

    firstId = (buffer[4] << 16) + ((buffer[5] & 0x0f) << 8) + buffer[6];
    socket.on('message', doRun);
    socket.removeListener('message', doSync);
  };

  var payload = {};
  payloadIDs.forEach(function(id) {
    payload[id] = '';
  });

  socket.on('message', doSync);

  log.debug('[DVBSTP client] Bind socket to multicast ' + mcast_group + ':' + mcast_port);
  log.debug('[DVBSTP client] Packet IDs to grab: ' + payloadIDs);
  socket.bind(mcast_port, function() {
    socket.addMembership(mcast_group);
  });
} 

function getConfig() {
  log.debug('[Config] Request client profile - ' + CLIENT_URL);

  var request = http.get(CLIENT_URL, function(response) {
    var data = '';
    response.on('data', function(chunk) {
      data += chunk;
    });

    response.on('end', function() {
      data = JSON.parse(data);
      config.demarcation = data.resultData.demarcation;
      config.tvPackages = data.resultData.tvPackages.split("|");

      log.debug('[Config] Request platform profile - ' + PLATFORM_URL);

      var request = http.get(PLATFORM_URL, function(response) {
        var data = '';
        response.on('data', function(chunk) {
          data += chunk;
        });

        response.on('end', function() {
          data = JSON.parse(data);
          var entryPoint = data.resultData.dvbConfig.dvbEntryPoint.split(':');
          config.mcast_group = entryPoint[0];
          config.mcast_port = entryPoint[1];

          log.debug('[Config] Grab demarcation config from multicast');
          getMulticastData(config.mcast_group, config.mcast_port, LOC_PROVIDER_ID, parseLocationProvider);
        });
      });

      request.on('error', function(e) {
        log.error('[Config] Error getting the platform profile: ' + e.message);
      });
    });
  });

  request.on('error', function(e) {
    log.error('[Config] Error getting the client profile: ' + e.message);
  });
}

function initFileSystem(callback) {
  fs.mkdir(DATA_PATH, function(e) {
    fs.mkdir(DATA_PUBLIC_PATH, function(e) {
      callback();
    });
  });
}

function start() {
  initFileSystem(function() {
    // Load config
    try {
      config = require(DATA_CONFIG_PATH);
    } catch (e) {
      log.info('No configuration available, going to grab it from Movistar server');
      getConfig();
      return;
    }

    log.info('Configuration loaded successfully');

    // Load channels data
    try {
      channels = require(DATA_CHANNELS_PATH);
      channelMetadatas = require(DATA_CHANNELS_META_PATH);
    } catch (e) {
      log.info('No channels found, going to grab it from Movistar server');
      getSubscribedChannels();
      return;
    } 

    // Load channels m3U list and update epg
    fs.exists(DATA_CHANNELS_M3U_PATH, function(exists) {
      if (!exists) {
        createM3uList()
      } else {
         log.info('Channels data loaded successfully');

         updateEPG();
      }
    });
  });
}

function getChannels() {
  return channels;
}

module.exports.start = start;
module.exports.updateEPG = updateEPG;
module.exports.dataPublicPath = DATA_PUBLIC_PATH;
module.exports.dataEpgPath = DATA_EPG_PATH;
module.exports.getChannels = getChannels;

/*---------------------------------------------------------------------------
 *
 * DVBSTP Header
 *
 * +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
 * |Ver|Resrv|Enc|C|               Total_Segment_Size              |
 * +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
 * |   Payload ID  |           Segment ID          |   SegVersion  |
 * +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
 * |     Section_Number    |  Last Section Number  |Compr|P|HDR_LEN|
 * +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
 * |                      (Conditional) SP ID                      |
 * +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
 * |                    (Optional) Private Header                  |
 * +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
 * |                           Payload                             |
 * +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
 * |                             CRC                               |
 * +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
 *
 * Ver: protocol version -> always 00
 * Resrv: reserved -> always 000
 * Enc: encryptation -> 00 when no encripted
 * C: CRC flag -> 1 indicates that 32bit CRC is at the end of the packet
 *                CRC flag is 1 at the last packet of a segment. So byte
 *                formed by Ver+Resrv+Enc+C is used to sync, when its value
 *                is 1, the following packet is the first of a segment.
 *
 * Total_Segment_Size: field of 3bytes with the size (in bytes) of the
 *                     payload of a whole segment without headers and CRC.
 * 
 * Payload ID: Field of 1byte identifying the type of data of the payload.
 *
 * Segment ID: field of 2bytes identifying the type of segment.
 *
 * SegVersion: 1 byte. Segment version in module 256.
 * Section_Number: 12 bits identifying the number of section.
 * Last Section Number: 12 bits identifying the total number of segments.
 *
 * Compr: 3 bits indicating the compresion type of the payload, the whole
 *        segments have the same value.
 * P: Provider ID flag. If it is 1 then the field SP ID is present.
 * HDR_LEN: field of 4 bits with the length of the private header (in 32bits
 *          words). The private header is placed after the HDR_LEN or after
 *          the SP ID (if present). 0000 if there is no private header.
 *
 * SP ID: service provider ID. Ipv4 address of the provider (32bits).
 *
 * Private Header: private data. Multiple of 4bytes.
 *
 * Payload: data.
 *
 * CRC: 32bits.
 --------------------------------------------------------------------------*/
