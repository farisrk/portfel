"use strict";

var async = require('async');
var mongo_client = require('mongodb').MongoClient;
var Log = global.logger.database;

var connection_cache = {};
var staticFunc = exports.Mongo = {
    load: (config, callback) => {
        async.forEachSeries(config, (connection, next) => {
            var name = connection.name;
            if (connection_cache.hasOwnProperty(name))
                return next(new Error('MongoDB connection ' + name + ' already exists'));

            var url = 'mongodb://' + connection.host + ':' + connection.port + '/' + connection.database;
            mongo_client.connect(url, (err, conn) => {
                if (err) {
                    Log.error('[Mongo::load] Could not connect to MongoDB server', {
                        error: err, connection: connection
                    });
                } else {
                    connection_cache[name] = conn;
                }

                return next(err);
            });
        }, (err) => {
            if (!err) Log.debug('[Mongo::load] Successfully connected to MongoDB', { connections: config });
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
            var operation = '_' + options['op'];
            delete options['op'];

            // TODO: profile the query
            var connection = staticFunc.getConnection(options['connection']);
            var collection = connection.collection(options['collection']);
            mongoOperations[operation](collection, options, (err, res) => {
                var logLevel = 'info';
                var logMessage = util.format('[%s] : %s', options['ns'], operation);
                if (err) {
                    logLevel = 'error';
                    options['error'] = err;
                } else {
                    options['result'] = res;
                    if (res.hasOwnProperty('result'))
                        options['result'] = res['result'];
                }
                Log.log(logLevel, logMessage, options);

                return callback(err, res);
            });
        } catch(err) {
            Log.error('[MongoClient::doQuery] Error occurred during mongo query', {
                message: err['message'],
                trace: err['stack'],
                data: options
            });
            return callback(err);
        }
    }
};

var mongoOperations = {
    _find: (collection, options, callback) => {
        options.query = options.query || {};
        options.fields = options.fields || {};
        var cursor = collection.find(options.query, options.fields);
        // apply sort, limit, etc
        if (options.sort) cursor.sort(options.sort);
        if (options.skip) cursor.skip(options.skip);
        if (options.limit) cursor.limit(options.limit);
        cursor.toArray(callback);
    },
    _insert: (collection, options, callback) => {
        if (!options.hasOwnProperty('data')) throw new Error('Missing the insert data');
        options.options = options.options || {};
        collection.insert(options.data, options.options, callback);
    },
    _update: (collection, options, callback) => {
        if (!options.hasOwnProperty('query')) throw new Error('Missing the query data');
        if (!options.hasOwnProperty('update')) throw new Error('Missing the update data');
        options.options = options.options || {};
        collection.update(options.query, options.update, options.options, callback);
    },
    _remove: (collection, options, callback) => {
        if (!options.hasOwnProperty('query')) throw new Error('Missing the query data');
        collection.remove(options.query, callback);
    }
    // collection.insertMany([{a:1}, {a:2}], {w:1}, (err, docs) => {
}
