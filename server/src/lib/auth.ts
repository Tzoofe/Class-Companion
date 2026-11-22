import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import type { Role } from '../models/User.js';

export interface TokenPayload {
  sub: string;
  role: Role;
}

export const hashPassword = (plain: string) => bcrypt.hash(plain, 10);
export const verifyPassword = (plain: string, hash: string) => bcrypt.compare(plain, hash);

export const signToken = (p: TokenPayload) =>
  jwt.sign(p, config.jwtSecret, { expiresIn: config.jwtExpiresIn as jwt.SignOptions['expiresIn'] });

export function verifyToken(token: string): TokenPayload | null {
  try {
    const p = jwt.verify(token, config.jwtSecret) as jwt.JwtPayload;
    return typeof p.sub === 'string' && (p.role === 'lecturer' || p.role === 'student')
      ? { sub: p.sub, role: p.role }
      : null;
  } catch {
    return null;
  }
}
