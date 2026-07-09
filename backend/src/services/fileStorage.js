/**
 * PDF storage in MongoDB GridFS — replaces the Supabase "pdf-reports" bucket.
 * Files are addressed as "<userId>/<fileName>" and served publicly via
 * GET /files/pdf-reports/:userId/:fileName (see files.routes.js).
 */

import mongoose from 'mongoose';
import path from 'node:path';
import { config } from '../config.js';

const BUCKET_NAME = 'pdf-reports';

const getBucket = () =>
  new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: BUCKET_NAME });

/** Allow only simple, safe file names and force a .pdf extension. */
export function sanitizeFileName(raw) {
  const base = path.basename(String(raw || '')).replace(/[^\w.\-() ]+/g, '_');
  const trimmed = base.slice(0, 150) || `report_${Date.now()}.pdf`;
  return trimmed.toLowerCase().endsWith('.pdf') ? trimmed : `${trimmed}.pdf`;
}

export function buildPublicPdfUrl(req, userId, fileName) {
  const base =
    config.publicBaseUrl || `${req.protocol}://${req.get('host')}`;
  return `${base}/files/pdf-reports/${userId}/${encodeURIComponent(fileName)}`;
}

/** Upsert semantics: replaces any existing file with the same name. */
export async function savePdf(userId, fileName, buffer) {
  const bucket = getBucket();
  const filename = `${userId}/${fileName}`;

  const existing = await bucket.find({ filename }).toArray();
  for (const file of existing) {
    await bucket.delete(file._id).catch(() => {});
  }

  await new Promise((resolve, reject) => {
    const stream = bucket.openUploadStream(filename, {
      contentType: 'application/pdf',
      metadata: { userId: String(userId) },
    });
    stream.on('finish', resolve);
    stream.on('error', reject);
    stream.end(buffer);
  });

  return filename;
}

/** Returns { file, stream } or null when the file doesn't exist. */
export async function openPdf(userId, fileName) {
  const bucket = getBucket();
  const filename = `${userId}/${fileName}`;
  const [file] = await bucket.find({ filename }).limit(1).toArray();
  if (!file) return null;
  return { file, stream: bucket.openDownloadStream(file._id) };
}

/** Delete every stored PDF belonging to a user (admin user deletion). */
export async function deleteUserFiles(userId) {
  const bucket = getBucket();
  const files = await bucket
    .find({ filename: { $regex: `^${String(userId)}/` } })
    .toArray();
  for (const file of files) {
    await bucket.delete(file._id).catch(() => {});
  }
  return files.length;
}
