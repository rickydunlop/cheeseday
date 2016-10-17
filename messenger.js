'use strict';

const events = require('events');
const fbm = require('fbmessenger');
const mysql = require('mysql');
const config = require('./config.json');

const VERIFY_TOKEN = config.VERIFY_TOKEN;
const PAGE_ACCESS_TOKEN = config.PAGE_ACCESS_TOKEN;

const eventEmitter = new events.EventEmitter();
const messenger = new fbm.Messenger({
  pageAccessToken: PAGE_ACCESS_TOKEN,
});

let connection = false;

const ERROR_MESSAGES = [
  'What’s that? Doesn’t matter. Let’s crack on with the cheese.',
  'I camembert to talk about anything but cheese. Let’s get back to the good stuff.',
  'That doesn’t sound like a cheese joke to me. Let’s get back to the good stuff.',
  'You’ve got a whey with words, but I do the jokes round here. Click “cheese-me” for more of the good stuff.',
];

const GET_STARTED_MESSAGES = [
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
        console.log('Get joke error', err, err.stack);
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
    connection.query(
      'SELECT * FROM jokes WHERE `id`=? LIMIT 1',
      [id],
      (err, result) => {
        if (err) {
          console.log('Get joke answer', err, err.stack);
          reject(err);
        }
        resolve(result);
      }
    );
  });
}

/**
 * Saves a user to the database
 * Only gets called when the Get started button is clicked
 */
function saveUser(user) {
  console.log(user);
  const userQuery = 'SELECT * FROM `users` WHERE id=?';
  connection.query(userQuery, [user.id], (err, res) => {
    if (err) console.log('save user error', err, err.stack);

    if (res.length === 0) {
      connection.query({
        sql: 'INSERT INTO `users` SET ?',
        values: user,
      }, (error) => {
        if (error) console.log('user save error', error, error.stac);
      });
    }
  });
}

function isInt(value) {
  return !isNaN(value) &&
         parseInt(Number(value), 10) === value &&
         !isNaN(parseInt(value, 10));
}

function init() {
  // Greeting Text
  const greetingText = new fbm.GreetingText(
    'Tuesdays are the worst. Make ‘em better with a weekly, cheesy joke.'
  );
  messenger.setThreadSetting(greetingText)
    .then((result) => {
      console.log(`Greeting Text: ${JSON.stringify(result)}`);
    });

  // Get Started Button
  const getStarted = new fbm.GetStartedButton('start');
  messenger.setThreadSetting(getStarted)
    .then((result) => {
      console.log(`Greeting Text: ${JSON.stringify(result)}`);
    });

  // Persistent menu
  const menuJoke = new fbm.PersistentMenuItem({
    type: 'postback',
    title: 'Tell me a joke',
    payload: 'joke',
  });

  const menu = new fbm.PersistentMenu([menuJoke]);
  messenger.setThreadSetting(menu)
    .then((result) => {
      console.log(`Greeting Text: ${JSON.stringify(result)}`);
    });
}

function sendJoke() {
  getJoke(false)
    .then((joke) => {
      const template = new fbm.ButtonTemplate(
        joke[0].joke,
        [
          new fbm.Button({
            type: 'postback',
            title: joke[0].button_text,
            payload: joke[0].id,
          }),
        ]
      );
      messenger.send(template)
        .then(() => {
          eventEmitter.emit('complete');
        });
    });
}

messenger.on('message', (message) => {
  const txt = message.message.text;
  const msg = txt.toLowerCase();
  const triggers = ['joke', 'cheese-me', 'cheese'];
  if (triggers.some(x => msg.includes(x))) {
    // Check for the joke triggers in the message
    sendJoke();
  } else {
    // Default response
    const errMsg = ERROR_MESSAGES[Math.floor(Math.random() * ERROR_MESSAGES.length)];
    messenger.send({
      text: errMsg,
    })
    .then(() => {
      eventEmitter.emit('complete');
    })
    .catch(err => console.log('Message error', err, err.stack));
  }
});

messenger.on('postback', (message) => {
  const payload = message.postback.payload;

  // Get Started button is clicked
  if (payload === 'start') {
    messenger.getUser()
      .then((user) => {
        console.log('FB user', user);
        saveUser(Object.assign(
          { id: message.sender.id },
          user
        ));
        messenger.send(new fbm.Image({
          url: 'https://s3-eu-west-1.amazonaws.com/cheeseday/halloumi-sm.jpg',
          resusable: true,
        }))
        .then((res) => {
          console.log('Start response', res);
          console.log(`Get started attachment_id: ${res.attachment_id}`);
          const rand = Math.floor(Math.random() * GET_STARTED_MESSAGES.length);
          const startMsg = GET_STARTED_MESSAGES[rand];
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
    sendJoke();
  } else if (isInt(payload)) {
    // Joke callback, retrieves the answer to the joke from the id sent in the payload
    getJokeAnswer(payload)
      .then((answer) => {
        messenger.send(new fbm.Image({ url: answer[0].image }))
          .then(() => {
            messenger.send({ text: answer[0].answer })
              .then(() => {
                eventEmitter.emit('complete');
              });
          })
          .catch(err => console.log(err, err.stack));
      })
      .catch(err => console.log(err, err.stack));
  }
});

module.exports.bot = (event, context, cb) => {
  connection = mysql.createConnection({
    host: config.DB_HOSTNAME,
    user: config.DB_USERNAME,
    password: config.DB_PASSWORD,
    port: config.DB_PORT,
    database: config.DB_NAME,
  });
  connection.on('error', (err) => {
    console.log('Global connection error');
    console.log(err, err.stack);
  });

  eventEmitter.on('complete', () => {
    connection.end(() => cb(null, 'Success'));
  });

  // Handle the verification
  if (event.query && event.query['hub.challenge']) {
    if (event.query['hub.verify_token'] === VERIFY_TOKEN) {
      return connection.end(() => cb(null, parseInt(event.query['hub.challenge'], 10)));
    }
    return connection.end(() => cb(null, 'Error, wrong validation token'));
  } else if (event.query && event.query.init) {
    return connection.end(() => init());
  }

  // Handles any other messages
  return messenger.handle(event.body);
};
