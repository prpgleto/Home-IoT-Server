// Logger
var logger = require('./modules/logs');

logger.write.info('Home-IoT-Server application start runing');

// Project moduls 
var devicesHandler = require('./modules/devices');
var eventsHandler = require('./modules/events');
var timingHandler = require('./modules/timing');
var securityHandler = require('./modules/security');
var lanManagerHandler = require('./modules/lanManager');

// Depenencies moduls
var express = require('express');
var app = express();
var https = require('https');
var http = require('http');
var fs = require('fs');
var forceSsl = require('express-force-ssl');
var cookieParser = require('cookie-parser');
var bodyParser = require('body-parser');
var SSE = require('express-sse');
var useragent = require('express-useragent');

// SSL/HTTPS area
var USE_HTTPS = false;
if (USE_HTTPS) {
  var key = fs.readFileSync('encryption/private.key');
  var cert = fs.readFileSync('encryption/certificate.crt');
  var ca = fs.readFileSync('encryption/ca_bundle.crt');

  var options = {
    key: key,
    cert: cert,
    ca: ca
  };

  app.use(forceSsl); // Use to redirect http to https/ssl 
}


// MiddelWhare Area 

// Parse every request body to json
app.use(cookieParser());
app.use(bodyParser.json()); // for parsing application/json
app.use(bodyParser.urlencoded({ extended: true })); // for parsing application/x-www-form-urlencoded
app.use(useragent.express());
app.use('/static', express.static('public')); // serve every static file in public folder
app.use(function (req, res, next) { // middelwhere for security
  if (req.url == '/check-live') {
    res.send('live');
    return;
  }
  else if (req.url == '/' ||
    req.url.indexOf('static') != -1 ||
    req.url == '/login' ||
    req.url == '/logout') { // it login logout or static file continue
    next();
    return;
  }
  securityHandler.CheckAccess(req, res, () => {
    next();
  });
})

// Server API routing

// Access API

// Login
// body should be { userName : 'theUserName', password : 'thePassword' } 
app.post('/login', function (req, res) {
  logger.write.debug('requset POST  /login arrived');
  var params = req.body;
  securityHandler.CheckIn(req, res, params.userName, params.password, (result) => {
    if (result) {
      logger.write.info('user: ' + params.userName + ' connected seccessfuly');
      res.send(`you connected seccessfuly`);
    }
    else {
      logger.write.info('user: ' + params.userName + ' try to enter without success');
      res.statusCode = 403;
      res.send(`you send wrong password`)
    }
  });
});

// Logout 
app.post('/logout', function (req, res) {
  logger.write.debug('requset POST  /logout arrived');
  logger.write.info('user logout seccessfuly');
  securityHandler.CheckOut(req, res);
  res.send(`Logout seccessfuly`);
});

// Logout for all users and connectd ip`s
app.post('/logout/all', function (req, res) {
  logger.write.debug('requset POST /logout/all arrived');
  securityHandler.ClearCache(req, (err) => {
    if (err) {
      res.statusCode = 503;
      logger.write.warn('Error with requset POST /logout/all ,' + err);
    }
    res.send(err ? err : `Logout all seccessfuly`);
  });
});


// RESTful API

// Devices API

// Get all devices 
app.get('/devices', (req, res) => {
  logger.write.debug('requset GET  /devices arrived');
  devicesHandler.GetDevices((devices, err) => {
    if (err) {
      res.statusCode = 503;
      logger.write.warn('Error with requset GET  /devices ,' + err);
    }
    res.send(!err ? devices : err);
  });
});

// Get device by id
app.get('/devices/:id', (req, res) => {
  logger.write.debug('requset GET  /devices/' + req.params.id + ' arrived');
  devicesHandler.GetDevice(req.params.id, (device, err) => {
    if (err) {
      res.statusCode = 503;
      logger.write.warn('Error with requset GET  /devices/' + req.params.id + ' ,' + err);
    }
    res.send(!err ? device : err);
  });
});

// Change devices value by id
app.put('/devices/:id', (req, res) => {
  logger.write.debug('requset PUT  /devices/' + req.params.id + ' arrived');
  var params = req.body;
  var value;
  try {
    if ((typeof params.value) == 'string')
      value = JSON.parse(params.value);
    else
      value = params.value;
  } catch (error) {
    if (params.type == 'switch') {
      value = params.value;
    } else {
      res.statusCode = 503;
      logger.write.error('param value parsing error');
      res.send('param value parsing error');
      return;
    }
  }

  devicesHandler.SetDeviceProperty(req.params.id, params.type, value, (err) => {
    if (err) {
      res.statusCode = 503;
      logger.write.warn('Error with requset PUT  /devices/' + req.params.id + ' ,' + err);
    }
    res.send(err);
  });
});

// Refresh data of deviced (read angin all deviced status)
app.post('/refresh', function (req, res) {
  logger.write.debug('requset POST  /refresh arrived');
  devicesHandler.RefreshDevicesData((err) => {
    if (err) {
      res.statusCode = 503;
      logger.write.warn('Error with requset POST  /refresh ,' + err);
    }
    res.send(err);
  });
});

// Events API

// Trigger event by its id
app.post('/events/invoke/:id', (req, res) => {
  logger.write.debug('requset POST  /events/invoke/' + req.params.id + ' arrived');
  eventsHandler.InvokeEvent(req.params.id, (err) => {
    if (err) {
      res.statusCode = 503;
      logger.write.warn('Error with requset POST  /events/invoke/' + req.params.id + ' ,' + err);
    }
    res.send(err);
  });
});

// Get all events
app.get('/events', (req, res) => {
  logger.write.debug('requset GET  /events arrived');
  eventsHandler.GetEvents((events, err) => {
    if (err) {
      res.statusCode = 503;
      logger.write.warn('Error with requset GET  /events ,' + err);
    }
    res.send(!err ? events : err)
  });
});

// Send new event
app.post('/events', (req, res) => {
  logger.write.debug('requset POST  /events arrived');
  var params = req.body;

  var name = params.name;
  var actions = params.actions;

  var hasError = false;

  // chack params
  try {
    if ((typeof actions) == 'string')
      actions = JSON.parse(actions);

    hasError = !eventsHandler.ActionsValidation(actions);
  } catch (error) {
    hasError = true;
  }

  if (hasError) {
    res.statusCode = 503;
    res.send('params errer');
    return;
  }

  eventsHandler.CreateEvent(name, actions, (err) => {
    if (err) {
      res.statusCode = 503;
      logger.write.warn('Error with requset POST  /events ,' + err);
    }
    res.send(err)
  });
});

// change event 
app.put('/events/:id', (req, res) => {
  logger.write.debug('requset PUT  /events/' + req.params.id + ' arrived');
  var params = req.body;

  var name = params.name;
  var actions = params.actions;

  var hasError = false;

  // check params
  try {
    var actions = (typeof actions == 'string') ? JSON.parse(actions) : actions;
    hasError = !eventsHandler.ActionsValidation(actions);
  } catch (error) {
    hasError = true;
  }

  if (hasError) {
    res.statusCode = 503;
    res.send('params errer');
    return;
  }

  eventsHandler.EditEvent(req.params.id, name, actions, (err) => {
    if (err) {
      res.statusCode = 503;
      logger.write.warn('Error with requset PUT  /events/' + req.params.id + ' ,' + err);
    }
    res.send(err)
  });
});

// delete event by its id
app.delete('/events/:id', function (req, res) {
  logger.write.debug('requset DELETE  /events/' + req.params.id + ' arrived');

  eventsHandler.DeleteEvent(req.params.id, (err) => {
    if (err) {
      res.statusCode = 503;
      logger.write.warn('Error with requset DELETE  /events/' + req.params.id + ' ,' + err);
    }
    res.send(err);
  });
});



// Timings API

// Get all timings
app.get('/timings', (req, res) => {
  logger.write.debug('requset GET  /timings arrived');
  timingHandler.GetTimings((timings, err) => {
    if (err) {
      res.statusCode = 503;
      logger.write.warn('Error with requset GET  /timings ,' + err);
    }
    res.send(!err ? timings : err)
  });
});

// Send new timings
app.post('/timings', (req, res) => {
  logger.write.debug('requset POST  /timings arrived');
  var timing = req.body;

  var hasError = false;

  // chack params
  try {
    if ((typeof timing) == 'string')
      timing = JSON.parse(timing);

    hasError = !timingHandler.TimingValidation(timing);
  } catch (error) {
    hasError = true;
  }

  if (hasError) {
    res.statusCode = 503;
    res.send('params errer');
    return;
  }

  timingHandler.CreateTiming(timing, (err) => {
    if (err) {
      res.statusCode = 503;
      logger.write.warn('Error with requset POST  /timings ,' + err);
    }
    res.send(err)
  });
});

// change timings 
app.put('/timings/:id', (req, res) => {
  logger.write.debug('requset PUT  /timings/' + req.params.id + ' arrived');
  var params = req.body;

  var timing = params;

  // chack params
  try {
    if ((typeof timing) == 'string')
      timing = JSON.parse(timing);

    hasError = !timingHandler.TimingValidation(timing);
  } catch (error) {
    hasError = true;
  }

  if (hasError) {
    res.statusCode = 503;
    res.send('params errer');
    return;
  }

  timingHandler.EditTiming(req.params.id, timing, (err) => {
    if (err) {
      res.statusCode = 503;
      logger.write.warn('Error with requset PUT  /timings/' + req.params.id + ' ,' + err);
    }
    res.send(err)
  });
});

// delete timings by its id
app.delete('/timings/:id', function (req, res) {
  logger.write.debug('requset DELETE  /timings/' + req.params.id + ' arrived');

  timingHandler.DeleteTiming(req.params.id, (err) => {
    if (err) {
      res.statusCode = 503;
      logger.write.warn('Error with requset DELETE  /timings/' + req.params.id + ' ,' + err);
    }
    res.send(err);
  });
});

// Nenwork & devices managing 
app.get('/network', function (req, res) {
  logger.write.debug('requset GET /network arrived');

  lanManagerHandler.GetLastLanNetworkDevicesInfo((networkDevices) => {
    res.send(networkDevices);
  })
});

app.post('/network/refresh', function (req, res) {
  logger.write.debug('requset POST /network/refresh arrived');

  lanManagerHandler.ScanLanNetworkDevicesInfo((lanDevices, err) => {
    if (err) {
      res.statusCode = 503;
      logger.write.warn('Error with requset POST /network/refresh ,' + err);
    }
    res.send(err ? err : lanDevices);
  })
});


app.post('/network/:mac/:name', function (req, res) {
  logger.write.debug('requset POST /network/' + req.params.mac + '/' + req.params.name + ' arrived');

  lanManagerHandler.SetLanDeviceName(req.params.mac, req.params.name, (err) => {
    if (err) {
      res.statusCode = 503;
      logger.write.warn('Error with requset POST /network/' + req.params.mac + '/' + req.params.name + ' ,' + err);
    }
    res.send(err);
  })
});

// TODO: add option to create device by it and not by tuching json device file
// Logs API

app.get('/logs/:security/:rows', function (req, res) {
  logger.write.debug('requset GET /logs/' + req.params.security + '/' + req.params.rows + ' arrived');

  logger.read(req.params.security == 1, req.params.rows, (logs, err) => {
    if (err) {
      res.statusCode = 503;
      logger.write.warn('Error with requset GET /logs/' + req.params.security + '/' + req.params.security + ' ,' + err);
    }
    res.send(!err ? logs : err);
  });
});

// Server send event (SSE) Area

// Init the sse objects
var devicesSse = new SSE(['init'], { isSerialized: true });
var timingsSse = new SSE(['init'], { isSerialized: true });
var timingTriggeredSse = new SSE(['init'], { isSerialized: true });

// SSE object to get push notifications updates of devices changes
app.get('/devices-feed', devicesSse.init);
app.get('/timings-feed', timingsSse.init);
app.get('/timing-triggered-feed', timingTriggeredSse.init);

// Registar to devices push updates  
devicesHandler.UpdateChangesEventRegistar((id, data) => {
  logger.write.info('event sent to all clients about device id:' + id)
  devicesSse.send({ 'deviceID': id, 'data': data });
})

// Registar to timings push updates  
timingHandler.UpdateChangesTimingsRegistar((timings) => {
  logger.write.info('send the new timings struct to clients')
  timingsSse.send(timings);
})
timingHandler.UpdateTimingEventsRegistar((id, timing, err) => {
  logger.write.info('timing event triggerd data sent to all clients')
  timingTriggeredSse.send({ timingId: id, timing: timing, err: err });
})

// Other API 
var publicPath = __dirname + '/public/';

// Get home page
app.get('/', function (req, res) {
  res.sendFile(publicPath + 'index.html');
});

// Unknowon routing get 404
app.get('*', function (req, res) {
  res.sendFile(publicPath + '404.html');
});

// Start application

var httpsPort = 443;
// Listen omn port 3000 or port that host give 
var httpPort = (process.env.PORT || 3000);

if (USE_HTTPS) {
  https.createServer(options, app).listen(httpsPort, () => {
    logger.write.info('home IoT server with HTTPS/SSL run on port ' + httpsPort);
  });
}

http.createServer(app).listen(httpPort, () => {
  logger.write.info('home IoT server with HTTP run on port ' + httpPort);
});

