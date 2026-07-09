import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { isDbReady } from '../db/mongo.js';

export const signUserToken = (userId) =>
  jwt.sign({ sub: String(userId), role: 'user' }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  });

export const signAdminToken = () =>
  jwt.sign({ sub: 'admin', role: 'admin' }, config.jwtSecret, { expiresIn: '12h' });

/** 503 guard for routes that need MongoDB. */
export const requireDb = (req, res, next) => {
  if (!isDbReady()) {
    return res.status(503).json({
      error: 'Database not available',
      message: 'MONGODB_URI is not configured or the database is unreachable.',
    });
  }
  next();
};

const readToken = (req) => {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  return null;
};

/** Requires a valid user or admin JWT. Attaches req.auth = { userId, role }. */
export const requireAuth = (req, res, next) => {
  const token = readToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Missing Authorization header (Bearer token)' });
  }
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    req.auth = { userId: payload.sub, role: payload.role === 'admin' ? 'admin' : 'user' };
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

/** Requires an admin JWT. */
export const requireAdmin = (req, res, next) => {
  requireAuth(req, res, () => {
    if (req.auth.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    next();
  });
};

/**
 * Allows the authenticated user to act only on their own resources
 * (req.params[param] must equal their user id) — admins can act on anyone.
 */
export const requireSelfOrAdmin = (param = 'id') => (req, res, next) => {
  requireAuth(req, res, () => {
    if (req.auth.role === 'admin' || req.auth.userId === req.params[param]) {
      return next();
    }
    return res.status(403).json({ error: 'You can only access your own data' });
  });
};
