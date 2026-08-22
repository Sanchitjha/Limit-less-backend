/**
 * Proxy for the Limitless Executive AI Coach API
 * (https://limitless-executive.160-153-179-249.sslip.io) — a separate
 * service covering consent, the cognitive task battery, PSS10/CBI/WHO5
 * questionnaires, check-ins, an LLM coach, journal, and recommendations.
 *
 * That API is explicitly server-to-server only — its own docs say:
 * "user_id is a request parameter, not an identity — anyone holding the
 * key can pass any user id and read that person's data... Calling it from
 * the browser would hand every user a master credential."
 *
 * So this proxy's one job is the security boundary: every request is
 * authenticated as a real Limitless user first, and the user_id sent
 * onward is ALWAYS the caller's own verified id (their Mongo _id, reused
 * as-is per the Executive API's own advice, so no mapping table is
 * needed) — the caller can never override it via body, query, or path.
 * The X-API-Key never reaches the frontend.
 *
 * Deliberately a thin, generic pass-through rather than 30 hand-written
 * routes — the Executive API's docs warn against hardcoding its endpoint
 * sequence, since fields/endpoints get added as scores gain components.
 * Business logic / UI for any of this is a separate, later piece of work;
 * this file only makes it safe to build that against.
 */

import { Router } from 'express';
import { config, features } from '../config.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

const REQUEST_TIMEOUT_MS = 30_000;
// The Executive API's own docs: coach turns wait on an LLM and need a
// longer budget than the rest.
const COACH_TIMEOUT_MS = 90_000;

async function forwardToExecutive(req, res, { path, userId }) {
  if (!features.executiveApi) {
    return res.status(501).json({
      error: 'Executive API not configured',
      message: 'Set EXECUTIVE_API_URL and EXECUTIVE_API_KEY in your environment variables.',
    });
  }

  const url = new URL(`${config.executiveApiUrl}${path}`);
  for (const [key, value] of Object.entries(req.query)) {
    if (key === 'user_id') continue; // never let the caller set this
    url.searchParams.set(key, value);
  }
  if (userId) url.searchParams.set('user_id', userId);

  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  let body;
  if (hasBody) {
    const payload = { ...(req.body || {}) };
    // POST /v1/users takes user_id in the body, not the query string.
    if (userId) payload.user_id = userId;
    body = JSON.stringify(payload);
  }

  const timeout = path === '/v1/coach/turn' ? COACH_TIMEOUT_MS : REQUEST_TIMEOUT_MS;

  let response;
  try {
    response = await fetch(url, {
      method: req.method,
      headers: {
        'X-API-Key': config.executiveApiKey,
        ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      },
      body,
      signal: AbortSignal.timeout(timeout),
    });
  } catch (err) {
    return res.status(502).json({ error: `Could not reach the Executive API (${err.message})` });
  }

  const text = await response.text();
  res.status(response.status);
  const contentType = response.headers.get('content-type');
  if (contentType) res.type(contentType);
  res.send(text);
}

// Pure infra checks — no user data, and the Executive API doesn't require
// its key for these two — so no Limitless login is required either.
router.get('/health', (req, res) => forwardToExecutive(req, res, { path: '/v1/health' }));
router.get('/ready', (req, res) => forwardToExecutive(req, res, { path: '/v1/ready' }));

router.use(requireAuth);

router.use((req, res, next) => {
  if (req.auth.role === 'admin') {
    return res.status(400).json({
      error: 'This proxy is for a logged-in user\'s own Executive data — admin tokens have no corresponding Executive user_id.',
    });
  }
  next();
});

// Catch-all: every other /api/v1/executive/<path> forwards to
// {EXECUTIVE_API_URL}/v1/<path> as the authenticated caller.
router.all(/.*/, (req, res) => {
  let path = req.path;

  // /users/{user_id}[/consent] carries the id IN THE PATH, not the query
  // string — the query-string forcing in forwardToExecutive doesn't touch
  // it. Force it here too, or a caller could read/edit/delete someone
  // else's Executive profile just by putting their id in the URL.
  const usersMatch = path.match(/^\/users\/[^/]+(\/.*)?$/);
  if (usersMatch) {
    path = `/users/${req.auth.userId}${usersMatch[1] || ''}`;
  }

  forwardToExecutive(req, res, { path: `/v1${path}`, userId: req.auth.userId });
});

export default router;
