import { createApp } from './app.js';
import { config } from './config.js';
import { connectDb } from './db.js';
import { resumeSummaryJobs } from './lib/summaries/pipeline.js';

await connectDb(config.mongoUri);
const resumed = await resumeSummaryJobs();
if (resumed) console.log(`resuming ${resumed} lesson summary job(s)`);
createApp().listen(config.port, () => {
  console.log(`API listening on http://localhost:${config.port}`);
});
