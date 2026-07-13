import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { config, features } from '../config.js';
import { User, sanitizeUser } from '../db/models/User.js';
import { Assessment, sanitizeAssessment } from '../db/models/Assessment.js';
import { Otp } from '../db/models/Otp.js';
import { requireDb, signUserToken } from '../middleware/auth.js';
import { assert, asInt, asString } from '../middleware/validate.js';
import {
  sendCredentialsEmail,
  sendAdminNotification,
  sendOtpEmail,
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

/**
 * POST /api/auth/send-otp
 * Body: { email, name? }
 * Emails a 6-digit verification code (10 min validity, 60s resend cooldown).
 * 409 if the email is already registered. In non-production environments
 * WITHOUT SMTP configured, the code is returned as `devOtp` for testing.
 */
router.post('/send-otp', async (req, res) => {
  const body = req.body || {};
  const email = asString(body.email, 'email', { required: true, maxLength: 320 }).toLowerCase();
  assert(EMAIL_RE.test(email), 'email must be a valid email address', ['email']);
  const name = asString(body.name, 'name', { required: false, maxLength: 200 });

  const existingUser = await User.findOne({ email }).lean();
  if (existingUser) {
    return res.status(409).json({ error: 'This email is already registered. Please log in instead.' });
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
 * Marks the email as verified (valid for 30 minutes to complete registration).
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

  res.json({ verified: true });
});

/** Match either the plaintext temp password or the bcrypt hash. */
const passwordMatches = async (user, password) => {
  if (user.temp_password && password === user.temp_password) return true;
  if (user.password_hash) return bcrypt.compare(password, user.password_hash);
  return false;
};

/**
 * POST /api/auth/register
 * Body: { name, email, age?, gender?, paymentStatus?: 'pending'|'demo',
 *         passwordResetRequired?: boolean }
 * Creates the user with a generated temporary password (shown once) and
 * returns a JWT. Sends credentials + admin-notification emails when SMTP
 * is configured (best-effort). The demo flow registers with
 * paymentStatus:'demo' and passwordResetRequired:false.
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
  // Self-registration may only create free/demo accounts — never 'paid'.
  const paymentStatus = body.paymentStatus === 'demo' ? 'demo' : 'pending';
  const passwordResetRequired = body.passwordResetRequired === false ? false : true;

  const existing = await User.findOne({ email }).lean();
  if (existing) {
    return res.status(409).json({ error: 'This email is already registered. Please log in instead.' });
  }

  // Email must be verified with an OTP first (disable with OTP_REQUIRED=false)
  if (config.otpRequired) {
    const otpRecord = await Otp.findOne({ email, verified: true, expires_at: { $gt: new Date() } });
    if (!otpRecord) {
      return res.status(403).json({ error: 'Please verify your email with the OTP first.' });
    }
  }

  const tempPassword = generateTempPassword();
  const passwordHash = await bcrypt.hash(tempPassword, 10);

  const user = await User.create({
    name,
    email,
    temp_password: tempPassword,
    password_hash: passwordHash,
    password_reset_required: passwordResetRequired,
    payment_status: paymentStatus,
    age,
    gender,
  });

  // Consume the OTP so it can't be reused
  Otp.deleteOne({ email }).catch(() => {});

  // Best-effort emails — never block or fail registration.
  sendCredentialsEmail({ name, email, tempPassword, paymentStatus: user.payment_status }).catch(() => {});
  sendAdminNotification({ name, email, age, gender }).catch(() => {});

  res.status(201).json({
    user: sanitizeUser(user),
    tempPassword,
    token: signUserToken(user._id),
  });
});

/**
 * POST /api/auth/login
 * Body: { email, password }
 * Accepts the temporary password OR the user-set password.
 * Returns a JWT, the user, and their latest assessment (if any).
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

  res.json({
    token: signUserToken(user._id),
    user: sanitizeUser(user),
    latestAssessment: latest ? sanitizeAssessment(latest) : null,
  });
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

export default router;
