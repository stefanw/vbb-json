#!/usr/bin/env node

var express = require('express');
var app = express();

var vbb = require('./lib/vbb').VBB();

app.get('/', function(req, res){
  vbb.trip({
    start: req.query.start || "Potsdam Hbf",
    destination: req.query.destination || "Boddinstraße",
    time: req.query.time || new Date().toTimeString().split(' ')[0],
    date: req.query.date || new Date().toISOString().split('T')[0]
  }, function(err, xml, json){
    res.setHeader('Content-Type', 'application/json; charset=UTF-8');
    res.end(JSON.stringify(json));
  });
});

app.listen(3000);
console.log('Listening on port 3000');