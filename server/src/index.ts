import { createApp } from './app.js';
import { config } from './config.js';
import { connectDb } from './db.js';

await connectDb(config.mongoUri);
createApp().listen(config.port, () => {
  console.log(`API listening on http://localhost:${config.port}`);
});
