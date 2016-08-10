var watson = require('watson-developer-cloud');
var fs = require('fs');
var mic = require('mic');
var Forecast = require('forecast');
var wav = require('wav');
var Speaker = require('speaker');
var Sound = require('node-aplay');
var Q = require('q');
var moment = require('moment');

var forecastKey = process.env.FORECAST_KEY;
var speechToTextUsername = process.env.STT_USERNAME;
var speechToTextPassword = process.env.STT_PASSWORD;
var textToSpeechUsername = process.env.TTS_USERNAME;
var textToSpeechPassword = process.env.TTS_PASSWORD;
 
var forecast = new Forecast({
  service: 'forecast.io',
  key: forecastKey,
  units: 'celcius', // Only the first letter is parsed 
  cache: true,      // Cache API requests? 
  ttl: {            // How long to cache requests. Uses syntax from moment.js: http://momentjs.com/docs/#/durations/creating/ 
    minutes: 27,
    seconds: 45
    }
});

var micInstance = mic({ 'rate': '44100', 'channels': '1', 'debug': true, exitOnSilence: 10 });
var micInputStream = micInstance.getAudioStream();
 
var outputFileStream = fs.WriteStream('command.wav');

var speech_to_text = watson.speech_to_text({
  password: speechToTextPassword,
  username: speechToTextUsername,
  version: 'v1'
});

var text_to_speech = watson.text_to_speech({
  password: textToSpeechPassword,
  username: textToSpeechUsername,
  version: 'v1'
});
 
micInputStream.pipe(outputFileStream);


/**
 * PROCESS INCOMING COMMANDS
 */

var contextCommand;
 
micInputStream.on('data', function(data) {
  console.log("Recieved Input Stream: " + data.length);
});
 
micInputStream.on('error', function(err) {
  console.log("Error in Input Stream: " + err);
});
 
micInputStream.on('startComplete', function() {
  console.log("Got SIGNAL startComplete");
});
    
micInputStream.on('pauseComplete', function() {
  console.log("Got SIGNAL pauseComplete");
  var params = {
    audio: fs.createReadStream('./command.wav'),
    content_type: 'audio/l16; rate=44100'
  };

  speech_to_text.recognize(params, function(err, res) {
    if (err) {
      console.log(err);
      return;
    }
    if (!res.results[0]) {
      return; 
    }
    if (res.results[0].alternatives.length > 1) {
      console.log('more than one alternative found!');
      console.log(res.results[0].alternatives);
    } else {
      respond(res.results[0].alternatives[0].transcript)
    } 

    micInstance.resume();
  });          
});

micInputStream.on('silence', function() {
  console.log("Got SIGNAL silence, stopping");
  micInstance.pause();
});
 
micInputStream.on('processExitComplete', function() {
  console.log("Got SIGNAL processExitComplete");
});
 
/** 
 *  STARTUP
 */

var startupText = "Computer active, awaiting query."

var startupTextParams = {
  text: startupText,
  voice: 'en-US_AllisonVoice', // Optional voice
  accept: 'audio/wav'
};

// Pipe the synthesized text to a file
var speechPipe = text_to_speech.synthesize(startupTextParams).pipe(fs.createWriteStream('./startup.wav')); 

speechPipe.on('finish', function () {
  var startupSound = new Sound('./startup.wav');
  startupSound.play();
  startupSound.on('complete', function () {
    console.log('sound played');
    micInstance.start();
  });
});


/**
 * RESPONSE
 */


function respond(text) {
  var trimmed = text.toLowerCase().trim();
  console.log(trimmed);

  if (contextCommand) {
    return processContextCommand(trimmed); 
  }

  if (trimmed.indexOf('weather') > -1) {
    return processWeather(trimmed);
  }

  if (trimmed.indexOf('create') > -1) {
    return processCreate(trimmed); 
  }

  return processUnknown(trimmed);
}

function processUnknown(text) {
  var deferred = Q.defer();
  var response = "Unknown command: " + text;

  processResponse(response).then(function () {
    deferred.resolve(); 
  });

  return deferred.promise;
}

function processContextCommand(trimmed) {
  if (contextCommand == 'newNote') {
    return createNewNote(trimmed);
  }
}

function processCreate(text) {
  if (text.indexOf('note') > -1) {
    return processTextDirectory('~/notes', text);
  }
}

function processTextDirectory(path, text) {
  if (text.indexOf('create') > -1) {
    contextCommand = 'newNote'; 

    var now = moment();
    return processResponse("Creating new note for " + buildSpokenDate());
  }
}


function processWeather(text) {
  var deferred = Q.defer();
  var response;

  forecast.get([40.7128, 74.0059], function (err, weather) {
    if (err) {
      deferred.reject(err);
      return; 
    } 

    //console.log(weather);

    if (text.indexOf('today') > -1) {
      console.log('today is present');
      response = weather.daily.summary;
    }

    console.log(response);

    processResponse(response).then(function () {
      deferred.resolve(); 
    });
  });

  return deferred.promise;
}

function processResponse(text) {
  var deferred = Q.defer();

  var responseTextParams = {
    text: text,
    voice: 'en-US_AllisonVoice', // Optional voice
    accept: 'audio/wav'
  };

  // Pipe the synthesized text to a file
  var responseStream = text_to_speech.synthesize(responseTextParams).pipe(fs.createWriteStream('response.wav')); 
  responseStream.on('finish', function () {
    var startupSound = new Sound('response.wav');
    startupSound.play();
    startupSound.on('complete', function () {
      deferred.resolve();
    });
  });

  return deferred.promise;
}

function createNewNote(text) {
  var deferred = Q.defer();
  var fileName = "~/notes/" + buildReadableDate() + ".txt";
  fs.writeFile(fileName, text, function (err) {
    if (err) {
      deferred.reject(err); 
    } 

    processResponse("Note saved.").then(function () {
      clearContext();
      deferred.resolve();
    });
  });

  return deferred.promise;
}

function buildSpokenDate() {
  var now = moment();
  return now.format("MMMM") + " " + now.format("Do") + " " + now.format("YYYY");
}

function buildReadableDate() {
  var now = moment();
  return now.format("MM") + " " + now.format("DD") + " " + now.format("YYYY");
}

function clearContext() {
  commandContext = null;
}
