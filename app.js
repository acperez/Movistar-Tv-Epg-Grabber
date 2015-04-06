var express = require("express"),
  app = express(),
  log4js = require('log4js'),
  cronJob = require('cron').CronJob,
  fs = require('fs'),
  path = require('path'),
  conf = require('./conf/config'),
  logger = require('./conf/logger.js'),
  loader = require('./lib/epg_loader');

// Configure logger
var log=logger.LOG;
app.use(log4js.connectLogger(log, { level: 'auto' }));

// Set static folder
app.use(express.static(loader.dataPublicPath));

// Start server
app.listen(conf.port, function() {
  log.info('Server running on http://localhost:' + conf.port);

  // Check config, channels subscription and update epg
  loader.start();

  // Init cron
  new cronJob(conf.refresh_pattern, loader.updateEPG, null, true);
});

module.exports = app;
