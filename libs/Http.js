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

            var protocol = connection.protocol || 'http';
            var server = protocol + '://' + connection.host;
            if (connection.hasOwnProperty('port')) server += ':' + connection.port;
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
            var connection = staticFunc.getConnection(options.connection);
            var request = options.request;
            if (!request.hasOwnProperty('method'))
                request.method = 'GET';
            if (!request.hasOwnProperty('json'))
                request.json = true;
            if (!request.hasOwnProperty('timeout'))
                request.timeout = 10*1000; // 10 second timeout
            if (/^(POST|PUT)$/.test(request.method) && !request.hasOwnProperty('data'))
                request.data = {};
            // make the request
            connection(request, (err, response, body) => {
                var logLevel = 'info';
                var logMessage = util.format('[%s] : %s', options.ns, request.method);

                if (response) {
                    options.response = _.pick(response, 'headers', 'statusCode', 'statusMessage', 'body');
                    // if an error response code, create an error instance if it doesn't already exist
                    if (!err && !response.statusCode.toString().match(/^2[\d]{2}$/)) {
                        var errMsg = response.statusMessage;
                        if (body && body instanceof Object && body.hasOwnProperty('msg'))
                            errMsg = body.msg;
                        err = new Error(errMsg);
                    }
                    if (err) {
                        err.code = response.statusCode;
                        err.details = response.body;
                    }
                    response.body = body;
                }
                if (err) {
                    logLevel = 'error';
                    options.error = _.pick(err, 'message', 'code', 'trace');
                }
                Log.log(logLevel, logMessage, options);

                return callback(err, response);
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
