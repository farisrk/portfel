"use strict";

var winston = require('winston');
require('winston-mailer').Mail;
// var databaseLog = require('debug')('wallet:database');
// var httpLog = require('debug')('wallet:http');
// var errorLog = require('debug')('wallet:error');
// var accessLog = require('debug')('wallet:access');
// var debugLog = require('debug')('wallet:debug');


var myCustomLevels = {
    levels: {
        error: 0,
        info: 1,
        debug: 2
    },
    colors: {
        error: 'red',
        info: 'yellow',
        debug: 'green'
    }
};

var loggers = {};

exports.init = (app) => {
    var port = process.env.PORT;
    winston.addColors(myCustomLevels.colors);

    var logTypes = ['http','database','application','access'];
    for (var i = 0, length = logTypes.length; i < length; i++) {
        var loggerType = logTypes[i];
        var transports = [];
        if (process.env.DEBUG) {
            // if DEBUG is enabled, output everything to console
            transports.push(new (winston.transports.Console)({
                level: 'debug',
                name: loggerType,
                label: loggerType,
                colorize: 'all',
                prettyPrint: true,
                timestamp: true,
                showLevel: true
            }));
        } else {
            transports.push(new (winston.transports.File)({
                level: 'info',
                name: loggerType,
                dirname: global.options.logs,
                filename: port + '_' + loggerType + '.log',
                zippedArchive: true,
                rotationFormat: 'yyyyMMdd',
                json: true,
                timestamp: true,
                showLevel: true,
                handleExceptions: true
            }));
            transports.push(new (winston.transports.Mail)({
                level: 'error',
                name: loggerType,
                to: 'farisk@airg.com',
                from: 'wallet@airg.com',
                maxBufferTimeSpan: 60000,
                json: true,
                timestamp: true,
                showLevel: true
            }));
        }
        loggers[loggerType] = new (winston.Logger)({
            exitOnError: true,
            transports: transports,
            levels: myCustomLevels.levels
        });

        // else output to files/db/mail
        // Handle logger errors
        // logger.on('error', (err) => { /* Do Something */ });
        // Logger.on('logged', ...) // sent when message is logged
    }

    return loggers;
};
