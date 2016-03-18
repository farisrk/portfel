"use strict";

var async = require('async');
var beanstalk_client = require('beanstalk_client').Client;
var Log = global.logger.database;

var connection_cache = {};

var staticFunc = exports.Beanstalk = {
    load: (config, callback) => {
        async.forEachSeries(config, (connection, next) => {
            var name = connection.name;
            var server = connection.host + ":" + connection.port;
            // we will not be pooling the connections based on server because having to use tubes
            // creates race conditions if multiple tubes are used on the same connection, instead
            // we are caching connections based on connection name. Please do not create multiple
            // connections with the same name!
            if (connection_cache.hasOwnProperty(name))
                return next(new Error('Beanstalk connection ' + name + ' already exists'));

            beanstalk_client.connect(server, (err, conn) => {
                if (err) {
                    Log.error('[Beanstalk::load] Could not connect to Beanstalk server', {
                        error: err, connection: connection
                    });

                    return next(err);
                }

                conn.use(connection.tube, (err) => {
                    if (err) {
                        Log.error('[Beanstalk::load] Error while using tube', {
                            errObj: err, tube: conf.tube
                        });

                        return next(err);
                    }
                    connection_cache[name] = conn;
                    return next();
                });
            });
        }, (err) => {
            if (!err) Log.debug('[Beanstalk::load] Successfully connected to Beanstalk', { connections: config });
            return callback(err);
        });
    },
    getConnection: (name) => {
        if (!connection_cache.hasOwnProperty(name))
            throw new Error('Requested connection does not exist');
        return connection_cache[name];
    },
    getConnections: () => {
        return connection_cache;
    },
    put: (name, priority, delay, ttr, payload, callback) => {
        try {
            var connection = staticFunc.getConnection(name);
            connection.put(priority, delay, ttr, JSON.stringify([ payload ]), (err, jobId) => {
                var logLevel = 'info';
                var logMessage = '[Beanstalk::put] Putting a job on the stalk';
                var meta = {
                    data: payload
                };
                if (err) {
                    logLevel = 'error';
                    meta['error'] = err;
                } else {
                    meta['jobId'] = jobId;
                }
                Log.log(logLevel, logMessage, meta);

                return callback(err, jobId);
            });
        } catch(err) {
            Log.error('[BeanstalkClient::put] Error occurred during put call', {
                message: err['message'],
                error: err['stack']
            });
            return callback(err);
        }
    }
};
