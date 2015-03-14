var log4js = require('log4js');

log4js.configure({
  appenders: [
    { type: 'console' }
  ]
});

var logger = log4js.getLogger('MovistarTV');
logger.setLevel('INFO');
Object.defineProperty(exports, "LOG", { value:logger });
