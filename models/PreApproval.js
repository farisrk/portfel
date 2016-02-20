//"use strict";

var MongoDB = require('../libs/database/MongoDB').MongoDB;

var staticFuncs = exports.PreApprovalDAO = {
    // Properties
    STATUS_PENDING: 'PENDING',
    STATUS_ACTIVE: 'ACTIVE',
    STATUS_CANCELLED: 'CANCELED',

    // Methods:
    getByUser: function(userId, callback) {
        var query = { user_Id: userId, status: staticFuncs.STATUS_ACTIVE };
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
    }


    // getWatchedListings: function(gamesId, callback) {
    //     var query = { gamesId: gamesId };
    //     mongoDB.getConnection('plowtown').WatchList.find(query, function(err, results) {
    //         var listingIds = [];
    //         if (err) {
    //             Log.error('[AuctionDAO::getWatchedListings] query: [' + query + '], error: [' + err + ']');
    //             return callback(listingIds)
    //         }

    //         results.forEach(function(wl) {
    //             listingIds.push(wl.listingId);
    //         });
    //         return callback(listingIds);
    //     });
    // },

    // addToWatchList: function(userId, listingId, callback) {
    //     var insert = {
    //         gamesId : userId,
    //         listingId : parseInt(listingId)
    //     };
    //     mongoDB.getConnection('plowtown').WatchList.insert(insert, { safe : true }, function(err, result) {
    //         // ignore code 11000 since its duplicate key error code
    //         if (err && err.code !== 11000) Log.error('[AuctionDAO::addToWatchList] query: [' + insert + '], error: [' + err + ']');
    //         if (callback) return callback(err, result);
    //         return;
    //     });
    // },

    // getListingTypes: function(callback) {
    //     Mysql.alloc('plowtownAuctionMysqlDBPool', function(mysql, free) {
    //         var query = 'SELECT * FROM listingType';
    //         Log.log('database', '[AuctionDAO::getListingTypes] query: [' + query + ']');

    //         mysql.query(query, function(err, rows) {
    //             free();
    //             if (err) {
    //                 Log.error('[AuctionDAO::getListingTypes] query: [' + query + '], error: [' + err + ']');
    //                 return callback(err);
    //             }

    //             return callback(err, rows);
    //         });
    //     });
    // },

    // getListingStatuses: function(callback) {
    //     Mysql.alloc('plowtownAuctionMysqlDBPool', function(mysql, free) {
    //         var query = 'SELECT * FROM listingStatus';
    //         Log.log('database', '[AuctionDAO::getListingStatuses] query: [' + query + ']');

    //         mysql.query(query, function(err, rows) {
    //             free();
    //             if (err) {
    //                 Log.error('[AuctionDAO::getListingStatuses] query: [' + query + '], error: [' + err + ']');
    //                 return callback(err);
    //             }

    //             return callback(err, rows);
    //         });
    //     });
    // },

    // createListing: function(sellerId, itemId, itemData, quantity, listingId, duration, bidAmount, callback) {
    //     Mysql.alloc('plowtownAuctionMysqlDBPool', function(mysql, free) {
    //         var insert = 'INSERT INTO listing (itemId, itemData, quantity, typeId, sellerId, bidAmount, createdAt, endingAt, updatedAt) ' +
    //                      'VALUES (?, ?, ?, ?, ?, ?, NOW(), DATE_ADD(NOW(), INTERVAL ' + duration + ' SECOND), NOW())';
    //         var params = [ itemId, JSON.stringify(itemData), quantity, listingId, sellerId, bidAmount ];
    //         Log.log('database', '[AuctionDAO::createListing] query: [' + insert + '], params: [' + JSON.stringify(params) + ']');

    //         mysql.query(insert, params, function(err, result) {
    //             free();
    //             if (err) {
    //                 Log.error('[AuctionDAO::createListing] query: [' + insert + '], params: [' + JSON.stringify(params) + '], error: [' + err + ']');
    //                 return callback(err);
    //             }
    //             return callback(null, result.insertId);
    //         });
    //     });
    // },
};
