import { Router, raw } from 'express';
import { requireDb, requireSelfOrAdmin } from '../middleware/auth.js';
import {
  sanitizeFileName,
  savePdf,
  openPdf,
  buildPublicPdfUrl,
} from '../services/fileStorage.js';

/**
 * Public file serving — mounted at /files
 * GET /files/pdf-reports/:userId/:fileName → streams the stored PDF.
 * (Equivalent of the old public Supabase bucket URL.)
 */
export const publicFilesRouter = Router();

publicFilesRouter.get('/pdf-reports/:userId/:fileName', requireDb, async (req, res) => {
  const fileName = sanitizeFileName(req.params.fileName);
  const result = await openPdf(req.params.userId, fileName);
  if (!result) return res.status(404).json({ error: 'File not found' });

  res.set({
    'Content-Type': 'application/pdf',
    'Content-Length': result.file.length,
    'Content-Disposition': `inline; filename="${fileName}"`,
    'Cache-Control': 'public, max-age=3600',
  });
  result.stream.on('error', () => res.destroy());
  result.stream.pipe(res);
});

/**
 * Authenticated upload — mounted at /api/files
 * POST /api/files/pdf-reports/:userId?fileName=report.pdf
 * Body: raw application/pdf bytes. Replaces any same-named file.
 * Auth: the user themself, or an admin.
 */
export const apiFilesRouter = Router();

apiFilesRouter.post(
  '/pdf-reports/:userId',
  requireDb,
  requireSelfOrAdmin('userId'),
  raw({ type: ['application/pdf', 'application/octet-stream'], limit: '15mb' }),
  async (req, res) => {
    if (!(req.body instanceof Buffer) || req.body.length === 0) {
      return res.status(400).json({
        error: 'Request body must be the raw PDF bytes (Content-Type: application/pdf)',
      });
    }
    // Basic magic-number check so the public bucket can only serve PDFs.
    if (req.body.subarray(0, 5).toString('latin1') !== '%PDF-') {
      return res.status(400).json({ error: 'Body is not a valid PDF file' });
    }

    const fileName = sanitizeFileName(req.query.fileName || `report_${Date.now()}.pdf`);
    await savePdf(req.params.userId, fileName, req.body);

    res.status(201).json({
      fileName,
      publicUrl: buildPublicPdfUrl(req, req.params.userId, fileName),
    });
  }
);
