"use strict";

var MongoDB = require('../libs/database/MongoDB').MongoDB;

var staticFuncs = exports.PayPalDAO = {
    // Properties
    STATUS_PENDING: 'PENDING',
    STATUS_ACTIVE: 'ACTIVE',
    STATUS_CANCELLED: 'CANCELED',

    // Methods:
    getByUser: function(userId, callback) {
        var query = {
            user_id: userId,
            status: {
                '$in': [
                    staticFuncs.STATUS_ACTIVE,
                    staticFuncs.STATUS_PENDING
                ]
            }
        };
        MongoDB.get().collection('PreApprovals').find(query).toArray((err, result) => {
            if (err) {
                // TODO: Log.error('[PreApprovalDAO::getByUser] query: [' + query + '], error: [' + err + ']');
                return callback([]);
            }
            return callback(result);
        });
    },

    getByKey: function(key, callback) {
        var query = { _id: key };
        MongoDB.get().collection('PreApprovals').find(query).toArray((err, result) => {
            if (err) {
                // TODO: Log.error('[PreApprovalDAO::getByUser] query: [' + query + '], error: [' + err + ']');
                return callback({});
            }
            return callback(result[0]);
        });
    },

    create: function(key, data) {
        data['_id'] = key;
        data['status'] = staticFuncs.STATUS_PENDING;
        data['created_at'] = (new Date()).getTime();
        data['updated_at'] = (new Date()).getTime();

        MongoDB.get().collection('PreApprovals').insert(data, { safe: true }, (err, result) => {
            if (err) {
                // TODO: Log.error('[PreApprovalDAO::getByUser] query: [' + query + '], error: [' + err + ']');
            }
        });
    },

    update: function(key, update) {
        var where = {
            _id: key
        };
        update['updated_at'] = (new Date()).getTime();
        MongoDB.get().collection('PreApprovals').update(where, {'$set': update});
    },

    delete: function(key) {
        var where = {
            _id: key
        };
        MongoDB.get().collection('PreApprovals').remove(where);
    },

    createPayment: function(key, data) {
        data['_id'] = key;
        MongoDB.get().collection('Payments').insert(data, { safe: true }, (err, result) => {
            if (err) {
                // TODO: Log.error('[PreApprovalDAO::getByUser] query: [' + query + '], error: [' + err + ']');
            }
        });
    },

    updatePayment: function(key, update) {
        var where = {
            _id: key
        };
        MongoDB.get().collection('Payments').update(where, {'$set': update});
    },

    pointsProvisioningError: function(key, data) {
        data['_id'] = key;
        MongoDB.get().collection('PointsErrors').insert(data, { safe: true }, (err, result) => {
            if (err) {
                // TODO: Log.error('[PreApprovalDAO::getByUser] query: [' + query + '], error: [' + err + ']');
            }
        });
    },

    logIPN: function(data) {
        MongoDB.get().collection('IpnLog').insert(data, { safe: true }, (err, result) => {
            if (err) {
                // TODO: Log.error('[PreApprovalDAO::getByUser] query: [' + query + '], error: [' + err + ']');
            }
        });
    }
};
