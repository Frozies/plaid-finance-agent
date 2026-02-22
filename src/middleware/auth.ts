import type { Request, Response, NextFunction } from 'express';
import config from '../config';
import logger from '../services/logger';

function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (req.path === '/health' || req.path.startsWith('/public/')) {
    next();
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    logger.warn(`Unauthorized request to ${req.method} ${req.path} from ${req.ip}`);
    res.status(401).json({ error: 'Missing or invalid authorization header' });
    return;
  }

  const token = authHeader.slice(7);
  if (token !== config.bearerToken) {
    logger.warn(`Invalid bearer token for ${req.method} ${req.path} from ${req.ip}`);
    res.status(403).json({ error: 'Invalid token' });
    return;
  }

  next();
}

export default authMiddleware;
