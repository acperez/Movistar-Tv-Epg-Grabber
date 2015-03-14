var express = require("express"),
  app = express(),
  log4js = require('log4js'),
  cronJob = require('cron').CronJob,
  fs = require('fs'),
  path = require('path'),
  routes = require('./routes/index'),
  conf = require('./conf/config'),
  logger = require('./conf/logger.js');

// Configure logger
var log=logger.LOG;
app.use(log4js.connectLogger(log, { level: 'auto' }));

// Create data folder
fs.mkdir(path.join(__dirname, 'data'), function(err){});

// Set router
app.use('/', routes);

// Start server
app.listen(conf.port, function() {
  log.info('Server running on http://localhost:' + conf.port);

  // Check config, channels subscription and update epg
  var loader = require('./lib/epg_loader');

  // Init cron
  new cronJob(conf.refresh_pattern, loader.updateEPG, null, true);
});

module.exports = app;
