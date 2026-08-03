import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import jwksClient from 'jwks-rsa';
import { config, features } from '../config.js';
import { User, sanitizeUser } from '../db/models/User.js';
import { Assessment, sanitizeAssessment } from '../db/models/Assessment.js';
import { Otp } from '../db/models/Otp.js';
import { RevokedToken } from '../db/models/RevokedToken.js';
import { RefreshToken } from '../db/models/RefreshToken.js';
import { requireDb, requireAuth, signUserToken, signRefreshToken } from '../middleware/auth.js';
import { assert, asInt, asString } from '../middleware/validate.js';
import {
  sendCredentialsEmail,
  sendAdminNotification,
  sendOtpEmail,
  sendPasswordResetEmail,
} from '../services/emailService.js';

const router = Router();
router.use(requireDb);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const generateTempPassword = () =>
  Math.random().toString(36).slice(-8).toUpperCase().padEnd(8, 'X');

// ── Email OTP verification ───────────────────────────────────────────────────

const OTP_TTL_MINUTES = 10; // code validity
const OTP_VERIFIED_TTL_MINUTES = 30; // window to complete registration after verify
const OTP_RESEND_COOLDOWN_SECONDS = 60;
const OTP_MAX_ATTEMPTS = 5;

const hashOtp = (email, otp) =>
  crypto.createHmac('sha256', config.jwtSecret).update(`${email}:${otp}`).digest('hex');

/** Issue an access token + refresh token pair, persisting the refresh token's jti. */
const issueTokens = async (userId) => {
  const token = signUserToken(userId);
  const refreshToken = signRefreshToken(userId);
  const decoded = jwt.decode(refreshToken);
  await RefreshToken.create({ jti: decoded.jti, user_id: userId, expires_at: new Date(decoded.exp * 1000) });
  return { token, refreshToken };
};

// ── Social sign-in (Google / Apple) ──────────────────────────────────────────

const googleClient = new OAuth2Client();

const appleJwks = jwksClient({
  jwksUri: 'https://appleid.apple.com/auth/keys',
  cache: true,
  cacheMaxAge: 12 * 60 * 60 * 1000, // 12h — Apple rotates keys infrequently
});

const getAppleSigningKey = (header, callback) => {
  appleJwks.getSigningKey(header.kid, (err, key) => {
    if (err) return callback(err);
    callback(null, key.getPublicKey());
  });
};

const verifyAppleIdentityToken = (identityToken) =>
  new Promise((resolve, reject) => {
    jwt.verify(identityToken, getAppleSigningKey, { algorithms: ['RS256'] }, (err, payload) => {
      if (err) return reject(err);
      resolve(payload);
    });
  });

/**
 * Find the user for a social sign-in, or create one. Matches first by the
 * provider id (returning user), then falls back to matching by email and
 * linking the provider onto that existing account (e.g. a user who first
 * registered with a password, now also using "Sign in with Google").
 */
export const findOrCreateSocialUser = async ({ provider, providerId, email, name, emailVerified }) => {
  const field = provider === 'google' ? 'google_id' : 'apple_id';

  let user = await User.findOne({ [field]: providerId });
  if (user) return user;

  user = await User.findOne({ email });
  if (user) {
    user[field] = providerId;
    if (emailVerified) user.email_verified = true;
    await user.save();
    return user;
  }

  user = await User.create({
    name: name || email.split('@')[0],
    email,
    [field]: providerId,
    email_verified: Boolean(emailVerified),
    payment_status: 'pending',
    password_reset_required: false,
  });
  sendAdminNotification({ name: user.name, email, age: null, gender: null }).catch(() => {});
  return user;
};

const socialSignInResponse = async (user) => {
  const latest = await Assessment.findOne({ user_id: user._id }).sort({ created_at: -1 });
  const { token, refreshToken } = await issueTokens(user._id);
  return {
    token,
    refreshToken,
    user: sanitizeUser(user),
    latestAssessment: latest ? sanitizeAssessment(latest) : null,
  };
};

/**
 * POST /api/auth/send-otp
 * Body: { email, name? }
 * Emails a 6-digit verification code (10 min validity, 60s resend cooldown).
 * Used to verify a user's email AFTER registration (register first, then
 * send-otp + verify-otp) — 409 only if that email is already a VERIFIED
 * account (nothing left to verify; log in instead).
 */
router.post('/send-otp', async (req, res) => {
  const body = req.body || {};
  const email = asString(body.email, 'email', { required: true, maxLength: 320 }).toLowerCase();
  assert(EMAIL_RE.test(email), 'email must be a valid email address', ['email']);
  const name = asString(body.name, 'name', { required: false, maxLength: 200 });

  const existingUser = await User.findOne({ email }).lean();
  if (existingUser?.email_verified) {
    return res.status(409).json({ error: 'This email is already verified. Please log in instead.' });
  }

  const existing = await Otp.findOne({ email });
  if (existing && Date.now() - existing.last_sent_at.getTime() < OTP_RESEND_COOLDOWN_SECONDS * 1000) {
    return res.status(429).json({
      error: `Please wait a minute before requesting another code.`,
    });
  }

  const otp = String(crypto.randomInt(100000, 1000000)); // 6 digits, crypto-secure

  await Otp.findOneAndUpdate(
    { email },
    {
      email,
      otp_hash: hashOtp(email, otp),
      attempts: 0,
      verified: false,
      expires_at: new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000),
      last_sent_at: new Date(),
    },
    { upsert: true, new: true }
  );

  if (features.email) {
    const result = await sendOtpEmail({ email, name, otp });
    if (!result.sent) {
      return res.status(502).json({ error: 'Could not send the verification email. Please try again.' });
    }
  } else if (config.nodeEnv === 'production') {
    return res.status(503).json({ error: 'Email service is not configured on the server.' });
  }

  res.json({
    sent: true,
    expiresInMinutes: OTP_TTL_MINUTES,
    // Testing convenience only — never present when SMTP is configured or in production
    ...(!features.email && config.nodeEnv !== 'production' ? { devOtp: otp } : {}),
  });
});

/**
 * POST /api/auth/verify-otp
 * Body: { email, otp }
 * Verifies the code. If a registered user exists for this email, marks
 * their account `email_verified: true` (the normal post-registration case).
 * Max 5 wrong attempts per code.
 */
router.post('/verify-otp', async (req, res) => {
  const body = req.body || {};
  const email = asString(body.email, 'email', { required: true, maxLength: 320 }).toLowerCase();
  const otp = asString(body.otp, 'otp', { required: true, maxLength: 10 }).trim();

  const record = await Otp.findOne({ email });
  if (!record || record.expires_at < new Date()) {
    return res.status(400).json({ error: 'Code expired or not requested. Please request a new code.' });
  }
  if (record.attempts >= OTP_MAX_ATTEMPTS) {
    return res.status(429).json({ error: 'Too many wrong attempts. Please request a new code.' });
  }

  if (hashOtp(email, otp) !== record.otp_hash) {
    record.attempts += 1;
    await record.save();
    return res.status(400).json({ error: 'OTP invalid' });
  }

  record.verified = true;
  record.expires_at = new Date(Date.now() + OTP_VERIFIED_TTL_MINUTES * 60 * 1000);
  await record.save();

  const user = await User.findOneAndUpdate({ email }, { email_verified: true }, { new: true });
  Otp.deleteOne({ email }).catch(() => {});

  res.json({ verified: true, emailVerified: Boolean(user) });
});

/** Match either the plaintext temp password or the bcrypt hash. */
const passwordMatches = async (user, password) => {
  if (user.temp_password && password === user.temp_password) return true;
  if (user.password_hash) return bcrypt.compare(password, user.password_hash);
  return false;
};

/**
 * POST /api/auth/register
 * Body: { name, email, age?, gender?, password?, paymentStatus?: 'pending'|'demo',
 *         passwordResetRequired?: boolean }
 * Creates the account immediately — no OTP needed beforehand. Returns a
 * ready-to-use JWT right away. Sends credentials + admin-notification
 * emails when SMTP is configured (best-effort).
 *
 * Password: `password` is OPTIONAL.
 *  - If provided (min 6 chars), it's used as-is (hashed) as the account's
 *    real password — password_reset_required is forced false and no
 *    tempPassword is generated or emailed (a user's own chosen password is
 *    never sent back over email).
 *  - If omitted, the backend generates an 8-character temporary password,
 *    returns it once as `tempPassword`, emails it, and password_reset_required
 *    defaults to true (the app should prompt a reset via /change-password).
 *
 * Email verification happens AFTER this call: the new user starts with
 * email_verified:false — call /send-otp then /verify-otp with the same
 * email to verify it. Verification does not block login or this response;
 * it only flips the `email_verified` flag on the user.
 *
 * Response also includes `refreshToken` (60d) — exchange it at /refresh for
 * a new access token instead of forcing a re-login when this one nears
 * expiry.
 */
router.post('/register', async (req, res) => {
  const body = req.body || {};
  const name = asString(body.name, 'name', { required: true, maxLength: 200 });
  const email = asString(body.email, 'email', { required: true, maxLength: 320 }).toLowerCase();
  assert(EMAIL_RE.test(email), 'email must be a valid email address', ['email']);
  const age = body.age !== undefined && body.age !== null && body.age !== ''
    ? asInt(body.age, 'age', { min: 10, max: 120 })
    : null;
  const gender = asString(body.gender, 'gender', { required: false, maxLength: 30 }) || null;
  const ownPassword = asString(body.password, 'password', { required: false, maxLength: 200 });
  if (ownPassword) {
    assert(ownPassword.length >= 6, 'password must be at least 6 characters', ['password']);
  }
  // Self-registration may only create free/demo accounts — never 'paid'.
  const paymentStatus = body.paymentStatus === 'demo' ? 'demo' : 'pending';
  const passwordResetRequired = ownPassword
    ? false
    : (body.passwordResetRequired === false ? false : true);

  const existing = await User.findOne({ email }).lean();
  if (existing) {
    return res.status(409).json({ error: 'This email is already registered. Please log in instead.' });
  }

  const tempPassword = ownPassword ? null : generateTempPassword();
  const passwordHash = await bcrypt.hash(ownPassword || tempPassword, 10);

  const user = await User.create({
    name,
    email,
    temp_password: tempPassword,
    password_hash: passwordHash,
    password_reset_required: passwordResetRequired,
    payment_status: paymentStatus,
    age,
    gender,
    email_verified: false,
  });

  // Best-effort emails — never block or fail registration.
  sendCredentialsEmail({ name, email, tempPassword, paymentStatus: user.payment_status }).catch(() => {});
  sendAdminNotification({ name, email, age, gender }).catch(() => {});

  const { token, refreshToken } = await issueTokens(user._id);
  res.status(201).json({
    user: sanitizeUser(user),
    tempPassword,
    token,
    refreshToken,
  });
});

/**
 * POST /api/auth/login
 * Body: { email, password }
 * Accepts the temporary password OR the user-set password.
 * Returns a JWT + refreshToken, the user, and their latest assessment (if any).
 */
router.post('/login', async (req, res) => {
  const body = req.body || {};
  const email = asString(body.email, 'email', { required: true, maxLength: 320 }).toLowerCase();
  const password = asString(body.password, 'password', { required: true, maxLength: 200 });

  const user = await User.findOne({ email });
  if (!user || !(await passwordMatches(user, password))) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  const latest = await Assessment.findOne({ user_id: user._id }).sort({ created_at: -1 });
  const { token, refreshToken } = await issueTokens(user._id);

  res.json({
    token,
    refreshToken,
    user: sanitizeUser(user),
    latestAssessment: latest ? sanitizeAssessment(latest) : null,
  });
});

/**
 * POST /api/auth/google
 * Body: { idToken, name? }
 * `idToken` is the Google ID token the client SDK returns after the user
 * picks a Google account. Verified server-side against Google's public keys
 * — never trust a client-supplied email/name alone. Finds an existing user
 * by google_id, else links by matching email, else creates a new account.
 * Response shape matches /login: { token, user, latestAssessment }.
 */
router.post('/google', async (req, res) => {
  if (!features.googleSignIn) {
    return res.status(501).json({
      error: 'Google sign-in is not configured on the server.',
      message: 'Set GOOGLE_CLIENT_IDS (or GOOGLE_CLIENT_ID) to enable it.',
    });
  }
  const body = req.body || {};
  const idToken = asString(body.idToken, 'idToken', { required: true, maxLength: 4096 });
  const fallbackName = asString(body.name, 'name', { required: false, maxLength: 200 });

  let payload;
  try {
    const ticket = await googleClient.verifyIdToken({ idToken, audience: config.googleClientIds });
    payload = ticket.getPayload();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired Google token.' });
  }

  const email = String(payload.email || '').trim().toLowerCase();
  if (!email) {
    return res.status(400).json({ error: 'This Google account has no email to sign in with.' });
  }

  const user = await findOrCreateSocialUser({
    provider: 'google',
    providerId: payload.sub,
    email,
    name: payload.name || fallbackName,
    emailVerified: payload.email_verified === true || payload.email_verified === 'true',
  });

  res.json(await socialSignInResponse(user));
});

/**
 * POST /api/auth/apple
 * Body: { identityToken, name? }
 * `identityToken` is the JWT Apple returns from "Sign in with Apple",
 * verified server-side against Apple's published JWKS. Apple only sends the
 * user's name from the CLIENT on their very first sign-in ever (it isn't in
 * the token) — pass it as `name` that one time so it gets stored.
 * Response shape matches /login: { token, user, latestAssessment }.
 */
router.post('/apple', async (req, res) => {
  if (!features.appleSignIn) {
    return res.status(501).json({
      error: 'Apple sign-in is not configured on the server.',
      message: 'Set APPLE_CLIENT_IDS (or APPLE_CLIENT_ID) to enable it.',
    });
  }
  const body = req.body || {};
  const identityToken = asString(body.identityToken, 'identityToken', { required: true, maxLength: 4096 });
  const fallbackName = asString(body.name, 'name', { required: false, maxLength: 200 });

  let payload;
  try {
    payload = await verifyAppleIdentityToken(identityToken);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired Apple token.' });
  }
  if (payload.iss !== 'https://appleid.apple.com' || !config.appleClientIds.includes(payload.aud)) {
    return res.status(401).json({ error: 'Invalid Apple token.' });
  }

  const email = String(payload.email || '').trim().toLowerCase();
  if (!email) {
    return res.status(400).json({ error: 'This Apple account has no email to sign in with.' });
  }

  const user = await findOrCreateSocialUser({
    provider: 'apple',
    providerId: payload.sub,
    email,
    name: fallbackName,
    emailVerified: payload.email_verified === true || payload.email_verified === 'true',
  });

  res.json(await socialSignInResponse(user));
});

/**
 * POST /api/auth/refresh
 * Body: { refreshToken }
 * Exchanges a still-valid refresh token for a brand-new access token AND a
 * new refresh token — the old refresh token is deleted the moment this
 * succeeds (rotation), so it can't be redeemed a second time. Call this
 * instead of forcing a full re-login when the access token nears its
 * expiry. 401 with "log in again" if the refresh token is invalid, expired,
 * or already used.
 */
router.post('/refresh', async (req, res) => {
  const body = req.body || {};
  const refreshToken = asString(body.refreshToken, 'refreshToken', { required: true, maxLength: 4096 });

  let payload;
  try {
    payload = jwt.verify(refreshToken, config.jwtSecret);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired refresh token. Please log in again.' });
  }
  if (payload.type !== 'refresh') {
    return res.status(401).json({ error: 'That is not a refresh token.' });
  }

  const record = await RefreshToken.findOne({ jti: payload.jti });
  if (!record) {
    return res.status(401).json({ error: 'Refresh token has already been used or revoked. Please log in again.' });
  }

  const user = await User.findById(payload.sub);
  if (!user) {
    await RefreshToken.deleteOne({ jti: payload.jti });
    return res.status(401).json({ error: 'Account no longer exists.' });
  }

  await RefreshToken.deleteOne({ jti: payload.jti }); // rotate — this one is now spent
  const tokens = await issueTokens(user._id);
  res.json(tokens);
});

/**
 * POST /api/auth/logout
 * Auth: Bearer token (the one being logged out).
 * Body (optional): { refreshToken } — also revokes that refresh token so a
 * full sign-out kills both, not just the access token.
 * Actually invalidates this JWT server-side (adds its jti to a revocation
 * list until it would have expired anyway) — not just a client-side
 * "forget the token" no-op. Any further request with this same token gets
 * 401 immediately, even though it hasn't naturally expired yet.
 */
router.post('/logout', requireAuth, async (req, res) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
  const decoded = token ? jwt.decode(token) : null;

  if (decoded?.jti && decoded?.exp) {
    await RevokedToken.create({ jti: decoded.jti, expires_at: new Date(decoded.exp * 1000) }).catch(() => {});
  }

  const bodyRefreshToken = req.body?.refreshToken;
  if (bodyRefreshToken) {
    const refreshPayload = jwt.decode(bodyRefreshToken);
    if (refreshPayload?.jti) {
      await RefreshToken.deleteOne({ jti: refreshPayload.jti }).catch(() => {});
    }
  }

  res.json({ success: true, message: 'Logged out. This token is no longer valid.' });
});

/**
 * POST /api/auth/change-password
 * Body: { email, currentPassword, newPassword }
 * Used for the forced first-login reset and for normal password changes.
 * Clears the temporary password and the reset-required flag.
 */
router.post('/change-password', async (req, res) => {
  const body = req.body || {};
  const email = asString(body.email, 'email', { required: true, maxLength: 320 }).toLowerCase();
  const currentPassword = asString(body.currentPassword, 'currentPassword', { required: true, maxLength: 200 });
  const newPassword = asString(body.newPassword, 'newPassword', { required: true, maxLength: 200 });
  assert(newPassword.length >= 6, 'newPassword must be at least 6 characters', ['newPassword']);

  const user = await User.findOne({ email });
  if (!user || !(await passwordMatches(user, currentPassword))) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  user.password_hash = await bcrypt.hash(newPassword, 10);
  user.temp_password = null;
  user.password_reset_required = false;
  await user.save();

  res.json({ success: true, user: sanitizeUser(user) });
});

/**
 * POST /api/auth/forgot-password
 * Body: { email }
 * Emails a 6-digit reset code (10 min validity, 60s resend cooldown) to an
 * EXISTING registered user. 404 if no account exists for that email.
 */
router.post('/forgot-password', async (req, res) => {
  const body = req.body || {};
  const email = asString(body.email, 'email', { required: true, maxLength: 320 }).toLowerCase();
  assert(EMAIL_RE.test(email), 'email must be a valid email address', ['email']);

  const user = await User.findOne({ email }).lean();
  if (!user) {
    return res.status(404).json({ error: 'No account found with this email address.' });
  }

  const existing = await Otp.findOne({ email });
  if (existing && Date.now() - existing.last_sent_at.getTime() < OTP_RESEND_COOLDOWN_SECONDS * 1000) {
    return res.status(429).json({ error: 'Please wait a minute before requesting another code.' });
  }

  const otp = String(crypto.randomInt(100000, 1000000));

  await Otp.findOneAndUpdate(
    { email },
    {
      email,
      otp_hash: hashOtp(email, otp),
      attempts: 0,
      verified: false,
      expires_at: new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000),
      last_sent_at: new Date(),
    },
    { upsert: true, new: true }
  );

  if (features.email) {
    const result = await sendPasswordResetEmail({ email, name: user.name, otp });
    if (!result.sent) {
      return res.status(502).json({ error: 'Could not send the reset code email. Please try again.' });
    }
  } else if (config.nodeEnv === 'production') {
    return res.status(503).json({ error: 'Email service is not configured on the server.' });
  }

  res.json({
    sent: true,
    expiresInMinutes: OTP_TTL_MINUTES,
    // Testing convenience only — never present when SMTP is configured or in production
    ...(!features.email && config.nodeEnv !== 'production' ? { devOtp: otp } : {}),
  });
});

/**
 * POST /api/auth/reset-password
 * Body: { email, otp, newPassword }
 * Verifies the reset code (from /forgot-password) and sets a new password
 * directly — no need to know the old one. Max 5 wrong attempts per code.
 */
router.post('/reset-password', async (req, res) => {
  const body = req.body || {};
  const email = asString(body.email, 'email', { required: true, maxLength: 320 }).toLowerCase();
  const otp = asString(body.otp, 'otp', { required: true, maxLength: 10 }).trim();
  const newPassword = asString(body.newPassword, 'newPassword', { required: true, maxLength: 200 });
  assert(newPassword.length >= 6, 'newPassword must be at least 6 characters', ['newPassword']);

  const record = await Otp.findOne({ email });
  if (!record || record.expires_at < new Date()) {
    return res.status(400).json({ error: 'Code expired or not requested. Please request a new code.' });
  }
  if (record.attempts >= OTP_MAX_ATTEMPTS) {
    return res.status(429).json({ error: 'Too many wrong attempts. Please request a new code.' });
  }
  if (hashOtp(email, otp) !== record.otp_hash) {
    record.attempts += 1;
    await record.save();
    return res.status(400).json({ error: 'OTP invalid' });
  }

  const user = await User.findOne({ email });
  if (!user) {
    return res.status(404).json({ error: 'No account found with this email address.' });
  }

  user.password_hash = await bcrypt.hash(newPassword, 10);
  user.temp_password = null;
  user.password_reset_required = false;
  await user.save();

  Otp.deleteOne({ email }).catch(() => {});

  res.json({ success: true, user: sanitizeUser(user) });
});

export default router;
