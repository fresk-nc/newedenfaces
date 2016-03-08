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
const _ = require('underscore');

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

app.get('/api/characters', (req, res, next) => {
  let choices = ['Female', 'Male'];
  let randomGender = _.sample(choices);

  Character
    .find({ random: { $near: [Math.random(), 0] } })
    .where('voted', false)
    .where('gender', randomGender)
    .limit(2)
    .exec()
    .then((characters) => {
      if (characters.length === 2) {
        return res.send(characters);
      }

      let oppositeGender = _.first(_.without(choices, randomGender));

      Character
        .find({ random: { $near: [Math.random(), 0] } })
        .where('voted', false)
        .where('gender', oppositeGender)
        .limit(2)
        .exec()
        .then((characters) => {
          if (characters.length === 2) {
            return res.send(characters);
          }

          Character
            .update({}, { $set: { voted: false } }, { multi: true })
            .then(() => {
                return res.send([]);
            });
        });
    })
    .catch((err) => next(err));
});

app.put('/api/characters', (req, res, next) => {
  let winner = req.body.winner;
  let loser = req.body.loser;

  if (!winner || !loser) {
    return res.status(400).send({
        message: 'Voting requires two characters.'
    });
  }

  if (winner === loser) {
    return res.status(400).send({
        message: 'Cannot vote for and against the same character.'
    });
  }

  co(function * () {
      let characters = yield {
          winner: Character.findOne({ characterId: winner }),
          loser: Character.findOne({ characterId: loser })
      }

      if (!characters.winner || !characters.loser) {
        return res.status(404).send({ message: 'One of the characters no longer exists.' });
      }

      if (characters.winner.voted || characters.loser.voted) {
        return res.status(200).end();
      }

      characters.winner.wins++;
      characters.winner.voted = true;
      characters.winner.random = [Math.random(), 0];

      characters.loser.losses++;
      characters.loser.voted = true;
      characters.loser.random = [Math.random(), 0];

      yield [
          characters.loser.save(),
          characters.winner.save()
      ]

      return res.status(200).end();
  }).catch((err) => next(err));
});

app.get('/api/characters/count', (req, res, next) => {
  Character
    .count()
    .then((count) => {
      res.send({ count: count });
    })
    .catch((err) => next(err));
});

app.get('/api/characters/search', (req, res, next) => {
  let characterName = new RegExp(req.query.name, 'i');

  Character
    .findOne({ name: characterName })
    .then((character) => {
        if (!character) {
          return res.status(404).send({ message: 'Character not found.' });
        }

        res.send(character);
    })
    .catch((err) => next(err));
});

app.get('/api/characters/top', (req, res, next) => {
  let params = req.query;
  let conditions = {};

  _.each(params, (value, key) => {
    conditions[key] = new RegExp('^' + value + '$', 'i');
  });

  Character
    .find(conditions)
    .sort('-wins') // Sort in descending order (highest wins on top)
    .limit(100)
    .exec()
    .then((characters) => {
      // Sort by winning percentage
      characters.sort(function(a, b) {
        if (a.wins / (a.wins + a.losses) < b.wins / (b.wins + b.losses)) { return 1; }
        if (a.wins / (a.wins + a.losses) > b.wins / (b.wins + b.losses)) { return -1; }
        return 0;
      });

      res.send(characters);
    })
    .catch((err) => next(err));
});

app.get('/api/characters/shame', (req, res, next) => {
  Character
    .find()
    .sort('-losses')
    .limit(100)
    .exec()
    .then((characters) => {
      res.send(characters);
    })
    .catch((err) => next(err));
});

app.get('/api/characters/:id', (req, res, next) => {
  let id = req.params.id;

  Character
    .findOne({ characterId: id })
    .then((character) => {
        if (!character) {
          return res.status(404).send({ message: 'Character not found.' });
        }

        res.send(character);
    })
    .catch((err) => next(err));
});

app.post('/api/report', (req, res, next) => {
  let characterId = req.body.characterId;

  Character
    .findOne({ characterId: characterId })
    .then((character) => {
        if (!character) {
            return res.status(404).send({ message: 'Character not found.' });
        }

        character.reports++;

        if (character.reports > 4) {
            character.remove();
            return res.send({ message: character.name + ' has been deleted.' });
        }

        character.save().then(() => {
            res.send({ message: character.name + ' has been reported.' });
        });
    })
    .catch((err) => next(err));
});

app.get('/api/stats', (req, res, next) => {
    co(function * () {

        function getTotalVotes() {
            return Character
                .aggregate({ $group: { _id: null, total: { $sum: '$wins' } } })
                .then((totalVotes) => {
                    return totalVotes.length ? totalVotes[0].total : 0;
                });
        }

        function getLeadingRace() {
            return Character
              .find()
              .sort('-wins')
              .limit(100)
              .select('race')
              .exec()
              .then((characters) => {
                  let raceCount = _.countBy(characters, (character) => character.race);
                  let max = _.max(raceCount, (race) => race);
                  let inverted = _.invert(raceCount);
                  let topRace = inverted[max];
                  let topCount = raceCount[topRace];

                  return {
                      race: topRace,
                      count: topCount
                  };
              });
        }

        function getLeadingBloodline() {
            return Character
              .find()
              .sort('-wins')
              .limit(100)
              .select('bloodline')
              .exec()
              .then((characters) => {
                  let bloodlineCount = _.countBy(characters, (character) => character.bloodline);
                  let max = _.max(bloodlineCount, (bloodline) => bloodline);
                  let inverted = _.invert(bloodlineCount);
                  let topBloodline = inverted[max];
                  let topCount = bloodlineCount[topBloodline];

                  return {
                      bloodline: topBloodline,
                      count: topCount
                  };
              });
        }

        const data = yield {
            totalCount: Character.count({}),
            amarrCount: Character.count({ race: 'Amarr' }),
            caldariCount: Character.count({ race: 'Caldari' }),
            gallenteCount: Character.count({ race: 'Gallente' }),
            minmatarCount: Character.count({ race: 'Minmatar' }),
            maleCount: Character.count({ gender: 'Male' }),
            femaleCount: Character.count({ gender: 'Female' }),
            totalVotes: getTotalVotes(),
            leadingRace: getLeadingRace(),
            leadingBloodline: getLeadingBloodline()
        }

        return res.send(data);
    })
    .catch((err) => next(err));
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
