"use strict";

var HttpClient = require('./Http').Http;

exports.Wallet = {
    getPriceList: (callback) => {
        var request = {
            method: 'GET',
            uri: '/1/pricepoints/paypal/us'
        };
        HttpClient.doRequest({
            ns: 'WalletServer::getPriceList',
            connection: 'wallet',
            request: request
        }, callback);
    },
    createTransaction: (userId, purchaseKey, callback) => {
        var request = {
            method: 'POST',
            uri: '/1/paypal/:userId'.replace(':userId', userId),
            body: { purchaseKey: purchaseKey }
        };
        HttpClient.doRequest({
            ns: 'WalletServer::createTransaction',
            connection: 'wallet',
            request: request
        }, callback);
    },
    updateTransaction: (userId, guid, body, callback) => {
        var request = {
            method: 'POST',
            uri: '/1/transactions/:userId/:guid'.replace(':userId', userId).replace(':guid', guid),
            body: body
        };
        HttpClient.doRequest({
            ns: 'WalletServer::updateTransaction',
            connection: 'wallet',
            request: request
        }, callback);
    },
    updateBalance: (userId, transactionId, points, callback) => {
        var request = {
            method: 'POST',
            uri: '/1/wallets/:userId'.replace(':userId', userId),
            body: {
                app: 'PAYPAL',
                points: points,
                memo: transactionId
            }
        };
        HttpClient.doRequest({
            ns: 'WalletServer::updateBalance',
            connection: 'wallet',
            request: request
        }, callback);
    }
};
