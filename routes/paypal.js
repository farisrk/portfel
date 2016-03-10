"use strict";

var https = require('https');
var qs = require('querystring');
var express = require('express');
var router = express.Router();
var PayPalModel = require('../models/PayPal').PayPalDAO;

router.post(/ipn/, (req, res, next) => {
    // make sure request contains data in the body
    var params = req.body;
    if (!params) {
        return next(new Error('The IPN body is empty'));
    }
    // make sure this isn't a test IPN in production environment
    if (params.test_ipn && !global.options.paypal.sandbox) {
        return next(new Error('Received request with test_ipn parameter while sandbox is disabled'));
    }
    // respond to paypal
    res.status(200).send();

    var body = qs.stringify(params);
    var options = {
        method: 'POST',
        host: global.options.paypal.ipn.verify,
        path: '/cgi-bin/webscr?cmd=_notify-validate',
        headers: {
            'Content-Length': body.length
        }
    };
    var request = https.request(options, (response) => {
        var data = [];

        response.on('data', (d) => {
            data.push(d);
        });
        response.on('end', () => {
            var result = data.join('');

            PayPalModel.logIPN(params);
            if (result === 'VERIFIED') return next(null, result);
            else return next(new Error('IPN verification status: ' + result));
        });
    });
    request.write(body);
    request.on('error', next);
    request.end();
});

module.exports = router;
