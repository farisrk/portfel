"use strict";

var Wallet = require('../libs/Wallet').Wallet;
var Redis = require('../libs/database/Redis').Redis;
var MongoDB = require('../libs/database/MongoDB').Mongo;
var dbLogger = global.logger.database;

var staticFuncs = exports.ExpressCheckoutDAO = {
    // Properties
    STATUS_PENDING: 'PENDING',
    STATUS_ACTIVE: 'ACTIVE',
    STATUS_CANCELLED: 'CANCELED',

    // Methods:
    getByUser: (userId, callback) => {
        var query = {
            user_id: userId,
            status: {
                '$in': [
                    staticFuncs.STATUS_ACTIVE,
                    staticFuncs.STATUS_PENDING
                ]
            }
        };
        MongoDB.doQuery({
            ns: 'PayPal::getByUser', op: 'find',
            connection: 'wallet', collection: 'PreApprovals',
            query: query
        }, (err, result) => {
            if (err) result = [];
            return callback(result);
        });
    },

    getByKey: (key, callback) => {
        // key can be a token or billing agreement ID
        MongoDB.doQuery({
            ns: 'PayPal::getByKey', op: 'find',
            connection: 'wallet', collection:'PreApprovals',
            query: { '$or': [{ _id: key }, { billing_agreement_id: key }] }
        }, (err, result) => {
            if (err) return callback({});
            return callback(result[0]);
        });
    },

    create: (key, data) => {
        data['_id'] = key;
        data['status'] = staticFuncs.STATUS_PENDING;
        if (!data.hasOwnProperty('created_at'))
            data['created_at'] = (new Date()).toISOString();
        data['updated_at'] = (new Date()).toISOString();

        MongoDB.doQuery({
            ns: 'PayPal::create', op: 'insert',
            connection: 'wallet', collection:'PreApprovals',
            data: data, options: { safe: true }
        }, () => {});
    },

    updateByToken: (token, update) => {
        update['updated_at'] = (new Date()).toISOString();

        MongoDB.doQuery({
            ns: 'PayPal::updateByToken', op: 'update',
            connection: 'wallet', collection:'PreApprovals',
            query: { _id: token }, update: { '$set': update }
        }, () => {});
    },

    cancelByBillingId: (id) => {
        MongoDB.doQuery({
            ns: 'PayPal::updateByBillingId', op: 'update',
            connection: 'wallet', collection:'PreApprovals',
            query: { billing_agreement_id: id },
            update: { '$set': {
                'status': staticFuncs.STATUS_CANCELLED,
                'updated_at': (new Date()).toISOString()
            }},
            options: { 'multi': true }
        }, () => {});
    },

    delete: (key) => {
        MongoDB.doQuery({
            ns: 'PayPal::delete', op: 'remove',
            connection: 'wallet', collection:'PreApprovals',
            query: { _id: key }
        }, () => {});
    },

    createPayment: (id, data) => {
        data['_id'] = id;

        MongoDB.doQuery({
            ns: 'PayPal::createPayment', op: 'insert',
            connection: 'wallet', collection:'Payments',
            data: data, options: { safe: true }
        }, () => {});
        MongoDB.doQuery({
            ns: 'PayPal::createPayment', op: 'update',
            connection: 'wallet', collection:'PreApprovals',
            query: { billing_agreement_id: data.billing_agreement_id },
            update: { '$inc': {
                cur_payments: 1,
                cur_payments_amount: data.amount
            }}
        }, () => {});
    },

    updatePayment: (key, update) => { // should be called by IPN handler
        MongoDB.doQuery({
            ns: 'PayPal::updatePayment', op: 'update',
            connection: 'wallet', collection:'Payments',
            query: { _id: key }, update: { '$set': update }
        }, () => {});
    },

    pointsProvisioningError: (key, data) => {
        data['_id'] = key;

        MongoDB.doQuery({
            ns: 'PayPal::pointsProvisioningError', op: 'insert',
            connection: 'wallet', collection:'PointsErrors',
            data: data, options: { safe: true }
        }, () => {});
    },

    logIPN: (data) => {
        MongoDB.doQuery({
            ns: 'PayPal::logIPN', op: 'insert',
            connection: 'wallet', collection:'IpnLog',
            data: data, options: { safe: true }
        }, () => {});
    },

    getPriceData: (purchaseKey, callback) => {
        staticFuncs.getPriceList((prices) => {
            if (prices) {
                if (prices.hasOwnProperty(purchaseKey)) return callback(null, prices[purchaseKey]);
                var err = new Error("Purchase key '" + purchaseKey + "' is invalid");
                err.details = prices;
                return callback(err);
            }

            // not in redis, so make http call
            Wallet.getPriceList((err, response) => {
                if (err) return callback(err);

                prices = {};
                var priceList = response.body.prices;
                for (var idx = 0, length = priceList.length; idx < length; idx++) {
                    var priceData = priceList[idx];
                    if (priceData['purchaseKey'].match(/^PPAP_/)) {
                        prices[priceData['purchaseKey']] = priceData;
                    }
                }
                // cache the price list
                staticFuncs.setPriceList(prices);

                if (prices.hasOwnProperty(purchaseKey))
                    return callback(null, prices[purchaseKey]);

                var err = new Error("Purchase key '" + purchaseKey + "' is invalid");
                err.details = prices;
                return callback(err);
            });
        });
    },
    getPriceList: (callback) => {
        Redis.doQuery({
            ns: 'PayPal::getPriceList', op: 'get',
            connection: 'wallet', key: 'paypalPriceList'
        }, (err, result) => {
            if (!err && result) result = JSON.parse(result);
            return callback(result);
        });
    },
    setPriceList: (prices) => {
        Redis.doQuery({
            ns: 'PayPal::setPriceList', op: 'set',
            connection: 'wallet', key: 'paypalPriceList',
            value: JSON.stringify(prices), ttl: 86400
        }, () => {});
    }
};
