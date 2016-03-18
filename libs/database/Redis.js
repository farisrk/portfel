"use strict";

var async = require('async');
var redis_client = require('redis');
var Log = global.logger.database;

var connection_cache = {};
var staticFunc = exports.Redis = {
    load: (config, callback) => {
        async.forEachSeries(config, (connection, next) => {
            var name = connection.name;
            if (connection_cache.hasOwnProperty(name))
                return next(new Error("Redis connection '" + name + "' already exists"));

            var client = redis_client.createClient(connection.port, connection.host);
            client.on('error', (err) => {
                Log.error('[Redis::load] Redis client connection error', {
                    message: err.message,
                    trace: err.stack,
                    connection: connection
                });
            });
            connection_cache[name] = client;

            return next();
        }, (err) => {
            if (!err) Log.debug('[Redis::load] Successfully connected to Redis', { connections: config });
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
    doQuery: (options, callback) => {
        try {
            var operation = '_' + options.op;
            delete options.op;

            // TODO: profile the query
            var connection = staticFunc.getConnection(options.connection);
            redisOperations[operation](connection, options, (err, res) => {
                // fuck you javascript/redis library... one of you fucked up!
                if (typeof res === 'string' && res === 'undefined') res = undefined;

                var logLevel = 'info';
                var logMessage = util.format('[%s] : %s', options['ns'], operation);
                if (err) {
                    logLevel = 'error';
                    options.error = err;
                } else {
                    options.result = res;
                }
                Log.log(logLevel, logMessage, options);

                return callback(err, res);
            });
        } catch(err) {
            Log.error('[RedisClient::doQuery] Error occurred during mongo query', {
                message: err.message,
                trace: err.stack,
                data: options
            });
            return callback(err);
        }
    }
};

var redisOperations = {
    _get: (connection, options, callback) => {
        connection.get(options.key, callback);
    },
    _set: (connection, options, callback) => {
        console.log('redis set options:', options);
        connection.set(options.key, options.value, (err) => {
            callback(err);
            if (!err && options.hasOwnProperty('ttl'))
                connection.expire(options.key, options.ttl);
        });
    }
}
