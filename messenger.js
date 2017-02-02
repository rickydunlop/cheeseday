'use strict';

const events = require('events');
const fbm = require('fbmessenger');
const mysql = require('mysql');
const config = require('./config.json');

const eventEmitter = new events.EventEmitter();
const messenger = new fbm.Messenger({
  pageAccessToken: config.PAGE_ACCESS_TOKEN,
});

let connection = false;

const GREETING_TEXT = 'Tuesdays are the worst. Make ‘em better with a weekly, cheesy joke.';
const DEFAULT_RESPONSES = [
  'What’s that? Doesn’t matter. Let’s crack on with the cheese.',
  'I camembert to talk about anything but cheese. Let’s get back to the good stuff.',
  'That doesn’t sound like a cheese joke to me. Let’s get back to the good stuff.',
  'You’ve got a whey with words, but I do the jokes round here. Click “cheese-me” for more of the good stuff.',
];

const GET_STARTED_RESPONSES = [
  'The best jokes are cheese jokes. Get a slice of un-brie-lievably cheesy humour in your inbox every tuesday. Can’t wait ‘til then? Just click “cheese-me” whenever you need a fix. 🧀',
  'Let’s make Tuesdays grate again. 🧀',
];

/**
 * Gets a joke from the database
 * unique: Determines whether to select from jokes that have been used before
 */
function getJoke(unique) {
  return new Promise((resolve, reject) => {
    let qry = 'SELECT * FROM jokes WHERE `used`=? ORDER BY RAND() LIMIT 1';
    if (!unique) {
      qry = 'SELECT * FROM jokes ORDER BY RAND() LIMIT 1';
    }
    connection.query(qry, [0], (err, result) => {
      if (err) {
        console.log('getJoke error', err, err.stack);
        reject(err);
      }
      resolve(result);
    });
  });
}

/**
 * Gets the answer to a joke from the id
 */
function getJokeAnswer(id) {
  return new Promise((resolve, reject) => {
    const qry = 'SELECT * FROM jokes WHERE `id`=? LIMIT 1';
    connection.query(qry, [id], (err, result) => {
      if (err) {
        console.log('getJokeAnswer error', err, err.stack);
        reject(err);
      }
      resolve(result);
    });
  });
}

/**
 * Saves a user to the database
 * Only gets called when the Get started button is clicked
 */
function saveUser(user) {
  const userQuery = 'SELECT * FROM `users` WHERE id=?';
  connection.query(userQuery, [user.id], (err, res) => {
    if (err) console.log('User select error', err, err.stack);

    if (res.length === 0) {
      connection.query({
        sql: 'INSERT INTO `users` SET ?',
        values: user,
      }, (error) => {
        if (error) console.log('User save error', error, error.stac);
      });
    }
  });
}

/**
 * Checks if a value is an integer
 * @param  {mixed}  value Value to check
 * @return {Boolean}      True if the value is an integer
 */
function isInt(value) {
  return !isNaN(value) &&
         parseInt(Number(value)) == value && // eslint-disable-line
         !isNaN(parseInt(value, 10));
}

function init() {
  // Greeting Text
  const greeting = messenger.setThreadSetting(new fbm.GreetingText(GREETING_TEXT))
    .then(result => console.log('Greeting Text', JSON.stringify(result)));

  // Get Started Button
  const getStarted = messenger.setThreadSetting(new fbm.GetStartedButton('start'))
    .then(result => console.log('Get Started Button', JSON.stringify(result)));

  // Persistent menu
  const menuButtonJoke = new fbm.PersistentMenuItem({
    type: 'postback',
    title: 'Tell me a joke',
    payload: 'joke',
  });

  const menu = messenger.setThreadSetting(new fbm.PersistentMenu([menuButtonJoke]))
    .then(result => console.log('Persistent Menu', JSON.stringify(result)));

  return Promise.all([greeting, getStarted, menu]);
}

function sendJoke(userID) {
  getJoke(false)
    .then((joke) => {
      const button = new fbm.Button({
        type: 'postback',
        title: joke[0].button_text,
        payload: joke[0].id,
      });

      const template = new fbm.ButtonTemplate(joke[0].joke, [button]);
      messenger.send(template, userID)
        .then(() => eventEmitter.emit('complete'))
        .catch(err => console.log('sendJoke error', err, err.stack));
    });
}

messenger.on('message', (message) => {
  if ('text' in message.message) {
    const userID = message.sender.id;
    const txt = message.message.text;
    const msg = txt.toLowerCase();
    const triggers = ['joke', 'cheese-me', 'cheese'];
    if (triggers.some(x => msg.includes(x))) {
      // Check for the joke triggers in the message
      sendJoke(userID);
    } else {
      // Default response
      const errMsg = DEFAULT_RESPONSES[Math.floor(Math.random() * DEFAULT_RESPONSES.length)];
      messenger.send({ text: errMsg }, userID)
        .then(() => eventEmitter.emit('complete'))
        .catch(err => console.log('Message event error', err, err.stack));
    }
  }
});

messenger.on('postback', (message) => {
  const userID = message.sender.id;
  const payload = message.postback.payload;

  // Get Started button is clicked
  if (payload === 'start') {
    messenger.getUser()
      .then((user) => {
        saveUser(Object.assign({ id: userID }, user));

        // Use this if the attachment_id fails
        // messenger.send(new fbm.Image({
        //   url: 'https://s3-eu-west-1.amazonaws.com/cheeseday/halloumi-sm.jpg',
        //   is_reusable: true,
        // }));
        messenger.send(new fbm.Image({ attachment_id: 326660031032791 }))
          .then(() => {
            const rand = Math.floor(Math.random() * GET_STARTED_RESPONSES.length);
            const startMsg = GET_STARTED_RESPONSES[rand];
            const template = new fbm.ButtonTemplate(startMsg, [
              new fbm.Button({
                type: 'postback',
                title: 'Cheese-me',
                payload: 'joke',
              }),
            ]);
            messenger.send(template)
              .then(() => eventEmitter.emit('complete'));
          });
      })
      .catch(err => console.log(err, err.stack));
  } else if (payload === 'joke') {
    sendJoke(userID);
  } else if (isInt(payload)) {
    // Joke callback, gets the answer for the joke by the id sent in the payload
    getJokeAnswer(payload)
      .then((answer) => {
        messenger.send(new fbm.Image({ url: answer[0].image }), userID)
          .then(() => {
            messenger.send({ text: answer[0].answer }, userID)
              .then(() => eventEmitter.emit('complete'));
          })
          .catch(err => console.log(err, err.stack));
      })
      .catch(err => console.log(err, err.stack));
  } else {
    eventEmitter.emit('complete');
  }
});

module.exports.index = (event, context, cb) => {
  if (event.query && event.query['hub.challenge']) {
    // Handle the verification
    if (event.query['hub.verify_token'] === config.VERIFY_TOKEN) {
      return cb(null, parseInt(event.query['hub.challenge'], 10));
    }
    return cb(null, 'Error, incorrect validation token.');
  } else if (event.query && event.query.init) {
    // Initialise the bot
    return init().then(() => cb(null, 'Initialised'));
  }

  connection = mysql.createConnection({
    host: config.DB_HOSTNAME,
    user: config.DB_USERNAME,
    password: config.DB_PASSWORD,
    port: config.DB_PORT,
    database: config.DB_NAME,
  });
  connection.on('error', err => console.log('Global connection error', err, err.stack));

  eventEmitter.on('complete', () => connection.end(() => cb(null, 'Success')));

  // Handles any other messages
  return messenger.handle(event.body);
};
