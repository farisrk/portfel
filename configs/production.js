"use strict";

module.exports = {
    host: 'xxx',
    port: 3000,
    paypal: {
        sandbox: true,
        api: {
            appId: 'xxx',
            userId: 'xxx',
            email: 'xxx',
            password: 'xxx',
            signature: 'xxx'
        },
        preapproval: {
            endpoint: 'https://svcs.sandbox.paypal.com/AdaptivePayments/Preapproval',
            redirect: 'https://www.sandbox.paypal.com/webapps/adaptivepayment/flow/preapproval?preapprovalKey=%s&expType=redirect'

        },
        ipn: {
            verify: 'www.sandbox.paypal.com',
            preapproval: 'http://xxx',
            pay: 'http://xxx'
        },
        immediateCharge: false,
        multiplePreapprovals: false,
        currencyCode: 'USD'
    },
    wallet: {
        host: 'http://xxx:3000',
        createTransaction: {
            method: 'POST',
            uri: '/1/paypal/:userId'
        },
        updateTransaction: {
            method: 'POST',
            uri: '/1/transactions/:userId/:guid'
        },
        updateBalance: {
            method: 'POST',
            uri: '/1/wallets/:userId'
        },
        getPricelist: {
            method: 'GET',
            uri: '/1/pricepoints/paypal/us/:purchaseKey'
        }
    },
    beanstalk: [
        {
            "tube": "wallet",
            "name": "wallet",
            "host": "xxx",
            "port": "11300"
        }
    ],
    mongo: [
        {
            "host": "xxx",
            "port": "27017",
            "database": "Wallet",
            "connectionName": "wallet",
            "collections": [
                "PreApprovals",
                "Payments",
                "PointsErrors"
            ]
        }
    ]
};
