var util = require('util');
var async = require('async');
var express = require('express');
var router = express.Router();
var Paypal = require('paypal-adaptive');
var PreApprovalModel = require('../models/PreApproval').PreApprovalDAO;
var _ = require('underscore');
var qs = require('querystring');

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
router.get('/preapproval/:userId', (req, res) => {
    PreApprovalModel.getByUser(req.params.userId, (result) => {
        result.forEach((data) => {
            data['links'] = [];
            if (data.status == PreApprovalModel.STATUS_PENDING) {
                data['links'].push({
                    key: data._id,
                    label: 'Continue',
                    id: 'continuePreapproval'
                });
            }
            if (data.status == PreApprovalModel.STATUS_ACTIVE) {
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
            userId: req.params.userId,
            preapprovals: result
        });
    });
});

// preapproval authorization
router.post('/preapproval/:userId', (req, res) => {
    var userId = req.params.userId;
    var options;
    // TODO: application needs to provide return & cancel urls, start & end dates, optional memo

    async.series([
        (next) => {
            if (global.options.paypal.multiplePreapprovals) return next();

            // need to check for existing preapprovals
            PreApprovalModel.getByUser(userId, (preapprovals) => {
                if (preapprovals.length === 0) return next();
                return next(new Error('Multiple preapprovals are not allowed'));
            });
        },
        (next) => {
            options = {
                currencyCode: global.options.paypal.currencyCode,
                startingDate: new Date().toISOString(),
                endingDate: new Date('2016-06-01').toISOString(),
                returnUrl: 'http://fk-server.airg.us:3000/1/paypal/adaptivepayment/preapproval/' + userId,
                cancelUrl: 'http://fk-server.airg.us:3000/1/paypal/adaptivepayment/preapproval/' + userId,
                ipnNotificationUrl: global.options.paypal.ipn.preapproval,
                displayMaxTotalAmount: true,
                maxAmountPerPayment: req.body.amount,
                requestEnvelope: {
                    errorLanguage: 'en_US'
                },
                memo: req.body.memo || "Preapproval authorization for auto billing",  // include userId??
                requireInstantFundingSource: true
                //maxNumberOfPayments: 1,
                //maxTotalAmountOfAllPayments: '500.00',
            };
            console.log('PreApproval options:', options);
            paypalSdk.preapproval(qs.stringify(options), (err, response) => {
                if (err) err.message = response['error'][0]['message'];
                return next(err, response);
            });
        }
    ], (err, data) => {
        var responseBody = data[1];
        if (err) {
            console.error('Uh oh, something went wrong!', err.stack, JSON.stringify(responseBody));
            res.status(500).send(err.message);
        } else {
            // create the preapproval entry
            PreApprovalModel.create(
                responseBody.preapprovalKey,
                userId,
                req.body.airgId,
                options.startingDate,
                options.endingDate,
                options.maxAmountPerPayment
            );
            // send the redirect url
            res.status(200).send({
                redirect: responseBody.preapprovalUrl
            });
        }
    });
});

// get preapproval details
// TODO: router.get('/1/paypal/preapproval/:userId', (req, res, next) => {});
router.get('/preapp/:userId/', (req, res, next) => {
    //
})

// pay request
router.post('/pay/:key', (req, res) => {
    var key = req.params.key;
    var amount = req.body.amount;
    var preapprovalDetails, options;

    async.series([
        (next) => {
            // retrieve the preapproval details
            PreApprovalModel.getByKey(key, (details) => {
                preapprovalDetails = details;

                if (!details)
                    return next(new Error('PreApproval does not exist'));
                if (details['status'] !== PreApprovalModel.STATUS_ACTIVE)
                    return next(new Error('PreApproval is not active'));
                amount = amount || details['max_amount_per_payment'];

                return next();
            });
        },
        (next) => {
            var userId = preapprovalDetails['userId'];
            options = {
                'returnUrl': 'http://fk-server.airg.us:3000/1/paypal/adaptivepayment/preapproval/' + userId,
                'cancelUrl': 'http://fk-server.airg.us:3000/1/paypal/adaptivepayment/preapproval/' + userId,
                'actionType': 'PAY',
                'ipnNotificationUrl': global.options.paypal.ipn.pay,

                'currencyCode': global.options.paypal.currencyCode,
                //'trackingID': '', // unique payment ID to reference the payment
                'preapprovalKey': key,
                'memo': 'Preapproved Charge',
                'receiverList.receiver(0).amount': amount,
                'receiverList.receiver(0).email': global.options.paypal.api.email,
                //'receiverList.receiver(0).accountId': '',
                'reverseAllParallelPaymentsOnError': true,
                'senderEmail': preapprovalDetails['sender_email'],
                'requestEnvelope.errorLanguage': 'en_US',
                //"detailLevel":"ReturnAll"
            };
            console.log('PreApproval options:', options);
            paypalSdk.pay(qs.stringify(options), (err, response) => {
                if (err) err.message = response['error'][0]['message'];
                return next(err, response);

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
    ], (err, data) => {
        var responseBody = data[1];
        if (err) {
            console.error('Uh oh, something went wrong!', err.stack, JSON.stringify(responseBody));
            res.status(500).send(err.message);
        } else {
            // create the preapproval entry
            var paymentData = {
                'status': responseBody['paymentExecStatus'],
                'preapproval_key': options['preapprovalKey'],
                'amount': responseBody['paymentInfoList']['paymentInfo'][0]['receiver']['amount'],
                'payment_request_date': responseBody['responseEnvelope']['timestamp'],
                'txn_id': responseBody['paymentInfoList']['paymentInfo'][0]['transactionId'],
                'sender_txn_id': responseBody['paymentInfoList']['paymentInfo'][0]['senderTransactionId'],
                'sender_email': options['senderEmail'],
                'sender_account_id': responseBody['sender']['accountId'],
                'receiver_email': responseBody['paymentInfoList']['paymentInfo'][0]['receiver']['email'],
                'receiver_account_id': responseBody['paymentInfoList']['paymentInfo'][0]['receiver']['accountId']
            };
            PreApprovalModel.createPayment(responseBody['payKey'], paymentData);
            res.status(200).send(paymentData);
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
            res.status(500).send(err.message);
        } else {
            console.log('SUCCESS:', response);
            res.status(200).send();
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
            PreApprovalModel.update(
                params['preapproval_key'],
                _(params).pick(
                    'status','max_number_of_payments','max_amount_per_payment',
                    'sender_email','ending_date','starting_date'
                )
            );
        } else {
            // delete the preapproval entry
            PreApprovalModel.delete(params['preapproval_key']);
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
            PreApprovalModel.updatePayment(params['pay_key'], data);
        } else {
            console.log('UNHANDLED IPN - request headers, body:', req.headers, req.body);
        }
    } else {
        console.log('UNHANDLED IPN - request headers, body:', req.headers, req.body);
    }
});

module.exports = router;