var express = require("express"),
  app = express(),
//  bodyParser = require("body-parser"),
//  methodOverride = require("method-override"),
  log4js = require('log4js'),
  cronJob = require('cron').CronJob,
  fs = require('fs')

var path = require('path');

var logger= require('./logger.js');
var log=logger.LOG;

fs.mkdir(__dirname + '/data', function(err){});

app.use(log4js.connectLogger(log, { level: log4js.levels.DEBUG }));
//app.use(bodyParser.urlencoded({ extended: false }));
//app.use(bodyParser.json());
//app.use(methodOverride());

var router = express.Router();

router.get('/channels', function(req, res) {
  try {
    var channels = require('./data/channels.json');
    res.json(channels);
  } catch (e) {
    res.status(503);
    res.send('Channels not ready yet, try later again');
  }
});

router.get('/epg/:timestamp/:channel', function(req, res) {
  var path = __dirname + '/data/epg/' + req.params.timestamp + '/' + req.params.channel;
  fs.readFile(path, 'utf8', function (err, data) {
    if (err) {
      log.warn('EPG not found -> ' + err);
      res.sendStatus(404);
      return;
    }

    res.json(JSON.parse(data));
  });
});

app.use(router);

app.listen(3000, function() {
  log.info("Server running on http://localhost:3000");

  // Check config, channels subscription and update epg
  var loader = require('./epg_loader');

  // Set update task at 04:00AM every day
  var job = new cronJob('00 00 04 * * *', loader.updateEPG, null, true);
});
