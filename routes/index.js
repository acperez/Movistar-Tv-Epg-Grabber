var express = require('express'),
  logger = require('../conf/logger.js'),
  path = require('path');

var router = express.Router();

var log=logger.LOG;

var rootDir = path.dirname(process.mainModule.filename);

router.get('/channels', function(req, res) {
  try {
    var channels = require(path.join(rootDir, 'data', 'channels.json'));
    res.json(channels);
  } catch (e) {
    res.status(503);
    res.send('Channels not ready yet, try later again');
  }
});

router.get('/epg/:timestamp/:channel', function(req, res) {
  var filePath = path.join(rootDir, 'data', 'epg', req.params.timestamp, req.params.channel);
  fs.readFile(filePath, 'utf8', function (err, data) {
    if (err) {
      log.warn('EPG not found -> ' + err);
      res.sendStatus(404);
      return;
    }

    res.json(JSON.parse(data));
  });
});

module.exports = router;
