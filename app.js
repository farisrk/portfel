var express = require('express');
var path = require('path');
var favicon = require('serve-favicon');
var logger = require('morgan');
var cookieParser = require('cookie-parser');
var bodyParser = require('body-parser');
var qs = require('querystring');

// get the working environment
var env = process.env.NODE_ENV;
if (['development', 'production'].indexOf(env) === -1) {
    Log.error("Please specify node enviroment: NODE_ENV");
    process.exit(1);
}
global.options = require('./configs/' + env);

var routes = require('./routes/index');
var paypal = require('./routes/paypal');
var adaptivePayments = require('./routes/adaptivePayments');

var MongoDB = require('./libs/database/MongoDB').MongoDB;
MongoDB.connect('mongodb://mongodb.test.office.airg.lan:27017/Wallet', (err) => {
    if (err) {
        console.log('Unable to connect to Mongo.')
        process.exit(1)
    }
});

var app = express();

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'hjs');

// uncomment after placing your favicon in /public
//app.use(favicon(path.join(__dirname, 'public', 'favicon.ico')));
app.use(logger('dev'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/', routes);
app.use('/1/paypal', paypal);
app.use('/1/paypal/adaptivepayment', adaptivePayments);

// catch 404 and forward to error handler
app.use((req, res, next) => {
  var err = new Error('Not Found');
  err.status = 404;
  next(err);
});

// error handlers

// development error handler
// will print stacktrace
if (app.get('env') === 'development') {
  app.use((err, req, res, next) => {
    res.status(err.status || 500);
    res.render('error', {
      message: err.message,
      error: err
    });
  });
}

// production error handler
// no stacktraces leaked to user
app.use((err, req, res, next) => {
    if (!res.headersSent) {
        res.status(err.status || 500);
        res.render('error', {
            message: err.message,
            error: {}
        });
    } else {
      console.error("Ended up with error router with the headers being already sent!");
    }
});


module.exports = app;