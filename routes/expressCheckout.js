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
var nodemailer = require('nodemailer');

//////////////////
/// initialization
//////////////////
// create reusable transporter object using the default SMTP transport
var smtpTransport = nodemailer.createTransport(global.options.smtp);
// instantiate the paypal express checkout model
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
                if (!result) {
                    err = new Error('PreApproval does not exist');
                    err.code = 404;
                }
                else if (result.status == ecDAO.STATUS_CANCELLED) {
                    err = new Error('PreApproval has been canceled');
                    err.code = 406;
                }
                else if (result.status == ecDAO.STATUS_ACTIVE) {
                    res.status(200).json({
                        status: ecDAO.STATUS_ACTIVE,
                        billing_agreement_id: result.billing_agreement_id
                    });
                    return;
                }

                if (err && result) err.details = result;
                return next(err);
            });
        },
        (next) => {
            // get the express checkout details
            paypalEC.getExpressCheckoutDetails(token, (err, response) => {
                ecDetails = response;
                if (err && err.details.L_ERRORCODE0 == 10411) {
                    ecDAO.updateByToken(token, {
                        status: ecDAO.STATUS_CANCELLED
                    });
                    res.status(200).json({
                        status: ecDAO.STATUS_CANCELLED,
                        msg: err.details.L_LONGMESSAGE0
                    });
                    return;
                }
                if (!err && response.BILLINGAGREEMENTACCEPTEDSTATUS == 0) {
                    res.status(202).json({
                        redirect: global.options.paypal.redirect.expressCheckout + token
                    });
                    return;
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
            res.status(err.code || 500).json({
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
                var err;
                if (!details) {
                    err = new Error('PreApproval does not exist');
                    err.code = 404;
                } else {
                    preapprovalDetails = details;
                }

                return next(err);
            });
        }
    ], (err) => {
        if (err) {
            Log.error(err.message);
            res.status(err.code || 500).json({
                msg: err.message
            });
        } else {
            res.status(200).json(preapprovalDetails);
        }
    });
});

// cancel preapproval
router.delete('/reference/:key', (req, res, next) => {
    var token = req.params.token;
    var preapprovalDetails;

    async.series([
        (next) => {
            // retrieve the preapproval details
            ecDAO.getByKey(token, (details) => {
                var err;
                if (!details) {
                    err = new Error('PreApproval does not exist');
                    err.code = 404;
                } else {
                    preapprovalDetails = details;
                }

                return next(err);
            });
        },
        (next) => {
            // cancel the preapproval in our database
            ecDAO.updateByToken(token, {
                status: ecDAO.STATUS_CANCELLED
            });

            return next();
        }
    ], (err) => {
        if (err) {
            Log.error(err.message, err.details);
            res.status(err.code || 500).json({
                msg: err.message
            });
        } else {
            // send response
            res.status(200).json({
                status: ecDAO.STATUS_CANCELLED,
                user_id: preapprovalDetails.user_id,
                billing_agreement_id: preapprovalDetails.billing_agreement_id
            });
        }
    });
});

// pay request
router.post('/reference/:key', (req, res) => {
    var billingAgreementId = req.params.key;
    var amount = req.body.amount;
    var preapprovalDetails, points, secondaryId, purchaseKey, transactionId, payResponse;

    async.series([
        (next) => {
            // retrieve the preapproval details
            ecDAO.getByKey(billingAgreementId, (result) => {
                var err;
                if (!result) {
                    err = new Error('PreApproval does not exist');
                    err.code = 404;
                }
                else if (result.status != ecDAO.STATUS_ACTIVE) {
                    err = new Error('PreApproval is not active');
                    err.code = 403;
                }
                else {
                    preapprovalDetails = result;

                    if (!amount || parseFloat(amount) > parseFloat(result.max_amount_per_payment))
                        amount = result.max_amount_per_payment;
                    points = result.points;
                    secondaryId = result.secondary_id;
                    purchaseKey = result.purchase_key;
                }
                if (err && result) err.details = result;

                return next(err);
            });
        },
        (next) => {
            // create transaction on the wallet server
            WalletServer.createTransaction(secondaryId, purchaseKey, (err, response) => {
                if (!err) {
                    transactionId = response.body.guid;
                    if (!transactionId) {
                        err = new Error('Create transaction did not return a GUID');
                        err.code = 503;
                    }
                }
                if (err && response) err.details = response;

                return next(err);
            });
        },
        (next) => {
            // send the pay request to paypal
            var notifyUrl = global.options.paypal.ipn.pay;
            var custom = { secondary_id: secondaryId, purchase_key: purchaseKey };

            paypalEC.doReferenceTransaction(billingAgreementId, amount, custom, notifyUrl, (err, response) => {
                payResponse = response;
                if (err && response.L_ERRORCODE0 == 10201) {
                    // the billing agreement has been canceled, so update our records
                    ecDAO.cancelByBillingId(billingAgreementId);
                }
                else if (!err && response && response.PAYMENTSTATUS != 'Completed') {
                    err = new Error(response.PENDINGREASON);
                    err.details = response;
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
                    ecDAO.pointsProvisioningError(transactionId, {
                        'points': points,
                        'purchase_key': purchaseKey,
                        'user_id': preapprovalDetails.user_id,
                        'secondary_id': secondaryId,
                        'transaction_id': payResponse.TRANSACTIONID,
                        'error_code': err.code,
                        'error_message': err.message
                    });
                    Log.error("Failed to add credits to user's wallet.  Check the PointsErrors collection for more info.", {
                        user_id: preapprovalDetails.user_id,
                        secondary_id: secondaryId,
                        wallet_guid: transactionId,
                        transaction_id: payResponse.TRANSACTIONID
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
            Log.error(err.message, err.details);
            res.status(err.code || 500).json({
                msg: err.message,
                details: payResponse
            });
            // add meta-data for the transaction status
            transactionStatus.response = 505; // failed response
            transactionStatus.render = err.message;
        } else {
            // create the payment entry
            var paymentData = {
                'status': payResponse.PAYMENTSTATUS,
                'billing_agreement_id': billingAgreementId,
                'user_id': preapprovalDetails.user_id,
                'amount': parseFloat(payResponse.AMT),
                'fee': parseFloat(payResponse.FEEAMT),
                'currency_code': payResponse.CURRENCYCODE,
                'points': points,
                'payment_request_date': payResponse.ORDERTIME,
                'transaction_id': payResponse.TRANSACTIONID,
                'pending_reason': payResponse.PENDINGREASON,
                'reason_code': payResponse.REASONCODE
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
                    'created': payResponse.ORDERTIME
                }, () => {});
            }
            // add meta-data for the transaction status
            transactionStatus.purchaseId = payResponse.TRANSACTIONID;
            // send e-mail to user notifying them of the charge
            smtpTransport.sendMail({
                from: '"airG Customer Support" <support@airgames.com>',
                to: preapprovalDetails.payer.email,
                subject: 'airG Credits Autoload Receipt',
                text: util.format('You have been charged $%s for %s airG Credits', parseFloat(payResponse.AMT), points)
            });
        }

        // update transaction only if a transaction was created (unless error occurred)
        if (transactionId) {
            // update the transaction
            WalletServer.updateTransaction(secondaryId, transactionId, transactionStatus, () => {});
        }
    });
});

router.post('/ipn', (req, res, next) => {
    var params = req.body;
    Log.debug('INCOMING IPN - request headers, body:', { headers: req.headers, body: req.body });

    // handle the IPN
    var handled = false;
    if (params.txn_type == 'mp_signup') {
        // IPN body {
        //     "txn_type" : "mp_signup",
        //     "last_name" : "Zheng",
        //     "mp_currency" : "CAD",
        //     "residence_country" : "CA",
        //     "mp_status" : "0",
        //     "mp_custom" : "{\"secondary_id\":\"67177\"}",
        //     "mp_pay_type" : "INSTANT",
        //     "verify_sign" : "Ai5WQD.0Wr-X3e3nArQqzScD4vOJA3CxxPktr4i8VxXKDc.fEt8f03XB",
        //     "payer_status" : "verified",
        //     "test_ipn" : "1",
        //     "payer_email" : "ante@airgames.ca",
        //     "first_name" : "Ante",
        //     "payer_id" : "DCC4K7K2P77E2",
        //     "reason_code" : "mp_2001",
        //     "mp_id" : "B-25S76546Y1273532T",
        //     "charset" : "windows-1252",
        //     "notify_version" : "3.8",
        //     "mp_desc" : "$25 authorization for auto-billing",
        //     "mp_cycle_start" : "1",
        //     "ipn_track_id" : "ed8455ec1369"
        // }

        // take no action here since signup is already handled
        handled = true;
    } else if (params.txn_type == 'mp_cancel') {
        // IPN body {
        //     "txn_type" : "mp_cancel",
        //     "last_name" : "Khan",
        //     "mp_currency" : "CAD",
        //     "residence_country" : "CA",
        //     "mp_status" : "1",
        //     "mp_custom" : "{\"secondaryId\":\"6139\"}",
        //     "mp_pay_type" : "INSTANT",
        //     "verify_sign" : "A6bgev4A-GrVFBXGENdFw9G4s0.4AmR1XewNv98B0hLiBCv13JErMPRn",
        //     "payer_status" : "verified",
        //     "test_ipn" : "1",
        //     "payer_email" : "khan@airgames.ca",
        //     "first_name" : "Faris",
        //     "payer_id" : "3ZGZY5QZYBNW8",
        //     "reason_code" : "mp_2001",
        //     "mp_id" : "B-1K863085185608058",
        //     "charset" : "windows-1252",
        //     "notify_version" : "3.8",
        //     "mp_desc" : "$50.00 Auto-Reload Preapproval",
        //     "mp_cycle_start" : "23",
        //     "ipn_track_id" : "bb6dcb308e4b3"
        // }

        // user has cancelled their billing agreement, need to cancel all instances of
        // preapprovals based on the billing agreement id
        ecDAO.cancelByBillingId(params.mp_id);
        handled = true;
    } else if (params.txn_type == 'merch_pmt') {
        // IPN body {
        //     "mp_custom" : "{\"secondaryId\":\"6139\"}",
        //     "mc_gross" : "50.00",
        //     "mp_currency" : "CAD",
        //     "protection_eligibility" : "Ineligible",
        //     "payer_id" : "3ZGZY5QZYBNW8",
        //     "tax" : "0.00",
        //     "payment_date" : "16:31:53 Mar 30, 2016 PDT",
        //     "mp_id" : "B-1K863085185608058",
        //     "payment_status" : "Completed",
        //     "charset" : "windows-1252",
        //     "first_name" : "Faris",
        //     "mp_status" : "0",
        //     "mc_fee" : "2.25",
        //     "notify_version" : "3.8",
        //     "custom" : "{\"guid\":\"abc123\"}",
        //     "payer_status" : "verified",
        //     "business" : "khan@airgames.org",
        //     "quantity" : "1",
        //     "verify_sign" : "AOh0tu.5JUQyG2Aao4MpntBA2sFjAdy0JOrgEWOjMIXDfF0d0T3VqrpI",
        //     "payer_email" : "khan@airgames.ca",
        //     "txn_id" : "5T68391018116610S",
        //     "payment_type" : "instant",
        //     "last_name" : "Khan",
        //     "mp_desc" : "$50.00 Auto-Reload Preapproval",
        //     "receiver_email" : "khan@airgames.org",
        //     "payment_fee" : "2.25",
        //     "mp_cycle_start" : "23",
        //     "receiver_id" : "MM5EPY4H2WCME",
        //     "txn_type" : "merch_pmt",
        //     "item_name" : "",
        //     "mc_currency" : "USD",
        //     "item_number" : "",
        //     "residence_country" : "CA",
        //     "test_ipn" : "1",
        //     "handling_amount" : "0.00",
        //     "transaction_subject" : "",
        //     "payment_gross" : "50.00",
        //     "shipping" : "0.00",
        //     "ipn_track_id" : "3faae343b283c"
        // }

        // take no action here since payment response is already handled
        handled = true;
    }
    if (!handled) Log.error('UNHANDLED IPN - request headers, body:', { headers: req.headers, body: req.body });
});

module.exports = router;
