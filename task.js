'use strict';

const fbm = require('fbmessenger');
const mysql = require('mysql');
const moment = require('moment-timezone');
const config = require('./config.json');

const messenger = new fbm.Messenger({
  pageAccessToken: config.PAGE_ACCESS_TOKEN,
});

let connection = false;

function getUsers() {
  return new Promise((resolve, reject) => {
    // Get all the bot users where it's currently 9 am
    const userQuery = 'SELECT * FROM `users` WHERE timezone=?';
    const currentTime = moment().minute(0).seconds(0).milliseconds(0);
    const broadcastTime = moment().hour(9).minute(0).seconds(0)
      .milliseconds(0);
    const timeDiff = broadcastTime.diff(currentTime, 'hours');

    connection.query(userQuery, [timeDiff], (err, results) => {
      if (err) {
        console.log(err);
        reject(err);
      }

      if (results.length) {
        console.log(`Users count: ${results.length}`);
        resolve(results);
      }
      reject('No users.');
    });
  });
}

/**
 * Gets a joke from the database
 * unique: Determines whether to select from jokes that have been used before
 */
function getJoke(unique) {
  return new Promise((resolve, reject) => {
    let qry = 'SELECT * FROM jokes WHERE `last_used` < ?  OR `last_used` IS NULL ORDER BY RAND() LIMIT 1';
    if (!unique) {
      qry = 'SELECT * FROM jokes ORDER BY RAND() LIMIT 1';
    }
    const lastUsed = moment().subtract(1, 'months').format('YYYY-MM-DD');
    connection.query(qry, [lastUsed], (err, result) => {
      if (err) {
        console.log(err, err.stack);
        reject(err);
      }
      resolve(result);
    });
  });
}

function markJokeAsUsed(joke) {
  return new Promise((resolve, reject) => {
    const jokeUpdateQuery = 'UPDATE `jokes` SET `last_used`=? WHERE `id`=?';
    const now = moment().format('YYYY-MM-DD HH:mm:ss');
    connection.query(jokeUpdateQuery, [now, joke[0].id], (err) => {
      if (err) reject(err);
      resolve('Joke marked as used');
    });
  });
}

module.exports.index = (event, context, cb) => {
  connection = mysql.createConnection({
    host: config.DB_HOSTNAME,
    user: config.DB_USERNAME,
    password: config.DB_PASSWORD,
    port: config.DB_PORT,
    database: config.DB_NAME,
  });
  connection.on('error', (err) => {
    console.log(err, err.stack);
  });

  getUsers()
    .then((results) => {
      if (results.length > 0) {
        getJoke(true)
          .then((joke) => {
            markJokeAsUsed(joke)
              .then(() => {
                const button = new fbm.Button({
                  type: 'postback',
                  title: joke[0].button_text,
                  payload: joke[0].id,
                });

                const template = new fbm.ButtonTemplate(joke[0].joke, [button]);
                const messages = results.map(result => messenger.send(template, result.id));

                // Wait for all the Promises to be fulfilled
                messages.reduce((p, fn) => p.then(fn), Promise.resolve())
                  .then(() => {
                    connection.end(() => cb(null, 'Success'));
                  });
              });
          });
      } else {
        connection.end(() => cb(null, 'Success'));
      }
    })
    .catch((err) => {
      console.log(`Error: ${err}`, err.stack);
      connection.end(() => cb(null, err));
    });
};
