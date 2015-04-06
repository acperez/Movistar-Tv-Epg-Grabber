var http = require("http"),
  fs = require('fs'),
  rmdir = require('rimraf'),
  path = require('path'),
  mustache = require("mustache"),
  loader = require('./epg_loader.js'),
  logger = require('../conf/logger.js');

var rootDir = path.dirname(process.mainModule.filename);

const DATA_PATH =               path.join(rootDir, 'data');
const DATA_HTML_PATH =          path.join(loader.dataPublicPath, 'html');
const TEMPLATE_PATH =           path.join(rootDir, 'templates', 'epg.template');

var log=logger.LOG;

function createHTML(files, template, callback) {
  var file = files.shift();
  if (!file) {
    callback(null);
    return;
  }

  file = file.toString();
  log.info('Create HTML file ' + file + '.html');

  var channels = loader.getChannels();

  var cell_height = 100;
  var cell_width = 100;
  var time_per_pixel = 5; // minutes
  var sample_rate = 20;   // minutes
  var timeline_columns = 24 * 60;
  var timeline_width = timeline_columns * time_per_pixel;
  var channels_height = channels.length * cell_height;

  // Generate timeline
  var timeline_content = '';
  var counter = 0;
  var cells = timeline_columns / sample_rate;

  for(var i = 0; i < cells; i++) {
    timeline_content += "<div style=\"display: flex;float:left; width: " + cell_width + "px; height: " + cell_height + "px; border:1px solid black;\"><span style=\"align-self: flex-end; margin-left: 5px; margin-bottom: 3px\">" + ("0" + (counter / 60 >> 0)).slice(-2) + ":" + ("0" + (counter % 60 >> 0)).slice(-2) + "</span></div>";
    counter += sample_rate;
  }

  // Generate channels
  var channels_content = '';
  for(var i = 0; i < channels.length; i++) {
    channels_content += "<img width=" + cell_width + " height=" + cell_height + " src=\"" + channels[i].logo + "\" style=\"display:block\"/>";
  }

  // Generate programs
  var programs_content = '';
  for(var i = 0; i < channels.length; i++) {

    var programs_data = [];
    try {
      programs_data = require(path.join(loader.dataEpgPath, file, channels[i].serviceName.toString()));
    } catch (e) {
      log.info(e);
    }

    if (!Array.isArray(programs_data)) {
      programs_data = [programs_data];
    }

    for(var x = 0; x < programs_data.length; x++) {
      var program = programs_data[x];
      var time = new Date(program.startTime);
      var offset = (time.getHours() * 60 + time.getMinutes()) * time_per_pixel;
      var duration = program.duration * time_per_pixel;

      programs_content += "<div style=\"float: left; width:" + duration + "px; height:" + cell_height + "px; border:1px solid black;\">" + program.title + ' - ' + x +  "</div>";
    }
  }

  // Create view object
  var view = {
    cell_height: cell_height,
    cell_width: cell_width,
    timeline_width: timeline_width,
    channels_height: channels_height,
    timeline_content: timeline_content,
    channels_content: channels_content,
    programs_content: programs_content
  };

  // Apply template & save
  var html = mustache.to_html(template, view);
  fs.writeFile(path.join(DATA_HTML_PATH, file + '.html'), html, function (err) {
    if (err) {
      callback('[HTML] Could not save html: ' + err);
    }

    createHTML(files, template, callback);
  });
}

function toDelete() {
  var file = parseInt(files.shift());
  if (!file) {
    log.info('HTML ready');
    return;
  }

  var colors = ["blue", "red"];
  var color = 0;

  var columns = 24 * 60;
  var column_size = 5;
  var sample_rate = 20; // minutes

  var width = columns * column_size;

  var rows = channels.length;
  var row_size = 80;

  var channels_width = 80;

  var total_width = width + channels_width;

  // Corner
  var corner = "<div style=\"position: fixed; top: 0; left: 0; width:" + channels_width + "px; height:" + row_size + "px; background-color:black; z-index: 3\"></div>"

  // Header
  var border = 1;
  var header_content = "";
  var counter = 0;
  var cells = columns / sample_rate;
  var cell_width = column_size * sample_rate - border - border;
  var cell_height = row_size - border - border;
  for(var x = 0; x < cells; x++) {
      header_content += "<div style=\"width:" + cell_width + "px; height:" + cell_height + "px; background-color:gray; border:1px solid black; float:left\"><div style=\"position: absolute; bottom: 0; margin-left: 5px; margin-bottom: 3px\">" + ("0" + (counter / 60 >> 0)).slice(-2) + ":" + ("0" + (counter % 60 >> 0)).slice(-2) + "</div></div>";
      counter += sample_rate;
  }

  var header = "<div id=\"header\" style=\"position: fixed; top: 0; left: " + channels_width + "px; width:" + width + "px; height: auto; z-index:2\">" + header_content + "</div>";

  // Channels & content
  var channels_content = "";
  var content_content = "";
  for(var x = 0; x < rows; x++) {
    channels_content += "<img width=" + channels_width + " height=" + row_size + " src=\"" + channels[x].logo + "\" style=\"display:block\"/>";

    var content_data = [];
    try {
      content_data = require(path.join(DATA_EPG_PATH, file.toString(), channels[x].serviceName.toString()));
    } catch (e) {
      log.info(e);
    }

    if (!Array.isArray(content_data)) {
      content_data = [content_data];
    }

    for(var i = 0; i < content_data.length; i++) {
      var program = content_data[i];
      var time = new Date(program.startTime);
      var offset = (time.getHours() * 60 + time.getMinutes()) * column_size;
      var duration = program.duration * column_size;

      content_content += "<div style=\"position: absolute; left: " + offset + "px; top: " + (x * row_size) + "px; width:" + duration + "px; height:" + row_size + "px; background-color:" + colors[color] + "\">" + program.title + ' - ' + i +  "</div>";
      color ^= 1;
    }

    color ^= 1;
  }

  var channels_div = "<div id=\"channels\" style=\"left: 0; top:" + row_size + "px; position: fixed; z-index: 1\">" + channels_content + "</div>";
  var content = "<div id=\"content\" style=\"left:" + channels_width + "px; top:" + row_size + "px; position: relative\">" + content_content + "</div>";

  // Script
  var script = "" +
    "window.onload = function () {" +
    "  var channels = document.getElementById('channels');" +
    "  var time = document.getElementById('header');" +
    "  window.onscroll = function (e) {" +
    "    channels.style.top = - window.pageYOffset + " + row_size + " + 'px';" +
    "    time.style.left = - window.pageXOffset + " + channels_width + " + 'px';" +
    "  }" +
    "}";

  var file_content = "<!DOCTYPE html><html><head><meta name=\"viewport\" content=\"width=device-width, user-scalable=no\"/><script type=\"text/javascript\">" + script + "</script></head><body style=\"width:" + total_width + "px; margin: 0; padding:0\">" + corner + header + channels_div +  content + "</div></body></html>";

  fs.writeFile(path.join(DATA_HTML_PATH, file.toString() + '.html'), file_content, function (err) {
    if (err) {
      log.error('[HTML] Could not save html: ' + err);
    }
    createHTML(files);
  });
}

function syncFiles(callback) {
  log.info('Sync HTML files');

  fs.readdir(loader.dataEpgPath, function (err, rawFiles) {
    if (err) {
      log.error('[Generator] Could not read epg data folder ' + loader.dataEpgPath + ' : ' + err);
      callback(null);
      return;
    }

    fs.mkdir(DATA_HTML_PATH, function(e) {
      if (e && e.code != 'EEXIST') { 
        log.error('[Generator] Could not create html folder ' + DATA_HTML_PATH + ' : ' + e);
        callback(null);
        return;
      }

      fs.readdir(DATA_HTML_PATH, function (err, htmlFiles) {
        if (err) { 
          log.error('[Generator] Could not read html data folder ' + DATA_HTML_PATH + ' : ' + err);
          callback(null);
          return;
        }

        var files = [];
        var syncFile = function() {
          var file = parseInt(rawFiles.shift());
          if (!file) {
            // Delete outdated files
            htmlFiles.forEach(function (outdatedFile) {
              rmdir(path.join(DATA_HTML_PATH, outdatedFile), function(){});
            });

            callback(files);
            return;
          }

          var index = htmlFiles.indexOf(file);
          if (index < 0) {
            files.push(file);
          } else {
            htmlFiles.splice(index, 1);
          }

          syncFile();
        }

        syncFile();
      });
    });
  });
}

function generateEPG() {
  log.info('Generatte HTML files from template');
  syncFiles(function (files) {
    if (files) {

      // Load template
      fs.readFile(TEMPLATE_PATH, 'utf8', function (err, template) {
        if (err) {
          log.error('Error loading template ' + TEMPLATE_PATH + ': ' + err);
          return;
        }

        createHTML(files, template, function(error) {
          if(!error) {
            log.info('HTML files ready');
          } else {
            log.error(error);
          }
        });
      });
    }
  });
}

module.exports.generateEPG = generateEPG;
