import type { NextFunction, Request, Response } from 'express';
import { verifyToken, type TokenPayload } from '../lib/auth.js';
import type { Role } from '../models/User.js';

declare module 'express-serve-static-core' {
  interface Request {
    auth?: TokenPayload;
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const payload = token ? verifyToken(token) : null;
  if (!payload) {
    res.status(401).json({ error: 'Not logged in' });
    return;
  }
  req.auth = payload;
  next();
}

export const requireRole = (role: Role) => (req: Request, res: Response, next: NextFunction) => {
  if (req.auth?.role !== role) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  next();
};
