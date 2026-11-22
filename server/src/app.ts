import express, { type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { authRouter } from './routes/auth.js';
import { coursesRouter } from './routes/courses.js';

export function createApp() {
  const app = express();
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });
  app.use('/api/auth', authRouter);
  app.use('/api/courses', coursesRouter);

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof multer.MulterError) {
      res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'File too large (max 2 MB)' : err.message });
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
