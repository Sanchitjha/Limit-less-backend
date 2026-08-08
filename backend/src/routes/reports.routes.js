import { Router } from 'express';
import mongoose from 'mongoose';
import { User } from '../db/models/User.js';
import { Assessment, sanitizeAssessment } from '../db/models/Assessment.js';
import { requireDb, requireSelfOrAdmin } from '../middleware/auth.js';
import { assert } from '../middleware/validate.js';
import { generateModelPdf, assertValidAnalysis } from '../services/modelService.js';
import { savePdf, buildPublicPdfUrl } from '../services/fileStorage.js';
import { sendPdfEmail } from '../services/emailService.js';

const router = Router();
router.use(requireDb);

/**
 * POST /api/reports/:userId/pdf — one-call server-side flow:
 * generates the PDF via the AI model service ("Akshay's model" — the sole
 * source of truth for report content), stores it in GridFS keyed to the
 * specific assessment, saves the public URL on that assessment, and
 * optionally emails the link.
 *
 * Body: { analysis?: <report JSON>, assessmentId?, brand?, teaser?: boolean, sendEmail?: boolean }
 *   - assessmentId selects which assessment this PDF belongs to (required to
 *     support users with multiple assessments — omitting it falls back to
 *     the user's latest assessment for backward compatibility).
 *   - `analysis` is now OPTIONAL: if the selected assessment already has a
 *     stored `report_json` (from an earlier /analyze auto-save or a POST
 *     /api/assessments call), that's used automatically — the client
 *     doesn't have to re-paste the full analysis object on every PDF call.
 *     Pass `analysis` explicitly only to override/refresh what's stored.
 * Response: { pdfUrl, fileName, assessment }
 * Auth: the user themself, or an admin.
 */
router.post('/:userId/pdf', requireSelfOrAdmin('userId'), async (req, res) => {
  const { userId } = req.params;
  assert(mongoose.isValidObjectId(userId), 'userId must be a valid id', ['userId']);

  const body = req.body || {};
  const teaser = body.teaser === true;

  const user = await User.findById(userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  // Server-side paywall enforcement: a full (non-teaser) report may only be
  // generated for an account with an active premium subscription — closes
  // the gap where an expired/pending account could still fetch a full PDF
  // by calling this endpoint directly.
  if (!teaser && user.payment_status !== 'paid') {
    return res.status(403).json({
      error: 'This account does not have an active premium subscription.',
    });
  }

  // Resolve which assessment this PDF belongs to. Multiple assessments per
  // user are supported — never assume "the latest one".
  let assessment = null;
  if (body.assessmentId !== undefined) {
    assert(
      mongoose.isValidObjectId(body.assessmentId),
      'assessmentId must be a valid id',
      ['assessmentId']
    );
    assessment = await Assessment.findOne({ _id: body.assessmentId, user_id: userId });
    if (!assessment) {
      return res.status(404).json({ error: 'Assessment not found for this user' });
    }
  } else {
    // Backward-compat fallback for callers that don't send assessmentId yet.
    assessment = await Assessment.findOne({ user_id: userId }).sort({ created_at: -1 });
    if (!assessment) assessment = new Assessment({ user_id: userId, report_json: body.analysis });
  }

  // Prefer an explicitly-passed analysis (lets a caller refresh/override),
  // otherwise fall back to whatever this assessment already has stored.
  const analysis = body.analysis ?? assessment.report_json;
  assertValidAnalysis(analysis);

  let buffer;
  try {
    buffer = await generateModelPdf(analysis, body.brand, { teaser });
  } catch (err) {
    console.error(`[reports] PDF generation failed for user ${userId}:`, err.message);
    const isUnreachable = /could not reach|ECONNREFUSED|ENOTFOUND|timeout/i.test(err.message);
    const status = isUnreachable ? 502 : 500;
    return res.status(status).json({
      error: isUnreachable
        ? 'The report generation service is currently unreachable. Please try again later.'
        : 'PDF generation failed. Make sure the "analysis" body is the full, unmodified object returned by /api/v1/analyze.',
      detail: err.message,
    });
  }

  // Filename is keyed to the specific assessment (not the current date) so
  // two assessments generated the same day never collide/overwrite in GridFS.
  const fileName = teaser
    ? `limitless_cognitive_teaser_${assessment._id}.pdf`
    : `limitless_cognitive_report_${assessment._id}.pdf`;

  await savePdf(userId, fileName, buffer);
  const pdfUrl = buildPublicPdfUrl(req, userId, fileName);

  // Full reports "own" pdf_url on their assessment; teasers are never stored there.
  if (!teaser) assessment.pdf_url = pdfUrl;
  if (!assessment.report_json) assessment.report_json = analysis;
  await assessment.save();

  if (body.sendEmail === true) {
    sendPdfEmail({ name: user.name, email: user.email, pdfUrl }).catch(() => {});
  }

  res.status(201).json({ pdfUrl, fileName, assessment: sanitizeAssessment(assessment) });
});

export default router;
