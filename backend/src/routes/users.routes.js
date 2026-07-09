import { Router } from 'express';
import mongoose from 'mongoose';
import { User, sanitizeUser, PAYMENT_STATUSES } from '../db/models/User.js';
import { Assessment, sanitizeAssessment } from '../db/models/Assessment.js';
import { requireDb, requireSelfOrAdmin } from '../middleware/auth.js';
import { assert } from '../middleware/validate.js';

const router = Router();
router.use(requireDb);

const validId = (id) => mongoose.isValidObjectId(id);

/**
 * GET /api/users/:id — user + their assessment history (newest first).
 * Auth: the user themself, or an admin.
 */
router.get('/:id', requireSelfOrAdmin('id'), async (req, res) => {
  if (!validId(req.params.id)) return res.status(404).json({ error: 'User not found' });

  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const assessments = await Assessment.find({ user_id: user._id }).sort({ created_at: -1 });
  res.json({
    ...sanitizeUser(user, { includeCredentials: req.auth.role === 'admin' }),
    assessments: assessments.map(sanitizeAssessment),
  });
});

/**
 * PATCH /api/users/:id — update profile / payment status.
 * Auth: the user themself, or an admin.
 *
 * Accepted fields: name, age, gender, payment_status.
 * Compatibility: report_json / pdf_url are accepted too and stored on the
 * user's LATEST assessment (created if none exists) — mirrors how the old
 * frontend wrote reports onto the user row.
 */
router.patch('/:id', requireSelfOrAdmin('id'), async (req, res) => {
  if (!validId(req.params.id)) return res.status(404).json({ error: 'User not found' });

  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const body = req.body || {};
  if (body.name !== undefined) user.name = String(body.name).slice(0, 200);
  if (body.email !== undefined) {
    const email = String(body.email).trim().toLowerCase();
    assert(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), 'email must be a valid email address', ['email']);
    if (email !== user.email) {
      const exists = await User.findOne({ email, _id: { $ne: user._id } }).lean();
      if (exists) return res.status(409).json({ error: 'This email is already in use by another account.' });
      user.email = email;
    }
  }
  if (body.age !== undefined && body.age !== null) {
    const age = parseInt(body.age, 10);
    assert(Number.isFinite(age) && age >= 10 && age <= 120, 'age must be between 10 and 120', ['age']);
    user.age = age;
  }
  if (body.gender !== undefined) user.gender = String(body.gender).slice(0, 30);
  if (body.payment_status !== undefined) {
    assert(
      PAYMENT_STATUSES.includes(body.payment_status),
      `payment_status must be one of: ${PAYMENT_STATUSES.join(', ')}`,
      ['payment_status']
    );
    user.payment_status = body.payment_status;
  }
  await user.save();

  // Compatibility path: persist report/PDF onto the latest assessment.
  let assessment = null;
  if (body.report_json !== undefined || body.pdf_url !== undefined) {
    assessment = await Assessment.findOne({ user_id: user._id }).sort({ created_at: -1 });
    if (!assessment) assessment = new Assessment({ user_id: user._id });
    if (body.report_json !== undefined) assessment.report_json = body.report_json;
    if (body.pdf_url !== undefined) assessment.pdf_url = String(body.pdf_url).slice(0, 2000);
    await assessment.save();
  }

  res.json({
    ...sanitizeUser(user, { includeCredentials: req.auth.role === 'admin' }),
    ...(assessment ? { latestAssessment: sanitizeAssessment(assessment) } : {}),
  });
});

export default router;
