const path = require('path');
const winston = require('winston');

const isProduction = process.env.NODE_ENV === 'production';

const transports = [
  new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.timestamp({ format: 'HH:mm:ss' }),
      winston.format.printf(({ timestamp, level, message }) => `${timestamp} ${level}: ${message}`),
    ),
  }),
];

if (isProduction) {
  transports.push(
    new winston.transports.File({ filename: path.join('logs', 'error.log'), level: 'error' }),
    new winston.transports.File({ filename: path.join('logs', 'combined.log'), level: 'info' }),
  );
}

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports,
});

module.exports = logger;
