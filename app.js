var express = require('express'),
  log4js = require('log4js'),
  cronJob = require('cron').CronJob,
  fs = require('fs'),
  path = require('path'),
  conf = require('./conf/config'),
  logger = require('./conf/logger.js'),
  loader = require('./lib/epg_loader');
  vlc = require('bindings')('vlc.node');

var app = express();

// Create player
var player = new vlc.Player();

// Configure logger
var log=logger.LOG;
app.use(log4js.connectLogger(log, { level: 'auto' }));

// Set static folder
app.use(express.static(loader.dataPublicPath));

var channels = {};

app.get('/setchannel/:number', function(req, res) {
  var number = req.params.number;
  var channel = channels[number];
  if (!channel) {
    res.sendStatus(404);
    return;
  }

  res.sendStatus(200);

  player.playStream(channel.url);
  loader.setLastChannel(number);
});

function initPlayer() {
  var channel = loader.getLastChannel();

  if (channels[channel]) {
    player.playStream(channels[channel].url);
  }
}

// Start server
app.listen(conf.port, function() {
  log.info('Server running on http://localhost:' + conf.port);

  // Check config, channels subscription and update epg
  loader.start();
  loader.addListener('channels-ready', function(channelList) {
    channels = channelList;
    initPlayer();
  });

  // Init cron
  new cronJob(conf.refresh_pattern, loader.updateEPG, null, true);
});

module.exports = app;
