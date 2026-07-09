import { Router } from 'express';
import mongoose from 'mongoose';
import { User } from '../db/models/User.js';
import { Assessment, sanitizeAssessment } from '../db/models/Assessment.js';
import { requireDb, requireSelfOrAdmin } from '../middleware/auth.js';
import { assert } from '../middleware/validate.js';
import { buildReportPdf } from '../services/pdfService.js';
import { savePdf, buildPublicPdfUrl } from '../services/fileStorage.js';
import { sendPdfEmail } from '../services/emailService.js';

const router = Router();
router.use(requireDb);

/**
 * POST /api/reports/:userId/pdf — one-call server-side flow:
 * generates the PDF, stores it in GridFS, saves the public URL on the user's
 * latest assessment (created if missing), and optionally emails the link.
 *
 * Body: { analysis: <report JSON>, brand?, teaser?: boolean, sendEmail?: boolean }
 * Response: { pdfUrl, fileName, assessment }
 * Auth: the user themself, or an admin.
 */
router.post('/:userId/pdf', requireSelfOrAdmin('userId'), async (req, res) => {
  const { userId } = req.params;
  assert(mongoose.isValidObjectId(userId), 'userId must be a valid id', ['userId']);

  const body = req.body || {};
  assert(body.analysis && typeof body.analysis === 'object', 'analysis is required', ['analysis']);
  const teaser = body.teaser === true;

  const user = await User.findById(userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const buffer = await buildReportPdf(body.analysis, body.brand, { teaser });

  const date = new Date().toISOString().split('T')[0];
  const fileName = teaser
    ? `limitless_cognitive_teaser_${date}.pdf`
    : `limitless_cognitive_report_${date}.pdf`;

  await savePdf(userId, fileName, buffer);
  const pdfUrl = buildPublicPdfUrl(req, userId, fileName);

  // Persist onto the latest assessment (only full reports "own" pdf_url).
  let assessment = await Assessment.findOne({ user_id: userId }).sort({ created_at: -1 });
  if (!assessment) assessment = new Assessment({ user_id: userId, report_json: body.analysis });
  if (!teaser) assessment.pdf_url = pdfUrl;
  if (!assessment.report_json) assessment.report_json = body.analysis;
  await assessment.save();

  if (body.sendEmail === true) {
    sendPdfEmail({ name: user.name, email: user.email, pdfUrl }).catch(() => {});
  }

  res.status(201).json({ pdfUrl, fileName, assessment: sanitizeAssessment(assessment) });
});

export default router;
