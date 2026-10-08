const app = require('./app'),
  connectDb = require('./config/db');
const port = process.env.PORT || 3000;
Promise.resolve()
  .then(() => require('./config/env')())
  .then(() => connectDb())
  .then(() => app.listen(port, () => console.log(`API listening on :${port}`)))
  .catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
