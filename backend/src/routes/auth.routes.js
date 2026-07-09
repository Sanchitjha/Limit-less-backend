import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { User, sanitizeUser } from '../db/models/User.js';
import { Assessment, sanitizeAssessment } from '../db/models/Assessment.js';
import { requireDb, signUserToken } from '../middleware/auth.js';
import { assert, asInt, asString } from '../middleware/validate.js';
import { sendCredentialsEmail, sendAdminNotification } from '../services/emailService.js';

const router = Router();
router.use(requireDb);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const generateTempPassword = () =>
  Math.random().toString(36).slice(-8).toUpperCase().padEnd(8, 'X');

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
