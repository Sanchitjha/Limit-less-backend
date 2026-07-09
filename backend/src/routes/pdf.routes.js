import { Router } from 'express';
import { buildReportPdf } from '../services/pdfService.js';
import { assert } from '../middleware/validate.js';

const router = Router();

const sendPdf = async (res, analysis, brand, teaser) => {
  const buffer = await buildReportPdf(analysis, brand, { teaser });
  const fileName = teaser
    ? `Limitless_Cognitive_Teaser_${new Date().toISOString().split('T')[0]}.pdf`
    : `Limitless_Cognitive_Report_${new Date().toISOString().split('T')[0]}.pdf`;
  res
    .status(200)
    .set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Content-Length': buffer.length,
    })
    .send(buffer);
};

/**
 * POST /api/v1/generate-pdf
 * Body: { analysis: <report JSON>, brand?: { primaryColor, accentColor } }
 * Response: application/pdf (full report)
 */
router.post('/generate-pdf', async (req, res) => {
  const { analysis, brand } = req.body || {};
  assert(analysis && typeof analysis === 'object', 'analysis is required', ['analysis']);
  await sendPdf(res, analysis, brand, false);
});

/**
 * POST /api/v1/generate-teaser-pdf
 * Body: { analysis: <report JSON>, brand?: {...} }
 * Response: application/pdf (free preview with locked sections)
 */
router.post('/generate-teaser-pdf', async (req, res) => {
  const { analysis, brand } = req.body || {};
  assert(analysis && typeof analysis === 'object', 'analysis is required', ['analysis']);
  await sendPdf(res, analysis, brand, true);
});

export default router;
