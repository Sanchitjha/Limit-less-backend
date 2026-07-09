import { Router } from 'express';
import mongoose from 'mongoose';
import { User } from '../db/models/User.js';
import { Assessment, sanitizeAssessment } from '../db/models/Assessment.js';
import { requireDb, requireAuth } from '../middleware/auth.js';
import { assert } from '../middleware/validate.js';

const router = Router();
router.use(requireDb);

/**
 * POST /api/assessments — create an assessment record.
 * Body: { user_id, report_json?, pdf_url? }
 * Auth: the user themself (user_id must match the token), or an admin.
 */
router.post('/', requireAuth, async (req, res) => {
  const body = req.body || {};
  const userId = String(body.user_id || '');
  assert(mongoose.isValidObjectId(userId), 'user_id must be a valid id', ['user_id']);

  if (req.auth.role !== 'admin' && req.auth.userId !== userId) {
    return res.status(403).json({ error: 'You can only create assessments for your own account' });
  }

  const user = await User.findById(userId).lean();
  if (!user) return res.status(404).json({ error: 'User not found' });

  const assessment = await Assessment.create({
    user_id: userId,
    report_json: body.report_json ?? null,
    pdf_url: body.pdf_url ? String(body.pdf_url).slice(0, 2000) : null,
  });

  res.status(201).json(sanitizeAssessment(assessment));
});

/**
 * PATCH /api/assessments/:id — update report_json and/or pdf_url.
 * Auth: the owning user, or an admin.
 */
router.patch('/:id', requireAuth, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(404).json({ error: 'Assessment not found' });
  }
  const assessment = await Assessment.findById(req.params.id);
  if (!assessment) return res.status(404).json({ error: 'Assessment not found' });

  if (req.auth.role !== 'admin' && req.auth.userId !== String(assessment.user_id)) {
    return res.status(403).json({ error: 'You can only update your own assessments' });
  }

  const body = req.body || {};
  if (body.report_json !== undefined) assessment.report_json = body.report_json;
  if (body.pdf_url !== undefined) assessment.pdf_url = String(body.pdf_url).slice(0, 2000);
  await assessment.save();

  res.json(sanitizeAssessment(assessment));
});

export default router;
