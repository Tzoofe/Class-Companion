import express, { type NextFunction, type Request, type Response } from 'express';
import { authRouter } from './routes/auth.js';
import { coursesRouter } from './routes/courses.js';
import { overviewRouter } from './routes/overview.js';
import { pollsRouter } from './routes/polls.js';
import { postsRouter } from './routes/posts.js';
import { pushRouter } from './routes/push.js';
import { scheduleRouter } from './routes/schedule.js';
import { sessionsRouter } from './routes/sessions.js';

export function createApp() {
  const app = express();
  app.use(express.json({ limit: '4mb' })); // roster files arrive as base64

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });
  app.use('/api/auth', authRouter);
  app.use('/api/courses', coursesRouter);
  app.use('/api/sessions', sessionsRouter);
  app.use('/api/push', pushRouter);
  app.use('/api', postsRouter);
  app.use('/api', pollsRouter);
  app.use('/api', scheduleRouter);
  app.use('/api', overviewRouter);

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    if ((err as { type?: string }).type === 'entity.too.large') {
      res.status(400).json({ error: 'File too large (max 2 MB)' });
      return;
    }
    if ((err as { type?: string }).type === 'entity.parse.failed') {
      res.status(400).json({ error: 'Invalid JSON' });
      return;
    }
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  });

  return app;
}
