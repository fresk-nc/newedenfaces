'use strict';

require('babel-register');

const path = require('path');
const express = require('express');
const logger = require('morgan');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const swig  = require('swig');
const React = require('react');
const ReactDOM = require('react-dom/server');
const Router = require('react-router');
const co = require('co');
const got = require('got');

const config = require('./config');
const routes = require('./app/routes');
const Character = require('./models/character');
const xml2json = require('./xml2json');

const app = express();

mongoose.connect(config.database);
mongoose.connection.on('error', () => {
  console.info('Error: Could not connect to MongoDB. Did you forget to run `mongod`?');
});

app.set('port', process.env.PORT || 3000);
app.use(logger('dev'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/characters', (req, res, next) => {
    co(function * () {
        let gender = req.body.gender;
        let characterName = req.body.name;
        let characterIdLookupUrl = `https://api.eveonline.com/eve/CharacterID.xml.aspx?names=${characterName}`;
        let characterId = yield got(characterIdLookupUrl)
            .then((res) => xml2json(res.body))
            .then((data) => {
                return data.result[0].rowset[0].row[0].$.characterID;
            });

        if (!characterId || characterId == 0) {
            return res.status(404).send({
                message: `${characterName} is not a registered citizen of New Eden.`
            });
        }

        let character = yield Character.findOne({characterId: characterId});

        if (character) {
            return res.status(409).send({
                message: `${character.name} is already in the database.`
            });
        }

        let characterInfoUrl = `https://api.eveonline.com/eve/CharacterInfo.xml.aspx?characterID=${characterId}`;
        let characterInfo = yield got(characterInfoUrl)
            .then((res) => xml2json(res.body))
            .then((data) => {
                return {
                    name: data.result[0].characterName[0],
                    race: data.result[0].race[0],
                    bloodline: data.result[0].bloodline[0]
                };
            });

        let newCharacter = new Character({
            characterId: characterId,
            name: characterInfo.name,
            race: characterInfo.race,
            bloodline: characterInfo.bloodline,
            gender: gender,
            random: [Math.random(), 0]
        });

        return newCharacter.save().then((data) => {
            res.send({
                message: `${data.name} has been added successfully!`
            });
        });
    }).catch((err) => next(err));
});

app.use((req, res) => {
  Router.match({ routes: routes.default, location: req.url }, (err, redirectLocation, renderProps) => {
    if (err) {
      res.status(500).send(err.message);
    } else if (redirectLocation) {
      res.status(302).redirect(redirectLocation.pathname + redirectLocation.search);
    } else if (renderProps) {
      var html = ReactDOM.renderToString(React.createElement(Router.RoutingContext, renderProps));
      var page = swig.renderFile('views/index.html', { html: html });
      res.status(200).send(page);
    } else {
      res.status(404).send('Page Not Found');
    }
  });
});

const server = require('http').createServer(app);
const io = require('socket.io')(server);
let onlineUsers = 0;

io.sockets.on('connection', (socket) => {
  onlineUsers++;

  io.sockets.emit('onlineUsers', { onlineUsers: onlineUsers });

  socket.on('disconnect', () => {
    onlineUsers--;
    io.sockets.emit('onlineUsers', { onlineUsers: onlineUsers });
  });
});

server.listen(app.get('port'), () => {
  console.log(`Express server listening on port ${app.get('port')}`);
});
