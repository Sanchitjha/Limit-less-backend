/**
 * Client for the AI report-generation model service ("Akshay's model") —
 * the Python service that owns cognitive analysis and PDF rendering.
 *
 * This backend must NEVER generate its own assessment PDF locally — every
 * downloadable report has to come from this service so the content the user
 * downloads always matches the model's own scoring/branding. There is no
 * local fallback on failure: if the model service is unreachable we surface
 * a clear error instead of silently serving a different-looking PDF.
 */

import { config } from '../config.js';

const REQUEST_TIMEOUT_MS = 120_000;

/**
 * @param {object} analysis - the report JSON produced by the model's /analyze endpoint
 * @param {object} [brand] - { primaryColor, accentColor }
 * @param {{teaser?: boolean}} [opts]
 * @returns {Promise<Buffer>} the PDF bytes exactly as returned by the model service
 */
export async function generateModelPdf(analysis, brand, { teaser = false } = {}) {
  const endpoint = teaser ? '/api/v1/generate-teaser-pdf' : '/api/v1/generate-pdf';
  const url = `${config.modelServiceUrl}${endpoint}`;

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ analysis, brand }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    throw new Error(`Could not reach the report generation model (${err.message})`);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(
      `Report generation model returned ${response.status}: ${text.slice(0, 300) || 'no body'}`
    );
  }

  const contentType = response.headers.get('content-type') || '';
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  if (!contentType.includes('pdf') && buffer.subarray(0, 5).toString('latin1') !== '%PDF-') {
    throw new Error('Report generation model did not return a valid PDF');
  }

  return buffer;
}
