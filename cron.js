const fetch = require('node-fetch');
const config = require('./config.json');

module.exports.index = (event, context, cb) => {
  const url = config.CRON_URL;

  fetch(url)
    .then((res) => {
      console.log(res);
      return cb(null, 'Success');
    }).then((json) => {
      console.log(json);
      return cb(null, 'Error');
    });
};
