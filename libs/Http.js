"use strict";

var async = require('async');
var _ = require('underscore');
var request = require('request');
var Log = global.logger.database;

var connection_cache = {};
var staticFunc = exports.Http = {
    load: (config, callback) => {
        var err;
        for (var idx = 0, length = config.length; idx < length; idx++) {
            var connection = config[idx];
            var name = connection.name;
            if (connection_cache.hasOwnProperty(name)) {
                err = new Error("Http connection '" + name + "' already exists");
                break;
            }

            var server = 'http://' + connection.host + ':' + connection.port;
            connection_cache[name] = request.defaults({ baseUrl: server });
        }
        if (!err) Log.debug('[Http::load] Successfully created Http request objects', { connections: config });
        return callback(err);
    },
    getConnection: (name) => {
        if (!connection_cache.hasOwnProperty(name))
            throw new Error('Requested connection does not exist');
        return connection_cache[name];
    },
    getConnections: () => {
        return connection_cache;
    },
    doRequest: (options, callback) => {
        try {
            // TODO: profile the query
            var connection = staticFunc.getConnection(options['connection']);
            var request = options['request'];
            if (!request.hasOwnProperty('method'))
                request['method'] = 'GET';
            if (!request.hasOwnProperty('json'))
                request['json'] = true;
            if (!request.hasOwnProperty('timeout'))
                request['timeout '] = 10;
            if (request['method'] == 'POST' || request['method'] == 'PUT') {
                if (!request.hasOwnProperty('data')) request['data'] = {};
            }
            // make the request
            connection(request, (err, response, body) => {
                var logLevel = 'info';
                var logMessage = util.format('[%s] : %s', options['ns'], request['method']);
                options['response'] = _.pick(response, 'headers', 'statusCode', 'statusMessage', 'body');

                var statusCode = response['statusCode'];
                if (err || !statusCode.toString().match(/^2[\d]{2}$/)) {
                    logLevel = 'error';

                    var errorMessage = response['statusMessage'];
                    if (body && body instanceof Object && body.hasOwnProperty('msg'))
                        errorMessage = body['msg'];
                    options[error] = errorMessage;
                    if (!err) err = new Error(errorMessage);
                    err.statusCode = statusCode;
                }
                Log.log(logLevel, logMessage, options);

                return callback(err, body);
            });
        } catch(err) {
            Log.error('[HTTP::doRequest] Error occurred during http request', {
                message: err['message'],
                trace: err['stack'],
                data: options
            });
            return callback(err);
        }
    }
};
