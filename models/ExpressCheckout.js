"use strict";

var qs = require('querystring');
var HttpClient = require('../libs/Http').Http;

var ExpressCheckout = class ExpressCheckout {
    constructor(config) {
        if (!config) throw new Error('Config is required');
        if (!config.username) throw new Error('Config must have username');
        this._username = config.username;

        if (!config.password) throw new Error('Config must have password');
        this._password = config.password;

        if (!config.signature) throw new Error('Config must have signature');
        this._signature = config.signature;
        // if (!config.appId && !config.sandbox) throw new Error('Config must have appId');
    }

    setExpressCheckout(amount, currencyCode, memo, custom, cancelUrl, returnUrl, notifyUrl, callback) {
        if (typeof custom == 'object')
            custom = JSON.stringify(custom);
        // { VERSION: '86',
        //   METHOD: 'SetExpressCheckout',
        //   PAYMENTREQUEST_0_AMT: '0',
        //   PAYMENTREQUEST_0_CURRENCYCODE: 'USD',
        //   PAYMENTREQUEST_0_PAYMENTACTION: 'AUTHORIZATION',
        //   PAYMENTREQUEST_0_NOTIFYURL: 'http://xxx.com/ipn',
        //   MAXAMT: '50.00',
        //   RETURNURL: 'http://xxx.com',
        //   CANCELURL: 'http://xxx.com',
        //   NOSHIPPING: '1',
        //   ALLOWNOTE: '0',
        //   L_PAYMENTTYPE0: 'InstantOnly',
        //   L_BILLINGTYPE0: 'MerchantInitiatedBillingSingleAgreement',
        //   L_BILLINGAGREEMENTCUSTOM0: '{"foo":"bar"}',
        //   L_BILLINGAGREEMENTDESCRIPTION0: 'This is a description!' }
        var body = {
            USER: this._username,
            PWD: this._password,
            SIGNATURE: this._signature,
            VERSION: 86,

            METHOD: 'SetExpressCheckout',
            ALLOWNOTE: '0',
            NOSHIPPING: '1',
            PAYMENTREQUEST_0_AMT: 0,
            PAYMENTREQUEST_0_CURRENCYCODE: currencyCode,
            PAYMENTREQUEST_0_PAYMENTACTION: 'AUTHORIZATION',
            PAYMENTREQUEST_0_NOTIFYURL: notifyUrl,
            MAXAMT: parseFloat(amount),
            L_PAYMENTTYPE0: 'InstantOnly',
            L_BILLINGTYPE0: 'MerchantInitiatedBillingSingleAgreement',
            L_BILLINGAGREEMENTCUSTOM0: custom,
            L_BILLINGAGREEMENTDESCRIPTION0: memo,
            CANCELURL: cancelUrl,
            RETURNURL: returnUrl
        };

        var request = {
            protocol: 'https:',
            method: 'POST',
            uri: '/nvp',
            body: qs.stringify(body),
            json: false
        };
        HttpClient.doRequest({
            ns: 'ExpressCheckout::setExpressCheckout',
            connection: 'paypalEC',
            request: request
        }, (error, response) => {
            return processResponse(error, response, callback);
        });

        // {
        //     TOKEN: 'EC-XXXXXXXXXXXXXXXXX',
        //     TIMESTAMP: '2016-03-22T00:28:50Z',
        //     CORRELATIONID: 'XXXXXXXXXXXXX',
        //     ACK: 'SuccessWithWarning',
        //     VERSION: '86',
        //     BUILD: '11111111',
        //     L_ERRORCODE0: '11452',
        //     L_SHORTMESSAGE0: 'Merchant not enabled for reference transactions',
        //     L_LONGMESSAGE0: 'Merchant not enabled for reference transactions',
        //     L_SEVERITYCODE0: 'Warning'
        // }
    }

    getExpressCheckoutDetails(token, callback) {
        // { VERSION: '97',
        //   METHOD: 'GetExpressCheckoutDetails',
        //   TOKEN: 'EC-XXXXXXXXXXXXXXXXX' }

        var body = {
            USER: this._username,
            PWD: this._password,
            SIGNATURE: this._signature,
            VERSION: 97,

            METHOD: 'GetExpressCheckoutDetails',
            TOKEN: token
        };

        var request = {
            protocol: 'https:',
            method: 'POST',
            uri: '/nvp',
            body: qs.stringify(body),
            json: false
        };
        HttpClient.doRequest({
            ns: 'ExpressCheckout::getExpressCheckoutDetails',
            connection: 'paypalEC',
            request: request
        }, (error, response) => {
            return processResponse(error, response, callback);
        });

        // {
        //     TOKEN: 'EC-XXXXXXXXXXXXXXXXX',
        //     BILLINGAGREEMENTACCEPTEDSTATUS: '1',
        //     CHECKOUTSTATUS: 'PaymentActionNotInitiated',
        //     TIMESTAMP: '2016-03-23T17:12:04Z',
        //     CORRELATIONID: 'XXXXXXXXXXXXX',
        //     ACK: 'Success',
        //     VERSION: '97',
        //     BUILD: '11111111',
        //     EMAIL: 'xxx@xxx.com',
        //     PAYERID: 'XXXXXXXXXXXXX',
        //     PAYERSTATUS: 'verified',
        //     FIRSTNAME: 'John',
        //     LASTNAME: 'Doe',
        //     COUNTRYCODE: 'CA',
        //     SHIPTONAME: 'John Doe',
        //     SHIPTOSTREET: '1 Maire-Victorin',
        //     SHIPTOCITY: 'Toronto',
        //     SHIPTOSTATE: 'Ontario',
        //     SHIPTOZIP: 'M5A 1E1',
        //     SHIPTOCOUNTRYCODE: 'CA',
        //     SHIPTOCOUNTRYNAME: 'Canada',
        //     ADDRESSSTATUS: 'Confirmed',
        //     CURRENCYCODE: 'USD',
        //     AMT: '0.00',
        //     SHIPPINGAMT: '0.00',
        //     HANDLINGAMT: '0.00',
        //     TAXAMT: '0.00',
        //     INSURANCEAMT: '0.00',
        //     SHIPDISCAMT: '0.00',
        //     PAYMENTREQUEST_0_CURRENCYCODE: 'USD',
        //     PAYMENTREQUEST_0_AMT: '0.00',
        //     PAYMENTREQUEST_0_SHIPPINGAMT: '0.00',
        //     PAYMENTREQUEST_0_HANDLINGAMT: '0.00',
        //     PAYMENTREQUEST_0_TAXAMT: '0.00',
        //     PAYMENTREQUEST_0_INSURANCEAMT: '0.00',
        //     PAYMENTREQUEST_0_SHIPDISCAMT: '0.00',
        //     PAYMENTREQUEST_0_INSURANCEOPTIONOFFERED: 'false',
        //     PAYMENTREQUEST_0_SHIPTONAME: 'John Doe',
        //     PAYMENTREQUEST_0_SHIPTOSTREET: '1 Maire-Victorin',
        //     PAYMENTREQUEST_0_SHIPTOCITY: 'Toronto',
        //     PAYMENTREQUEST_0_SHIPTOSTATE: 'Ontario',
        //     PAYMENTREQUEST_0_SHIPTOZIP: 'M5A 1E1',
        //     PAYMENTREQUEST_0_SHIPTOCOUNTRYCODE: 'CA',
        //     PAYMENTREQUEST_0_SHIPTOCOUNTRYNAME: 'Canada',
        //     PAYMENTREQUEST_0_ADDRESSSTATUS: 'Confirmed',
        //     PAYMENTREQUESTINFO_0_ERRORCODE: '0'
        // }
    }

    createBillingAgreement(token, callback) {
        // { VERSION: '86',
        //   METHOD: 'CreateBillingAgreement',
        //   TOKEN: 'EC-XXXXXXXXXXXXXXXXX' }
        var body = {
            USER: this._username,
            PWD: this._password,
            SIGNATURE: this._signature,
            VERSION: 86,

            METHOD: 'CreateBillingAgreement',
            TOKEN: token
        };

        var request = {
            protocol: 'https:',
            method: 'POST',
            uri: '/nvp',
            body: qs.stringify(body),
            json: false
        };
        HttpClient.doRequest({
            ns: 'ExpressCheckout::createBillingAgreement',
            connection: 'paypalEC',
            request: request
        }, (error, response) => {
            return processResponse(error, response, callback);
        });

        // {
        //     BILLINGAGREEMENTID: 'B-XXXXXXXXXXXXXXXXX',
        //     TIMESTAMP: '2016-03-23T19:58:32Z',
        //     CORRELATIONID: 'XXXXXXXXXXXXX',
        //     ACK: 'Success',
        //     VERSION: '86',
        //     BUILD: '11111111'
        // }
    }

    cancelBillingAgreement(key, notifyUrl, callback) {
        // { VERSION: '86',
        //   METHOD: 'BillAgreementUpdate',
        //   BILLINGAGREEMENTSTATUS: 'Canceled',
        //   NOTIFYURL: 'http://xxx.com/ipn',
        //   REFERENCEID: 'B-XXXXXXXXXXXXXXXXX' }
        var body = {
            USER: this._username,
            PWD: this._password,
            SIGNATURE: this._signature,
            VERSION: 86,

            METHOD: 'BillAgreementUpdate',
            BILLINGAGREEMENTSTATUS: 'Canceled',
            NOTIFYURL: notifyUrl,
            REFERENCEID: key
        };

        var request = {
            protocol: 'https:',
            method: 'POST',
            uri: '/nvp',
            body: qs.stringify(body),
            json: false
        };
        HttpClient.doRequest({
            ns: 'ExpressCheckout::cancelBillingAgreement',
            connection: 'paypalEC',
            request: request
        }, (error, response) => {
            return processResponse(error, response, callback);
        });

        // {
        //     BILLINGAGREEMENTID: 'B-XXXXXXXXXXXXXXXXX',
        //     BILLINGAGREEMENTDESCRIPTION: 'This is a description!',
        //     BILLINGAGREEMENTSTATUS: 'Canceled',
        //     BILLINGAGREEMENTCUSTOM: '{"foo":"bar"}',
        //     TIMESTAMP: '2016-03-23T20:04:50Z',
        //     CORRELATIONID: 'XXXXXXXXXXXXX',
        //     ACK: 'Success',
        //     VERSION: '86',
        //     BUILD: '11111111',
        //     EMAIL: 'xxx@xxx.com',
        //     PAYERID: 'XXXXXXXXXXXXX',
        //     PAYERSTATUS: 'verified',
        //     FIRSTNAME: 'John',
        //     LASTNAME: 'Doe',
        //     COUNTRYCODE: 'CA',
        //     ADDRESSID: 'PayPal'
        // }
    }

    doReferenceTransaction(key, amount, custom, notifyUrl, callback) {
        if (typeof custom == 'object')
            custom = JSON.stringify(custom);
        // { VERSION: '86',
        //   METHOD: 'DoReferenceTransaction',
        //   PAYMENTACTION: 'SALE',
        //   PAYMENTTYPE: 'InstantOnly',
        //   REQCONFIRMSHIPPING: '0',
        //   AMT: '50.00',
        //   CUSTOM: '{"foo":"bar"}',
        //   NOTIFYURL: 'http://xxx.com/ipn',
        //   REFERENCEID: 'B-XXXXXXXXXXXXXXXXX' }
        var body = {
            USER: this._username,
            PWD: this._password,
            SIGNATURE: this._signature,
            VERSION: 86,

            METHOD: 'DoReferenceTransaction',
            PAYMENTACTION: 'SALE',
            PAYMENTTYPE: 'InstantOnly',
            REQCONFIRMSHIPPING: 0,
            AMT: parseFloat(amount),
            CUSTOM: custom,
            NOTIFYURL: notifyUrl,
            REFERENCEID: key
        };

        var request = {
            protocol: 'https:',
            method: 'POST',
            uri: '/nvp',
            body: qs.stringify(body),
            json: false
        };
        HttpClient.doRequest({
            ns: 'ExpressCheckout::doReferenceTransaction',
            connection: 'paypalEC',
            request: request
        }, (error, response) => {
            return processResponse(error, response, callback);
        });

        // {
        //     BILLINGAGREEMENTID: 'B-XXXXXXXXXXXXXXXXX',
        //     TIMESTAMP: '2016-03-23T20:00:46Z',
        //     CORRELATIONID: 'XXXXXXXXXXXXX',
        //     ACK: 'Success',
        //     VERSION: '86',
        //     BUILD: '11111111',
        //     TRANSACTIONID: 'XXXXXXXXXXXXXXXXX',  // store for record keeping
        //     TRANSACTIONTYPE: 'merchtpmt',
        //     PAYMENTTYPE: 'instant',
        //     ORDERTIME: '2016-03-23T20:00:45Z',
        //     AMT: '50.00',
        //     FEEAMT: '2.25',
        //     TAXAMT: '0.00',
        //     CURRENCYCODE: 'USD',
        //     PAYMENTSTATUS: 'Completed',
        //     PENDINGREASON: 'None',
        //     REASONCODE: 'None',
        //     PROTECTIONELIGIBILITY: 'Ineligible',
        //     PROTECTIONELIGIBILITYTYPE: 'None'
        // }
    }
}

function processResponse(error, response, callback) {
    if (error) return callback(error);

    var body = response.body;
    try {
        body = qs.parse(response.body);
    } catch (e) {
        var err = new Error('Invalid Response Received');
        err.code = response.statusCode;
        err.details = body;
        return callback(err, body);
    }

    if (/^(Success|SuccessWithWarning)$/.test(body.ACK)) {
        return callback(null, body);
    } else {
        var err = new Error(body.L_SHORTMESSAGE0);
        err.code = body.L_ERRORCODE0;
        err.details = body;
        return callback(err, body);
    }
}

module.exports = ExpressCheckout;
