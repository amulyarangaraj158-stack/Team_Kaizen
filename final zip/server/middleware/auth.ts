import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';

const FALLBACK_DEV_SECRET = crypto.createHash('sha256').update(`autopatch-local-${process.cwd()}`).digest('hex');

export function getJwtSecret(): string {
  return process.env.JWT_SECRET?.trim() || FALLBACK_DEV_SECRET;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: string;
}

export interface AuthedRequest extends Request {
  user?: AuthUser;
}

export function signAuthToken(user: AuthUser): string {
  return jwt.sign(
    { id: user.id, email: user.email, name: user.name, role: user.role },
    getJwtSecret(),
    { expiresIn: '7d' }
  );
}

export function verifyAuthToken(token: string): AuthUser | null {
  try {
    const decoded = jwt.verify(token, getJwtSecret()) as AuthUser;
    if (!decoded || !decoded.id) return null;
    return {
      id: decoded.id,
      email: decoded.email,
      name: decoded.name,
      role: decoded.role,
    };
  } catch {
    return null;
  }
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : null;
  if (!token) {
    res.status(401).json({ error: 'Authentication required. Missing Bearer token.' });
    return;
  }
  const user = verifyAuthToken(token);
  if (!user) {
    res.status(401).json({ error: 'Invalid or expired authentication token.' });
    return;
  }
  req.user = user;
  next();
}
