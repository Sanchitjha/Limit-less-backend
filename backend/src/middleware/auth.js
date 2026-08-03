import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { isDbReady } from '../db/mongo.js';
import { RevokedToken } from '../db/models/RevokedToken.js';

export const signUserToken = (userId) =>
  jwt.sign({ sub: String(userId), role: 'user', jti: crypto.randomUUID() }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  });

export const signAdminToken = () =>
  jwt.sign({ sub: 'admin', role: 'admin', jti: crypto.randomUUID() }, config.jwtSecret, { expiresIn: '12h' });

// Long-lived, separate from the access token (config.jwtExpiresIn, currently
// 7d) — lets a client silently get a new access token instead of forcing a
// full re-login every 7 days. Deliberately not shortening the access token
// itself: the website has no refresh logic and would start logging users out
// early if it did.
const REFRESH_TOKEN_EXPIRES_IN = '60d';

export const signRefreshToken = (userId) =>
  jwt.sign(
    { sub: String(userId), role: 'user', type: 'refresh', jti: crypto.randomUUID() },
    config.jwtSecret,
    { expiresIn: REFRESH_TOKEN_EXPIRES_IN }
  );

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
export const requireAuth = async (req, res, next) => {
  const token = readToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Missing Authorization header (Bearer token)' });
  }
  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  try {
    if (payload.jti && isDbReady()) {
      const revoked = await RevokedToken.findOne({ jti: payload.jti }).lean();
      if (revoked) {
        return res.status(401).json({ error: 'This token has been logged out. Please log in again.' });
      }
    }
  } catch (err) {
    console.warn('[auth] revocation check failed, allowing request:', err.message);
  }

  req.auth = { userId: payload.sub, role: payload.role === 'admin' ? 'admin' : 'user' };
  next();
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
