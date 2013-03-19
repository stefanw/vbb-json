var request = require('request');
var async = require('async');
var dom = require('xmldom').DOMParser;
var select = require('xpath.js');
var Iconv  = require('iconv').Iconv;
var iconv = new Iconv('ISO-8859-1', 'UTF8');
var fs = require('fs');


var templates = {
  station: '<?xml version="1.0" encoding="ISO-8859-1"?>'+
'<ReqC lang="DE" prod="String" accessId="#accessId#" ver="1.1">'+
'  <LocValReq id="L" maxNr="10" sMode="1">'+
'    <ReqLoc match="#name#" type="ALLTYPE"/>'+
'  </LocValReq>'+
'</ReqC>',

  trip: '<?xml version="1.0" encoding="iso-8859-1"?>'+
'<ReqC ver="1.1" prod="String" rt="yes" lang="DE" accessId="#accessId#">'+
'    <ConReq deliverPolyline="1">'+
'        <Start>'+
'            <Station name="#startname#"  externalId="#start#" />'+
'            <Prod prod="1111111111111111" bike="0" couchette="0" direct="0" sleeper="0" />'+
'        </Start>'+
'        <Dest>'+
'            <Station name="#destinationname#" externalId="#destination#" />'+
'        </Dest>'+
'        <ReqT a="0"  time="#time#" date="#date#" />'+
'        <RFlags b="1" f="5" chExtension="0" sMode="N" nrChanges="2" getPrice="1" />'+
'    </ConReq>'+
'</ReqC>'
};

DEBUG = false;

var convertCoord = function(val) {
  return parseFloat(val) / 1000000;
};

var getData = function(node) {
  return node ? node.data : null;
};

var strip = function(val) {
  if (val) {
    return val.replace(/^\s*(.*?)\s*$/, '$1');
  }
  return val;
};

var makeTimestamp = function(date, time) {
  time = strip(time);
  date = strip(date);
  var daysHours = time.split('d');
  var days = parseInt(daysHours[0], 10);
  var timestamp = date.substring(0, 4) + '-' + date.substring(4, 6) + '-' + date.substring(6, 8) + 'T';
  timestamp += daysHours[1];
  timestamp = new Date(timestamp);
  if (days > 0) {
    timestamp = new Date(timestamp.getTime() + 1000 * 60 * 60 * 24 * days);
  }
  return timestamp.toISOString();
};

exports.VBB = function(options) {
  options = options || {};
  options.endpoint = options.endpoint || 'http://demo.hafas.de/bin/pub/vbb-fahrinfo/relaunch2011/extxml.exe/';
  options.accessId = options.accessId || '951a204d5462906e60494ed0a7a79ff5';

  var getStationRequest = function(name) {
    return function(callback) {
      var body = templates.station
        .replace(/#accessId#/g, options.accessId)
        .replace(/#name#/g, name);
      makeRequest(options.endpoint, body, function(err, body){
        callback(null, parseStationRequestBody(body));
      });
    };
  };

  return {
    trip: function(config, clb) {
      async.parallel([
          getStationRequest(config.start),
          getStationRequest(config.destination)
        ],
        function(err, results){
          var body = templates.trip
            .replace(/#accessId#/g, options.accessId)
            .replace(/#time#/g, config.time)
            .replace(/#date#/g, config.date.replace(/\-/g, ''))
            .replace(/#startname#/g, results[0].stations[0].name)
            .replace(/#start#/g, results[0].stations[0].id)
            .replace(/#destinationname#/g, results[1].stations[0].name)
            .replace(/#destination#/g, results[1].stations[0].id);
          if (DEBUG) {
            body = fs.readFileSync('examples/response.xml', 'UTF-8');
            return clb(null, body, parseTripRequestBody(body));
          }
          makeRequest(options.endpoint, body, function(err, body){
            if (err) {
              return clb(err);
            }
            clb(null, body, parseTripRequestBody(body));
          });
        }
      );
    }
  };
};

var makeRequest = function(endpoint, body, clb){
  request({
    url: endpoint,
    method: 'POST',
    body: body,
    encoding: null
  }, function (error, response, body) {
    if (error) {
      return clb(error);
    }
    if (response.statusCode != 200) {
      return clb(new Error(response));
    }
    body = iconv.convert(body).toString();
    clb(null, body);
  });
};


var parseStationRequestBody = function(body) {
  var doc = new dom().parseFromString(body);
  var stationNodes = select(doc, "//Station"), stations = [];
  for (var i = 0; i < stationNodes.length; i += 1) {
    stations.push({
      name: select(stationNodes[i], './@name')[0].value,
      id: select(stationNodes[i], './@externalId')[0].value
    });
  }
  return {
    stations: stations
  };
};

var parseBasicStop = function(stop, date) {
  station = select(stop, ".//Station");
  if (station.length) {
    var arrival = null, arrivalPlatform = null;
    var departure = null, departurePlatform = null;
    if (select(stop, ".//Arr").length) {
      arrival = makeTimestamp(date, select(stop, ".//Arr/Time/text()")[0].data);
      arrivalPlatform = strip(getData(select(stop, ".//Arr/Platform/Text/text()")[0]));
    }
    if (select(stop, ".//Dep").length) {
      departure = makeTimestamp(date, select(stop, ".//Dep/Time/text()")[0].data);
      departurePlatform = strip(getData(select(stop, ".//Dep/Platform/Text/text()")[0]));
    }
    return {
      name: select(stop, ".//Station/@name")[0].value,
      id: select(stop, ".//Station/@externalId")[0].value,
      lat: convertCoord(select(stop, ".//Station/@y")[0].value),
      lng: convertCoord(select(stop, ".//Station/@x")[0].value),
      arrival: arrival,
      arrivalPlatform: arrivalPlatform,
      departure: departure,
      departurePlatform: departurePlatform
    };
  }
};


var parseTripRequestBody = function(body) {
  var doc = new dom().parseFromString(body);
  var connections = select(doc, "//Connection");
  var conJson = [];
  for (var i = 0; i < connections.length; i += 1) {
    var date = select(connections[i], './/Overview/Date/text()')[0].data;
    var sections = select(connections[i], './/ConSection');
    var secJson = [];
    for (var j = 0; j < sections.length; j += 1) {
      var section = sections[j];
      var journey = [];
      var stops = select(section, './/Journey/PassList/BasicStop');
      for (var k = 0; k < stops.length; k += 1) {
        journey.push(parseBasicStop(stops[k], date));
      }
      secJson.push({
        departure: {
          name: select(section, ".//Departure//Station/@name")[0].value,
          id: select(section, ".//Departure//Station/@externalId")[0].value,
          lat: convertCoord(select(section, ".//Departure//Station/@y")[0].value),
          lng: convertCoord(select(section, ".//Departure//Station/@x")[0].value),
          time: makeTimestamp(date, select(section, ".//Departure//Dep/Time/text()")[0].data),
          platform: strip(getData(select(section, ".//Departure//Dep/Platform/Text/text()")[0]))
        },
        arrival: {
          name: select(section, ".//Arrival//Station/@name")[0].value,
          id: select(section, ".//Arrival//Station/@externalId")[0].value,
          lat: convertCoord(select(section, ".//Arrival//Station/@y")[0].value),
          lng: convertCoord(select(section, ".//Arrival//Station/@x")[0].value),
          time: makeTimestamp(date, select(section, ".//Arrival//Arr/Time/text()")[0].data),
          platform: strip(getData(select(section, ".//Arrival//Arr/Platform/Text/text()")[0]))
        },
        journey: journey,
        transport: {
          name: strip(select(section, ".//Journey//Attribute[@type='NAME']//Text/text()")[0].data),
          direction: strip(select(section, ".//Journey//Attribute[@type='DIRECTION']//Text/text()")[0].data)
        }
      });
    }
    conJson.push({
      sections: secJson
    });
  }
  return conJson;
};