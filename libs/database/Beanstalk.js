"use strict";

var async = require('async');
var beanstalk_client = require('beanstalk_client').Client;

var connection_cache = {};

var staticFunc = exports.Beanstalk = {
    load: function(config, next) {
        async.forEach(config, function(connection, callback) {
            var name = connection.name;
            var server = connection.host + ":" + connection.port;
            // we will not be pooling the connections based on server because having to use tubes
            // creates race conditions if multiple tubes are used on the same connection, instead
            // we are caching connections based on connection name. Please do not create multiple
            // connections with the same name!
            if (connection_cache.hasOwnProperty(name))
                return callback(new Error('Beanstalk connection ' + name + ' already exists'));

            beanstalk_client.connect(server, function(err, conn) {
                if (err) {
                    //Log.error("Beanstalk::load - Could NOT connect to Beanstalk server: " + server);
                    return callback(err);
                }

                conn.use(connection.tube, function(err) {
                    if (err) {
                        //Log.error('Beanstalk::load - error while using tube [' + conf.tube + '], error [' + err + ']');
                        return next(err);
                    }

                    connection_cache[name] = conn;
                    return callback();
                });
            });
        }, function (err) {
            //if (!err) Log.debug("Successfully connected to beanstalk for: " + Object.keys(connection_cache))
            return next(err);
        });
    },
    getConnection: function(name, next) {
        if (!connection_cache.hasOwnProperty(name)) {
            //Log.error("Beanstalk::getConnection - The name" + name + " does not exist.");
            return next(new Error('Invalid beanstalk connnection name "' + name + '"'));
        }

        return next(null, connection_cache[name]);
    },
    put: function(name, priority, delay, ttr, payload, next) {
        staticFunc.getConnection(name, function(err, connection) {
            if (err) return next(err);

            connection.put(priority, delay, ttr, JSON.stringify([ payload ]), function(err, jobId) {
                //if (err) Log.error('Beanstalk::put - error while putting job [' + JSON.stringify(payload) + '], error [' + err + ']');
                return next(err, jobId);
            });
        });
    }
};
