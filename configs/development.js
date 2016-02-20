// var path = require('path'),
//     basePath = path.resolve(__dirname, '..');

module.exports = {
    host: 'fk-server.airg.us',
    port: 3000,
    paypal: {
        sandbox: true,
        api: {
            appId: 'APP-80W284485P519543T',
            userId: 'farisk-facilitator_api1.airg.com',
            email: 'farisk-facilitator@airg.com',
            password: '1366916198',
            signature: 'AYx57PI7lkdv0jITVY0Oi9NoZTw7Avfc.HjuYn2QAfW4xDlCpBNUdBua'
        },
        preapproval: {
            endpoint: 'https://svcs.sandbox.paypal.com/AdaptivePayments/Preapproval',
            redirect: 'https://www.sandbox.paypal.com/webapps/adaptivepayment/flow/preapproval?preapprovalKey=%s&expType=redirect'

        },
        ipn: {
            verify: 'www.sandbox.paypal.com',
            preapproval: 'http://fk-server.airg.us/1/paypal/adaptivepayment/ipn',
            //pay: 'http://fk-server.airg.us/1/paypal/adaptivepayment/ipn'
            pay: 'http://api.im.airg.us/1/paypal/'
        },
        immediateCharge: false,
        multiplePreapprovals: true,
        currencyCode: 'USD'
    },
    transactions: {
        host: 'http://api.im.airg.us:8450',
        create: {
            uri: '/1/paypal/:userId'
        },
        update: {
            uri: '/1/transactions/:userId/:guid'
        }

    }

    // accessControl: {
    //     allowOrigin: '*',
    //     allowMethods: 'OPTIONS, HEAD, GET, POST, PUT, DELETE',
    //     allowHeaders: 'Content-Type, Content-Range, Content-Disposition'
    // },
    // nodeStatic: {
    //     cache: 3600
    // }
};
