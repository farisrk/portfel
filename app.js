"use strict";

var express = require('express');
var app = express();
var path = require('path');
var favicon = require('serve-favicon');
var logger = require('morgan');
var cookieParser = require('cookie-parser');
var bodyParser = require('body-parser');
var qs = require('querystring');
var util = require('util');
var async = require('async');

// make sure the environment is set to one of the allowed ones
var env = app.get('env');
if (['development', 'production'].indexOf(env) === -1) {
    console.error("Please specify node enviroment: NODE_ENV");
    process.exit(1);
}
global.options = require('./configs/' + env + '.json');
global.logger = require('./libs/Winston').init(app);
var Log = global.logger.application;

// initialization
async.series([
    (next) => {
        var BeanstalkClient = require('./libs/database/Beanstalk').Beanstalk;
        BeanstalkClient.load(global.options.beanstalk, next);
    },
    (next) => {
        var MongodbClient = require('./libs/database/MongoDB').Mongo;
        MongodbClient.load(global.options.mongo, next);
    },
    (next) => {
        var RedisClient = require('./libs/database/Redis').Redis;
        RedisClient.load(global.options.redis, next);
    },
    (next) => {
        var HttpClient = require('./libs/Http').Http;
        HttpClient.load(global.options.http, next);
    }
], (err) => {
    if (err) {
        Log.error('Initialization failed', { error: err.message }, () => {
            waitForLoggersToFinish(1);
        });
    } else {
        var routes = require('./routes/index');
        var paypal = require('./routes/paypal');
        var adaptivePayments = require('./routes/adaptivePayments');

        // view engine setup
        app.set('views', path.join(__dirname, 'views'));
        app.set('view engine', 'hjs');

        // uncomment after placing your favicon in /public
        //app.use(favicon(path.join(__dirname, 'public', 'favicon.ico')));
        app.use(logger('dev'));
        app.use(bodyParser.json());
        app.use(bodyParser.urlencoded({ extended: false }));
        app.use(cookieParser());
        app.use(express.static(path.join(__dirname, 'public')));

        app.use('/', routes);
        app.use('/1/paypal', paypal);
        app.use('/1/paypal/adaptivepayment', adaptivePayments);

        // catch 404 and forward to error handler
        app.use((req, res, next) => {
          var err = new Error('Not Found');
          err.status = 404;
          next(err);
        });

        // error handlers

        // development error handler
        // will print stacktrace
        if (app.get('env') === 'development') {
            app.use((err, req, res, next) => {
                Log.error("Got an error:", { message: err.message, error: err });

                if (!res.headersSent) {
                    res.status(err.status || 500);
                    res.render('error', {
                        message: err.message,
                        error: err
                    });
                } else { next(err) }
            });
        }

        // production error handler
        // no stacktraces leaked to user
        app.use((err, req, res, next) => {
            Log.error("Got an error:", { message: err.message, error: err });

            if (!res.headersSent) {
                res.status(err.status || 500);
                res.render('error', {
                    message: err.message,
                    error: {}
                });
            } else {
              LOG.error("Ended up with error router with the headers being already sent!");
            }
        });

    }
});

function waitForLoggersToFinish(code) {
    var numFlushes = 0;
    var numFlushed = 0;
    Object.keys(logger.transports).forEach((k) => {
        if (logger.transports[k]._stream) {
            numFlushes += 1;
            logger.transports[k]._stream.once("finish", () => {
                numFlushed += 1;
                if (numFlushes === numFlushed) {
                    process.exit(code);
                }
            });
            logger.transports[k]._stream.end();
        }
    });
    if (numFlushes === 0) {
        process.exit(code);
    }
}

module.exports = app;
