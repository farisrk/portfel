"use strict";

var util = require('util');
var async = require('async');
var _ = require('underscore');
var express = require('express');
var router = express.Router();
var ecDAO = require('../dao/ExpressCheckout').ExpressCheckoutDAO;
var PayPalEC = require('../models/ExpressCheckout');
var beanstalkClient = require('../libs/database/Beanstalk').Beanstalk;
var Log = global.logger.application;
var WalletServer = require('../libs/Wallet').Wallet;

var paypalEC = new PayPalEC({
    username: global.options.paypal.api.userId,
    password: global.options.paypal.api.password,
    signature: global.options.paypal.api.signature
});

// get user's preapprovals
router.get('/reference/user/:userId', (req, res, done) => {
    var userId = req.params.userId;

    ecDAO.getByUser(userId, (result) => {
        if (req.query.render && req.query.render == 1) {
            result.forEach((data) => {
                data['links'] = [];
                if (data.status == ecDAO.STATUS_PENDING) {
                    data['links'].push({
                        key: data._id,
                        label: 'Continue',
                        id: 'continuePreapproval'
                    });
                    data['links'].push({
                        key: data._id,
                        label: 'Cancel',
                        id: 'cancelPreapproval'
                    });
                }
                if (data.status == ecDAO.STATUS_ACTIVE) {
                    data['links'].push({
                        key: data.billing_agreement_id,
                        label: 'Pay',
                        id: 'payRequest'
                    });
                    data['links'].push({
                        key: data.billing_agreement_id,
                        label: 'Cancel',
                        id: 'cancelPreapproval'
                    });
                }
            });
            Log.debug('get user preapprovals:', result);

            res.render('referenceTransaction', {
                title: "Reference Transactions",
                userId: userId,
                preapprovals: result
            });
        } else {
            res.status(200).json(result);
        }
    });
});

// start the preapproval process
router.post('/reference/user/:userId', (req, res) => {
    var userId = req.params.userId;
    var purchaseKey = req.body.purchase_key;
    var amount, points, preapprovalResponse = {};
    // the request body should contain the following information
    // {
    //     'memo': '',
    //     'return_url': '',
    //     'cancel_url': '',
    //     'secondary_Id': '',
    //     'purchase_key': '',
    // }
    async.series([
        (next) => {
            if (global.options.paypal.multiplePreapprovals) return next();

            // need to check for existing preapprovals
            ecDAO.getByUser(userId, (preapprovals) => {
                if (preapprovals.length === 0) return next();
                var err = new Error('Multiple preapprovals are not allowed');
                err.details = preapprovals;
                return next(err);
            });
        },
        (next) => {
            // verify that the required data is provided
            var requiredData = [
                    'return_url','cancel_url',
                    'secondary_id','purchase_key'
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

            ecDAO.getPriceData(purchaseKey, (err, priceData) => {
                if (!err) {
                    points = parseInt(priceData['points']);
                    amount = parseFloat(priceData['exactPrice']);
                }
                return next(err);
            });
        },
        (next) => {
            // start preapproval request
            paypalEC.setExpressCheckout(
                amount, global.options.paypal.currencyCode,
                req.body.memo || "$" + amount + " authorization for auto-billing",
                { secondary_id: req.body.secondary_id },
                req.body.cancel_url, req.body.return_url,
                global.options.paypal.ipn.preapproval.expressCheckout,
                (err, response) => {
                    preapprovalResponse = response;
                    return next(err);
                }
            );
        }
    ], (err) => {
        if (err) {
            Log.error(err.message, err.response);
            res.status(500).json({
                msg: err.message,
                details: err.response
            });
        } else {
            // create the preapproval entry
            var token = preapprovalResponse['TOKEN'];
            ecDAO.create(token, {
                secondary_id: req.body.secondary_id,
                purchase_key: req.body.purchase_key,
                user_id: userId,
                points: points,
                max_amount_per_payment: amount,
                created_at: preapprovalResponse['TIMESTAMP'],
                cur_payments: 0,
                cur_payments_amount: 0
            });

            // send the redirect url
            res.status(202).json({
                redirect: global.options.paypal.redirect.expressCheckout + token
            });
        }
    });
});

// continue the preapproval process
router.patch('/reference/:key', (req, res) => {
    var token = req.params.key;
    var ecDetails, billingAgreement;

    async.series([
        (next) => {
            // verify the preapproval exists in our database
            ecDAO.getByKey(token, (result) => {
                var err;
                if (!result) err = new Error('PreApproval does not exist');
                else if (result.status == ecDAO.STATUS_ACTIVE) err = new Error('PreApproval is already active');
                else if (result.status == ecDAO.STATUS_CANCELLED) err = new Error('PreApproval has been canceled');
                if (err) err.details = result;
                return next(err);
            });
        },
        (next) => {
            // get the express checkout details
            paypalEC.getExpressCheckoutDetails(token, (err, response) => {
                ecDetails = response;
                if (!err && response.BILLINGAGREEMENTACCEPTEDSTATUS == 0) {
                    err = new Error('User has not accepted the agreement');
                    err.details = response;
                }

                return next(err);
            });
        },
        (next) => {
            // create billing agreement
            paypalEC.createBillingAgreement(token, (err, response) => {
                if (!err) billingAgreement = response;
                return next(err);
            });
        }
    ], (err) => {
        if (err) {
            Log.error(err.message, err.details);
            res.status(500).json({
                msg: err.message,
                details: err.details
            });
        } else {
            // update the preapproval in the database
            var payerData = {
                id: ecDetails.PAYERID,
                email: ecDetails.EMAIL,
                status: ecDetails.PAYERSTATUS,
                country_code: ecDetails.COUNTRYCODE,
                name: ecDetails.FIRSTNAME + ' ' + ecDetails.LASTNAME
            };
            ecDAO.updateByToken(token, {
                payer: payerData,
                status: ecDAO.STATUS_ACTIVE,
                billing_agreement_id: billingAgreement.BILLINGAGREEMENTID
            });

            // send the redirect url
            res.status(200).json({
                status: ecDAO.STATUS_ACTIVE,
                billing_agreement_id: billingAgreement.BILLINGAGREEMENTID
            });
        }
    });
});

// get preapproval detais
router.get('/reference/:key', (req, res) => {
    var key = req.params.key;
    var preapprovalDetails;

    async.series([
        (next) => {
            // retrieve the preapproval details
            ecDAO.getByKey(key, (details) => {
                if (!details)
                    return next(new Error('PreApproval does not exist'));

                preapprovalDetails = details;
                return next();
            });
        },
    ], (err) => {
        if (err) {
            Log.error(err.message);
            res.status(500).json({
                msg: err.message
            });
        } else {
            res.status(200).json(preapprovalDetails);
        }
    });
});

// cancel preapproval
router.delete('/reference/:key', (req, res, next) => {
    var billingAgreementId = req.params.key;
    var notifyUrl = global.options.paypal.ipn.preapproval.expressCheckout;

    paypalEC.cancelBillingAgreement(billingAgreementId, notifyUrl, (err, response) => {
        // error code 10201 means the billing agreement was alrady canceled,
        // so we will not treat this error code as an error
        if (err && response.L_ERRORCODE0 != 10201) {
            Log.error(err.message, err.details);
            res.status(500).json({
                msg: err.message,
                details: err.details
            });
        } else {
            // update the preapproval in our database incase the IPN doesnot come or is late
            ecDAO.updateByBillingId(
                billingAgreementId, { status: ecDAO.STATUS_CANCELLED }
            );
            // send response
            res.status(200).json({
                status: ecDAO.STATUS_CANCELLED,
                billing_agreement_id: billingAgreementId
            });
        }
    });
});

// pay request
router.post('/reference/:key', (req, res) => {
    var billingAgreementId = req.params['key'];
    var amount = req.body['amount'];
    var preapprovalDetails, points, secondaryId, purchaseKey, transactionId, payResponse;

    async.series([
        (next) => {
            // retrieve the preapproval details
            ecDAO.getByKey(billingAgreementId, (result) => {
                preapprovalDetails = result;

                if (!result)
                    return next(new Error('PreApproval does not exist'));
                if (result['status'] != ecDAO.STATUS_ACTIVE)
                    return next(new Error('PreApproval is not active'));
                if (!amount || parseFloat(amount) > parseFloat(result['max_amount_per_payment']))
                    amount = result['max_amount_per_payment'];
                points = result['points'];
                secondaryId = result['secondary_id'];
                purchaseKey = result['purchase_key'];

                return next();
            });
        },
        (next) => {
            // create transaction on the wallet server
            WalletServer.createTransaction(secondaryId, purchaseKey, (err, response) => {
                if (!err) {
                    transactionId = response.body.guid;
                    if (!transactionId) err = new Error('Create transaction did not return a GUID');
                }

                return next(err);
            });
        },
        (next) => {
            // send the pay request to paypal
            var custom = {};
            var notifyUrl = global.options.paypal.ipn.pay;

            paypalEC.doReferenceTransaction(billingAgreementId, amount, custom, notifyUrl, (err, response) => {
                payResponse = response;
                if (err && response.L_ERRORCODE0 == 10201) {
                    // the billing agreement has been canceled, so update our records
                    ecDAO.updateByBillingId(
                        billingAgreementId, { status: ecDAO.STATUS_CANCELLED }
                    );
                }

                return next(err);
            });

            // {
            //   BILLINGAGREEMENTID: 'B-1BS389992R494113U',
            //   TIMESTAMP: '2016-03-23T20:00:46Z',
            //   CORRELATIONID: 'bad44bb26bb72',
            //   ACK: 'Success',
            //   VERSION: '86',
            //   BUILD: '20986399',
            //   TRANSACTIONID: '54Y083711U944444E',  // store for record keeping
            //   TRANSACTIONTYPE: 'merchtpmt',
            //   PAYMENTTYPE: 'instant',
            //   ORDERTIME: '2016-03-23T20:00:45Z',
            //   AMT: '50.00',
            //   FEEAMT: '2.25',
            //   TAXAMT: '0.00',
            //   CURRENCYCODE: 'USD',
            //   PAYMENTSTATUS: 'Completed',
            //   PENDINGREASON: 'None',
            //   REASONCODE: 'None',
            //   PROTECTIONELIGIBILITY: 'Ineligible',
            //   PROTECTIONELIGIBILITYTYPE: 'None'
            // }
            // // Billing Agreement canceled by user
            // {
            //   TIMESTAMP: '2016-03-23T17:56:32Z',
            //   CORRELATIONID: 'f3e86b93c067e',
            //   ACK: 'Failure',
            //   VERSION: '86',
            //   BUILD: '20986399',
            //   L_ERRORCODE0: '10201',
            //   L_SHORTMESSAGE0: 'Agreement canceled',
            //   L_LONGMESSAGE0: 'Agreement was canceled',
            //   L_SEVERITYCODE0: 'Error',
            //   TRANSACTIONTYPE: 'None',
            //   PAYMENTTYPE: 'None',
            //   ORDERTIME: '1970-01-01T00:00:00Z',
            //   PAYMENTSTATUS: 'None',
            //   PENDINGREASON: 'None',
            //   REASONCODE: 'None'
            // }
        },
        (next) => {
            // add points to the user wallet
            WalletServer.updateBalance(secondaryId, transactionId, points, (err, response) => {
                if (err) {
                    // could not add points to the user wallet, just log the error
                    // TODO: send email alerts! .. use winston!
                    ecDAO.pointsProvisioningError(payResponse['TRANSACTIONID'], {
                        'points': points,
                        'purchase_key': purchaseKey,
                        'user_id': preapprovalDetails['user_id'],
                        'secondary_id': secondaryId,
                        'errorCode': err.code,
                        'errorMessage': err.message
                    });
                }

                return next();
            });
        }
    ], (err) => {
        var transactionStatus = {
            action: 3024,   // completed action
            response: 200   // success response
        };

        if (err) {
            Log.error(err.message, payResponse);
            res.status(500).json({
                msg: err.message,
                details: payResponse
            });
            // add meta-data for the transaction status
            transactionStatus['response'] = 505; // failed response
            transactionStatus['render'] = err.message;
        } else {
            // create the payment entry
            var paymentData = {
                'status': payResponse['PAYMENTSTATUS'],
                'billing_agreement_id': billingAgreementId,
                'user_id': preapprovalDetails['user_id'],
                'amount': parseFloat(payResponse['AMT']),
                'fee': parseFloat(payResponse['FEEAMT']),
                'currency_code': payResponse['CURRENCYCODE'],
                'points': points,
                'payment_request_date': payResponse['ORDERTIME'],
                'transaction_id': payResponse['TRANSACTIONID'],
                'pending_reason': payResponse['PENDINGREASON'],
                'reason_code': payResponse['REASONCODE']
            };
            ecDAO.createPayment(transactionId, paymentData);
            res.status(200).json(paymentData);
            // increment the number of payments
            preapprovalDetails.cur_payments++;
            // add payment to beanstalk to reward user
            if (preapprovalDetails.cur_payments > 1) {
                var delay = 0,
                    ttr = 250,
                    priority = 1000;
                beanstalkClient.put('wallet', priority, delay, ttr, {
                    'vendor': 'PAYPAL',
                    'guid': transactionId,
                    'userId': secondaryId,
                    'price': {
                        'paypal': 1,
                        'points': points,
                        'purchaseKey': purchaseKey
                    },
                    'created': payResponse['ORDERTIME']
                }, () => {});
            }
            // add meta-data for the transaction status
            transactionStatus['purchaseId'] = payResponse['TRANSACTIONID'];
            // TODO: send e-mail to user notifying them of the charge
        }

        // update transaction only if a transaction was created (unless error occurred)
        if (transactionId) {
            // update the transaction
            WalletServer.updateTransaction(secondaryId, transactionId, transactionStatus, () => {});
        }
    });
});

module.exports = router;
