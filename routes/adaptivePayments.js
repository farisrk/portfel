"use strict";

var util = require('util');
var async = require('async');
var express = require('express');
var router = express.Router();
var Paypal = require('paypal-adaptive');
var PayPalModel = require('../models/PayPal').PayPalDAO;
var _ = require('underscore');
var qs = require('querystring');
var request = require('request');
var baseRequest = request.defaults({ baseUrl: global.options['wallet']['host'] });
var beanstalkClient = require('../libs/database/Beanstalk').Beanstalk;

var paypalSdk = new Paypal({
    userId: global.options.paypal.api.userId,
    password: global.options.paypal.api.password,
    signature: global.options.paypal.api.signature,
    appId: global.options.paypal.api.appId,
    sandboxPreapprovalUrl: global.options.paypal.preapproval.redirect,
    sandbox: global.options.paypal.sandbox,
    requestFormat: 'NV'
});

/* GET users listing. */
router.get('/preapproval/user/:userId', (req, res, done) => {
    var userId = req.params.userId;

    PayPalModel.getByUser(userId, (result) => {
        if (req.query.render && req.query.render == 1) {
            result.forEach((data) => {
                data['links'] = [];
                if (data.status == PayPalModel.STATUS_PENDING) {
                    data['links'].push({
                        key: data._id,
                        label: 'Cancel',
                        id: 'cancelPreapproval'
                    });
                }
                if (data.status == PayPalModel.STATUS_ACTIVE) {
                    data['links'].push({
                        key: data._id,
                        label: 'Pay',
                        id: 'payRequest'
                    });
                    data['links'].push({
                        key: data._id,
                        label: 'Cancel',
                        id: 'cancelPreapproval'
                    });
                }
            });
            console.log('get user preapprovals:', result);

            res.render('adaptivePayments', {
                title: "Adaptive Payments",
                userId: userId,
                preapprovals: result
            });
        } else {
            res.status(200).json(result);
        }
    });
});

// preapproval authorization
router.post('/preapproval/:userId', (req, res) => {
    var userId = req.params.userId;
    var purchaseKey = req.body['purchase_key'];
    var options, amount, points, preapprovalResponse;
    // TODO: application needs to provide return & cancel urls, start & end dates, optional memo, purchase key
    // {
    //     'return_url': '',
    //     'cancel_url': '',
    //     'starting_date': '',
    //     'ending_date': '',
    //     'memo': '',
    //     'secondary_Id': '',
    //     'purchase_key': '',
    //     'max_amount_per_payment': '', // do not accept this, use the purchase key to obtain the price from the wallet server!
    // }
    async.series([
        (next) => {
            if (global.options.paypal.multiplePreapprovals) return next();

            // need to check for existing preapprovals
            PayPalModel.getByUser(userId, (preapprovals) => {
                if (preapprovals.length === 0) return next();
                return next(new Error('Multiple preapprovals are not allowed'));
            });
        },
        (next) => {
            var requiredData = [
                    'starting_date','ending_date','return_url',
                    'cancel_url','secondary_id','purchase_key'
            ];
            for (var idx = 0, length = requiredData.length; idx < length; idx++) {
                var key = requiredData[idx];
                if (!req.body.hasOwnProperty(key))
                    return next(new Error("Missing required data '" + key + "'"));
            }
            return next();
        },
        (next) => {
            // verify the purchase key and get the price
            if (!purchaseKey) return next(new Error('Purchase key is missing'));
            if (!purchaseKey.match(/^PPAP_/))
                return next(new Error('Purchase key "' + purchaseKey + '" is invalid'));

            var callData = global.options['wallet']['getPricelist'];
            var data = {
                method: callData['method'],
                uri: callData['uri']
                        .replace(':purchaseKey', purchaseKey),
            };
            baseRequest(data, (err, response, body) => {
                if (err || response.statusCode != 200)
                    return next(new Error("Purchase key '" + purchaseKey + "' is invalid"));

                var purchaseKeyDetails = JSON.parse(body);
                points = purchaseKeyDetails['points'];
                amount = purchaseKeyDetails['exactPrice'];

                return next();
            });
        },
        (next) => {
            // send preapproval request to paypal
            options = {
                currencyCode: global.options['paypal']['currencyCode'],
                startingDate: req.body['starting_date'],
                endingDate: req.body['ending_date'],
                returnUrl: req.body['return_url'],
                cancelUrl: req.body['cancel_url'],
                ipnNotificationUrl: global.options['paypal']['ipn']['preapproval'],
                displayMaxTotalAmount: true,
                maxAmountPerPayment: amount,
                requestEnvelope: {
                    //errorLanguage: 'en_US'
                },
                // memo:string - (Optional) A note about the preapproval. Maximum length: 1000 characters,
                // including newline characters
                memo: req.body.memo || "Preapproval authorization for auto billing",
                requireInstantFundingSource: true

                //maxNumberOfPayments: 1
                //maxTotalAmountOfAllPayments: '500.00'
            };
            console.log('PreApproval options:', options);
            paypalSdk.preapproval(qs.stringify(options), (err, response) => {
                preapprovalResponse = response;

                if (err) {
                    preapprovalResponse = response['error'][0];
                    err.message = preapprovalResponse['message'];
                }
                return next(err);
            });
        }
    ], (err) => {
        if (err) {
            console.error('Uh oh, something went wrong!', err.stack, JSON.stringify(preapprovalResponse));
            res.status(500).json({
                msg: err.message,
                details: preapprovalResponse
            });
        } else {
            // create the preapproval entry
            var data = _.extend(req.body, {
                user_id: userId,
                points: parseInt(points),
                starting_date: options['startingDate'],
                ending_date: options['endingDate'],
                max_amount_per_payment: parseFloat(options['maxAmountPerPayment']),
                cur_payments: 0,
                cur_payments_amount: 0
            });
            PayPalModel.create(preapprovalResponse['preapprovalKey'], data);
            // send the redirect url
            res.status(202).json({
                redirect: preapprovalResponse['preapprovalUrl']
            });
        }
    });
});

// get preapproval details
router.get('/preapproval/:key', (req, res) => {
    var key = req.params['key'];
    var preapprovalDetails, options;

    async.series([
        (next) => {
            // retrieve the preapproval details
            PayPalModel.getByKey(key, (details) => {
                preapprovalDetails = details;

                if (!details)
                    return next(new Error('PreApproval does not exist'));
                return next();
            });
        },
        (next) => {
            // grab preapproval details from paypal
            _getPreapprovalDetails(key, next);
        },
        (next) => {
            // retrieve the preapproval details
            PayPalModel.getByKey(key, (details) => {
                return next(null, details);
            });
        }
    ], (err, data) => {
        if (err) {
            console.error('Uh oh, something went wrong!', err.stack);
            res.status(500).json({
                msg: err.message
            });
        } else {
            res.status(200).json(data[2]);
        }
    });
});

// pay request
router.post('/pay/:key', (req, res) => {
    var key = req.params['key'];
    var amount = req.body['amount'];
    var preapprovalDetails, options, transactionId, payResponse, points;

    async.series([
        (next) => {
            // retrieve the preapproval details
            PayPalModel.getByKey(key, (details) => {
                preapprovalDetails = details;

                if (!details)
                    return next(new Error('PreApproval does not exist'));
                if (details['status'] != PayPalModel.STATUS_ACTIVE)
                    return next(new Error('PreApproval is not active'));
                if (!amount || parseFloat(amount) > parseFloat(details['max_amount_per_payment']))
                    amount = details['max_amount_per_payment'];
                points = details['points'];

                return next();
            });
        },
        (next) => {
            // create transaction on the wallet server
            var callData = global.options['wallet']['createTransaction'];
            var data = {
                method: callData['method'],
                uri: callData['uri'].replace(':userId', preapprovalDetails['secondary_id']),
                body: { purchaseKey: preapprovalDetails['purchase_key'] },
                json: true
            };
            baseRequest(data, (err, response, body) => {
                if (err || response.statusCode != 202) {
                    return next(new Error(err || body['msg'] || body['message']));
                }

                transactionId = body['guid'];
                if (!transactionId) return next(new Error('Create transaction did not return a GUID'));

                return next();
            });
        },
        (next) => {
            // send the pay request to paypal
            options = {
                'actionType': 'PAY',
                'requestEnvelope.errorLanguage': 'en_US',
                'requestEnvelope.detailLevel': 'ReturnAll',
                'reverseAllParallelPaymentsOnError': true,

                'preapprovalKey': key,
                'trackingId': transactionId,
                'memo': 'Preapproved Charge',
                'currencyCode': global.options['paypal']['currencyCode'],
                'ipnNotificationUrl': global.options['paypal']['ipn']['pay'],

                'receiverList.receiver(0).amount': amount,
                'receiverList.receiver(0).email': global.options['paypal']['api']['email'],
                'senderEmail': preapprovalDetails['sender_email'],

                'returnUrl': req.body['return_url'] || preapprovalDetails['return_url'],
                'cancelUrl': req.body['cancel_url'] || preapprovalDetails['cancel_url']
            };
            console.log('Pay options:', options);
            paypalSdk.pay(qs.stringify(options), (err, response) => {
                payResponse = response || {};
                if (err) {
                    payResponse = response['error'][0];
                    err.message = payResponse['message'];
                } else if (response['paymentExecStatus'] == 'ERROR') {
                    payResponse = response['payErrorList']['payError'][0];
                    err = new Error(payResponse['error']['message']);
                } else if (response['paymentExecStatus'] == 'CREATED') {
                    err = new Error('PayPal requires user authorization');
                }
                return next(err);

                // sample pay response
                // {
                //     "payKey" : "AP-43L13587AX5682415",
                //     "paymentExecStatus" : "COMPLETED",
                //     "paymentInfoList" : {
                //         "paymentInfo" : [ {
                //             "pendingRefund" : "false",
                //             "receiver" : {
                //                 "accountId" : "TPY4NGVJD8PVW",
                //                 "amount" : "35.00",
                //                 "email" : "farisk-facilitator@airg.com",
                //                 "primary" : "false"
                //             },
                //             "senderTransactionId" : "9PM11398YH697072W",
                //             "senderTransactionStatus" : "COMPLETED",
                //             "transactionId" : "92J0979428059044W",
                //             "transactionStatus" : "COMPLETED"
                //         } ]
                //     },
                //     "responseEnvelope" : {
                //         "ack" : "Success",
                //         "build" : "17820627",
                //         "correlationId" : "e542eca354b61",
                //         "timestamp" : "2016-02-17T13:28:40.204-08:00"
                //     },
                //     "sender" : { "accountId" : "DQYZMHXKPUS3G" }
                // }
            });
        },
        (next) => {
            // add points to the user wallet
            var callData = global.options['wallet']['updateBalance'];
            var data = {
                method: callData['method'],
                uri: callData['uri']
                        .replace(':userId', preapprovalDetails['secondary_id']),
                body: {
                    app: 'PAYPAL',
                    points: points,
                    memo: transactionId
                },
                json: true
            };
            baseRequest(data, (err, response, body) => {
                if (err || response.statusCode != 200) {
                    // could not add points to the user wallet, just log the error
                    pointsProvisioningError(payResponse['payKey'], {
                        'points': points,
                        'transaction_id': transactionId,
                        'purchase_key': preapprovalDetails['purchase_key'],
                        'user_id': preapprovalDetails['user_id'],
                        'secondary_id': preapprovalDetails['secondary_id'],
                        'errorCode': response.statusCode,
                        'errorMessage': body['msg'] || response.statusMessage
                    });
                }

                return next();
            });
        }
    ], (err) => {
        var callData = global.options['wallet']['updateTransaction'];
        var data = {
            method: callData['method'],
            uri: callData['uri']
                .replace(':userId', preapprovalDetails['secondary_id'])
                .replace(':guid', transactionId),
            body: {
                action: 3024,   // completed action
                response: 200   // success response
            },
            json: true
        };

        if (err) {
            console.error('Uh oh, something went wrong!', err.stack, JSON.stringify(payResponse));
            res.status(500).json({
                msg: err.message,
                details: payResponse
            });
            // add meta-data for the transaction status
            data['body']['response'] = 505; // failed response
            data['body']['render'] = err.message;
        } else {
            // create the preapproval entry
            var paymentData = {
                'status': payResponse['paymentExecStatus'],
                'preapproval_key': options['preapprovalKey'],
                'user_id': preapprovalDetails['user_id'],
                'amount': payResponse['paymentInfoList']['paymentInfo'][0]['receiver']['amount'],
                'points': points,
                'payment_request_date': payResponse['responseEnvelope']['timestamp'],
                'transaction_guid': transactionId,
                'txn_id': payResponse['paymentInfoList']['paymentInfo'][0]['transactionId'],
                'sender_txn_id': payResponse['paymentInfoList']['paymentInfo'][0]['senderTransactionId'],
                'sender_email': options['senderEmail'],
                'sender_account_id': payResponse['sender']['accountId'],
                'receiver_email': payResponse['paymentInfoList']['paymentInfo'][0]['receiver']['email'],
                'receiver_account_id': payResponse['paymentInfoList']['paymentInfo'][0]['receiver']['accountId']
            };
            PayPalModel.createPayment(payResponse['payKey'], paymentData);
            res.status(200).json(paymentData);

            // add payment to beanstalk to reward user
            if (preapprovalDetails['cur_payments'] > 0) {
                console.log("putting job in the beanstalk!");
                beanstalkClient.put('wallet', 1000, 0, 250, {
                    'vendor': 'PAYPAL',
                    'guid': transactionId,
                    'userId': preapprovalDetails['secondary_id'],
                    'price': {
                        'paypal': 1,
                        'points': preapprovalDetails['points'],
                        'purchaseKey': preapprovalDetails['purchase_key']
                    },
                    'created': payResponse['responseEnvelope']['timestamp']
                }, function(err) { console.log('beanstalk put error: ', err.message) });
            }
            // add meta-data for the transaction status
            data['body']['purchaseId'] = payResponse['payKey'];
            // TODO: send e-mail to user notifying them of the charge

        }

        // update transaction only if a transaction was created (unless error occurred)
        if (transactionId) {
            // update the transaction
            baseRequest(data, (error, response, body) => {
                console.log("transaction update:", err, data, body);
            });
            // get preapproval details and sync with preapproval data in mongo
            _getPreapprovalDetails(key, function() {});
        }
    });
});

// cancel preapproval
router.delete('/preapproval/:key', (req, res, next) => {
    var key = req.params.key;

    var options = {
        'preapprovalKey': key,
        'requestEnvelope': {
            'errorLanguage': 'en_US'
        }
    };
    paypalSdk.cancelPreapproval(qs.stringify(options), (err, response) => {
        if (err) {
            err.message = response['error'][0]['message'];
            console.error('Uh oh, something went wrong!', err.stack, JSON.stringify(response));
            res.status(500).json({
                msg: err.message,
                details: response['error'][0]
            });
        } else {
            console.log('SUCCESS:', response);
            // update the preapproval in our database incase the IPN doesnot come or is late
            PayPalModel.update(
                key, { status: PayPalModel.CANCELED }
            );

            res.status(200).json(response['responseEnvelope']);
        }
    });
});

router.post('/ipn', (req, res, next) => {
    var params = req.body;
    console.log('INCOMING IPN - request headers, body:', req.headers, req.body);

    // handle the IPN
    if (params['transaction_type'] === 'Adaptive Payment PREAPPROVAL') {
        // IPN body - preapproval: {
        //     max_number_of_payments: 'null',
        //     starting_date: '2016-02-12T23:12:36.000Z',
        //     pin_type: 'NOT_REQUIRED',
        //     max_amount_per_payment: '12.00',
        //     currency_code: 'USD',
        //     sender_email: 'farisk-buyer@airg.com',
        //     verify_sign: 'An5ns1Kso7MWUdW4ErQKJJJ4qi4-ATyiJd52hXhbG31OVThspz8FYlPS',
        //     test_ipn: '1',
        //     date_of_month: '0',
        //     current_number_of_payments: '0',
        //     preapproval_key: 'PA-3K6824355T6349007',
        //     ending_date: '2016-06-01T00:00:00.000Z',
        //     approved: 'true',
        //     transaction_type: 'Adaptive Payment PREAPPROVAL',
        //     day_of_week: 'NO_DAY_SPECIFIED',
        //     status: 'ACTIVE',
        //     current_total_amount_of_all_payments: '0.00',
        //     current_period_attempts: '0',
        //     charset: 'windows-1252',
        //     payment_period: '0',
        //     notify_version: 'UNVERSIONED'
        // }
        if (params['approved'] === 'true') {
            // update the preapproval entry, this handles both ACTIVE and CANCELED states
            PayPalModel.update(
                params['preapproval_key'],
                _.pick(
                    params,
                    //'status','max_number_of_payments','max_amount_per_payment',
                    'status','sender_email','ending_date','starting_date'
                )
            );
        } else {
            // delete the preapproval entry
            PayPalModel.delete(params['preapproval_key']);
        }
    } else if (params['transaction_type'] === 'Adaptive Payment PAY') {
        // IPN body - PAY {
        //     payment_request_date: 'Tue Feb 16 16:37:36 PST 2016',
        //     return_url: 'http://fk-server.airg.us:3000/1/paypal/adaptivepayment/preapproval/8fc5c461dab644dfaff5caef4ad3a777',
        //     fees_payer: 'EACHRECEIVER',
        //     ipn_notification_url: 'http://fk-server.airg.us/1/paypal/adaptivepayment/ipn-pay',
        //     sender_email: 'faris_buyer_1@airg.com',
        //     verify_sign: 'AgEqVnO33g6pkMltgTgwgltBidvjA0t-H7GnjQ3Xf0Ag4BkkPeqCxgeo',
        //     test_ipn: '1',
        //     cancel_url: 'http://fk-server.airg.us:3000/1/paypal/adaptivepayment/preapproval/8fc5c461dab644dfaff5caef4ad3a777',
        //     pay_key: 'AP-0SG36342F2011480D',
        //     action_type: 'PAY',
        //     memo: 'Preapproved_charge',
        //     preapproval_key: 'PA-22613925M51811548',
        //     transaction_type: 'Adaptive Payment PAY',
        //     status: 'COMPLETED',
        //     log_default_shipping_address_in_transaction: 'false',
        //     charset: 'windows-1252',
        //     notify_version: 'UNVERSIONED',
        //     reverse_all_parallel_payments_on_error: 'true'
        //     'transaction[0].id_for_sender_txn': '1D289960UA464135L',
        //     'transaction[0].amount': 'USD 35.00',
        //     'transaction[0].receiver': 'farisk-facilitator@airg.com',
        //     'transaction[0].is_primary_receiver': 'false',
        //     'transaction[0].id': '80C48156KG2814044',
        //     'transaction[0].status': 'Completed',
        //     'transaction[0].status_for_sender_txn': 'Completed',
        //     'transaction[0].pending_reason': 'NONE',
        // }
        if (params['status'] === 'COMPLETED') {
            // create the preapproval entry
            var data = {
                'payment_request_date': params['payment_request_date'],
                'sender_email': params['sender_email'],
                'preapproval_key': params['preapproval_key'],
                'amount': params['transaction[0].amount'],
                'sender_txn_id': params['transaction[0].id_for_sender_txn'],
                'txn_id': params['transaction[0].id'],
                'amount': params['transaction[0].amount']
            };
            PayPalModel.updatePayment(params['pay_key'], data);
        } else {
            console.log('UNHANDLED IPN - request headers, body:', req.headers, req.body);
        }
    } else {
        console.log('UNHANDLED IPN - request headers, body:', req.headers, req.body);
    }
});

module.exports = router;

function _getPreapprovalDetails(key, callback) {
    // grab preapproval details from paypal
    var options = {
        preapprovalKey: key,
        requestEnvelope: {
            errorLanguage: 'en_US'
        },
    };
    console.log('PreApprovalDetails options:', options);
    paypalSdk.preapprovalDetails(qs.stringify(options), (err, response) => {
        if (err) err.message = response['error'][0]['message'];
        else {
            PayPalModel.update(key, {
                'status': response['status'],
                'cur_payments': parseInt(response['curPayments']),
                'cur_payments_amount': parseFloat(response['curPaymentsAmount'])
            });
        }
        return callback(err, response);
    });
}

