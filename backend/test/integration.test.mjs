/**
 * End-to-end integration test against an in-memory MongoDB.
 * Run: npm test   (spins up mongod, boots the app, exercises every endpoint)
 */

import assert from 'node:assert/strict';
import http from 'node:http';
import { MongoMemoryServer } from 'mongodb-memory-server';

// A minimal stand-in for the AI report-generation model service ("Akshay's
// model"). Returns a distinct, recognizable PDF per call so tests can prove
// the backend proxies to THIS service (never generates PDFs itself) and
// correctly maps each PDF to a specific assessment.
let modelServiceCallCount = 0;
const modelServiceRequests = [];
const fakePdf = (label) => Buffer.from(`%PDF-1.4\n% mock-model-pdf:${label}\n%%EOF`);
const modelService = http.createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    modelServiceCallCount += 1;
    let parsed = {};
    try { parsed = JSON.parse(body); } catch { /* ignore */ }
    modelServiceRequests.push({ path: req.url, body: parsed });
    const teaser = req.url.includes('teaser');
    const label = `${teaser ? 'teaser' : 'full'}:${parsed?.analysis?.assessmentId ?? 'none'}:${modelServiceCallCount}`;
    res.writeHead(200, { 'Content-Type': 'application/pdf' });
    res.end(fakePdf(label));
  });
});
await new Promise((resolve) => modelService.listen(0, resolve));
process.env.MODEL_SERVICE_URL = `http://127.0.0.1:${modelService.address().port}`;

const results = [];
const check = (name, fn) =>
  Promise.resolve()
    .then(fn)
    .then(() => {
      results.push(['PASS', name]);
      console.log(`  ✔ ${name}`);
    })
    .catch((err) => {
      results.push(['FAIL', name]);
      console.error(`  ✖ ${name}\n    ${err.message}`);
      process.exitCode = 1;
    });

console.log('Starting in-memory MongoDB...');
const mongod = await MongoMemoryServer.create();

process.env.MONGODB_URI = mongod.getUri();
process.env.MONGODB_DB_NAME = 'limitless_test';
process.env.JWT_SECRET = 'test-secret';
process.env.ADMIN_USERNAME = 'admin';
process.env.ADMIN_PASSWORD = 'limitlessadmin';
process.env.PORT = '0';
// Never send real emails from tests (also enables devOtp in send-otp responses)
process.env.SMTP_HOST = '';
process.env.SMTP_USER = '';
process.env.SMTP_PASS = '';
process.env.NODE_ENV = 'test';
process.env.GOOGLE_CLIENT_IDS = 'test-google-client-id';
process.env.APPLE_CLIENT_IDS = 'test-apple-client-id';
// Never hit real Stripe from tests, regardless of what .env has locally.
process.env.STRIPE_SECRET_KEY = '';

// Stub Google's real network verification with a fake payload passed straight
// through as the "idToken" (JSON string) — keeps the test offline while still
// exercising the real route/account-linking logic around it.
const { OAuth2Client } = await import('google-auth-library');
OAuth2Client.prototype.verifyIdToken = async function ({ idToken }) {
  return { getPayload: () => JSON.parse(idToken) };
};

const { connectMongo, disconnectMongo } = await import('../src/db/mongo.js');
await connectMongo();
const { User } = await import('../src/db/models/User.js');
const { default: app } = await import('../src/app.js');
const { findOrCreateSocialUser } = await import('../src/routes/auth.routes.js');

const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

const api = async (method, path, { body, token, raw: rawBody, contentType } = {}) => {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (rawBody) {
    headers['Content-Type'] = contentType || 'application/pdf';
    payload = rawBody;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${path}`, { method, headers, body: payload });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await res.json() : await res.arrayBuffer();
  return { status: res.status, data, contentType: ct };
};

let userToken, userId, adminToken, tempPassword, assessmentId, analysis, pdfUrl, firstAssessmentId;

// ── Health & stateless engine ────────────────────────────────────────────────

await check('GET /health reports database enabled', async () => {
  const r = await api('GET', '/health');
  assert.equal(r.status, 200);
  assert.equal(r.data.features.database, true);
});

let questions;
await check('POST /api/v1/generate-questions', async () => {
  const r = await api('POST', '/api/v1/generate-questions', {
    body: { age: 25, gender: 'male', locale: 'en' },
  });
  assert.equal(r.status, 200);
  assert.ok(r.data.assessmentId);
  assert.equal(r.data.sections.length, 7);
  questions = r.data;
});

// ── Auth flow ────────────────────────────────────────────────────────────────

/** Send + verify an OTP for an email (uses devOtp from the response). */
const verifyEmailOtp = async (email) => {
  const sent = await api('POST', '/api/auth/send-otp', { body: { email } });
  assert.equal(sent.status, 200);
  assert.ok(sent.data.devOtp, 'devOtp expected when SMTP is not configured');
  const verified = await api('POST', '/api/auth/verify-otp', {
    body: { email, otp: sent.data.devOtp },
  });
  assert.equal(verified.status, 200);
  return sent.data.devOtp;
};

await check('POST /api/auth/register creates the account immediately (no OTP needed first)', async () => {
  const r = await api('POST', '/api/auth/register', {
    body: { name: 'Test User', email: 'Test.User@Example.com', age: 25, gender: 'male' },
  });
  assert.equal(r.status, 201);
  assert.equal(r.data.user.email, 'test.user@example.com'); // lowercased
  assert.equal(r.data.user.payment_status, 'pending');
  assert.equal(r.data.user.password_reset_required, true);
  assert.equal(r.data.user.email_verified, false, 'not verified until send-otp + verify-otp run afterward');
  assert.ok(r.data.tempPassword.length >= 8);
  assert.ok(r.data.token);
  userToken = r.data.token;
  userId = r.data.user.id;
  tempPassword = r.data.tempPassword;
});

await check('register with own password → login works immediately, no tempPassword issued', async () => {
  const r = await api('POST', '/api/auth/register', {
    body: { name: 'Own Pw', email: 'ownpw@example.com', password: 'MyOwnPass123' },
  });
  assert.equal(r.status, 201);
  assert.equal(r.data.tempPassword, null);
  assert.equal(r.data.user.password_reset_required, false);

  const login = await api('POST', '/api/auth/login', {
    body: { email: 'ownpw@example.com', password: 'MyOwnPass123' },
  });
  assert.equal(login.status, 200);
});

await check('register with too-short own password → 422', async () => {
  const r = await api('POST', '/api/auth/register', {
    body: { name: 'Short Pw', email: 'shortpw@example.com', password: '123' },
  });
  assert.equal(r.status, 422);
});

await check('register duplicate email → 409', async () => {
  const r = await api('POST', '/api/auth/register', {
    body: { name: 'Dup', email: 'test.user@example.com' },
  });
  assert.equal(r.status, 409);
});

await check('login with temp password works', async () => {
  const r = await api('POST', '/api/auth/login', {
    body: { email: 'test.user@example.com', password: tempPassword },
  });
  assert.equal(r.status, 200);
  assert.ok(r.data.token);
  assert.equal(r.data.latestAssessment, null);
});

await check('login with wrong password → 401', async () => {
  const r = await api('POST', '/api/auth/login', {
    body: { email: 'test.user@example.com', password: 'WRONG' },
  });
  assert.equal(r.status, 401);
});

await check('change-password clears temp password + reset flag', async () => {
  const r = await api('POST', '/api/auth/change-password', {
    body: {
      email: 'test.user@example.com',
      currentPassword: tempPassword,
      newPassword: 'NewPass123',
    },
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.user.password_reset_required, false);

  const oldLogin = await api('POST', '/api/auth/login', {
    body: { email: 'test.user@example.com', password: tempPassword },
  });
  assert.equal(oldLogin.status, 401, 'temp password must no longer work');

  const newLogin = await api('POST', '/api/auth/login', {
    body: { email: 'test.user@example.com', password: 'NewPass123' },
  });
  assert.equal(newLogin.status, 200);
});

await check('post-registration: send-otp + wrong code → 400, correct code verifies the account', async () => {
  const sent = await api('POST', '/api/auth/send-otp', { body: { email: 'test.user@example.com' } });
  assert.equal(sent.status, 200);
  assert.ok(sent.data.devOtp);

  const bad = await api('POST', '/api/auth/verify-otp', {
    body: { email: 'test.user@example.com', otp: '000000' },
  });
  assert.equal(bad.status, 400);
  assert.equal(bad.data.error, 'OTP invalid');

  const good = await api('POST', '/api/auth/verify-otp', {
    body: { email: 'test.user@example.com', otp: sent.data.devOtp },
  });
  assert.equal(good.status, 200);
  assert.equal(good.data.verified, true);
  assert.equal(good.data.emailVerified, true, 'the user record should now be flagged verified');

  const profile = await api('GET', `/api/users/${userId}`, { token: userToken });
  assert.equal(profile.data.email_verified, true);
});

await check('send-otp resend within cooldown → 429', async () => {
  await api('POST', '/api/auth/register', { body: { name: 'Cooldown', email: 'cooldown@example.com' } });
  await api('POST', '/api/auth/send-otp', { body: { email: 'cooldown@example.com' } });
  const r = await api('POST', '/api/auth/send-otp', { body: { email: 'cooldown@example.com' } });
  assert.equal(r.status, 429);
});

await check('send-otp for an already-verified email → 409', async () => {
  const r = await api('POST', '/api/auth/send-otp', { body: { email: 'test.user@example.com' } });
  assert.equal(r.status, 409);
  assert.equal(r.data.error, 'This email is already verified. Please log in instead.');
});

await check('forgot-password → unknown email is 404', async () => {
  const r = await api('POST', '/api/auth/forgot-password', { body: { email: 'nobody@example.com' } });
  assert.equal(r.status, 404);
});

await check('forgot-password + reset-password sets a new password', async () => {
  const sent = await api('POST', '/api/auth/forgot-password', { body: { email: 'test.user@example.com' } });
  assert.equal(sent.status, 200);
  assert.ok(sent.data.devOtp);

  const badOtp = await api('POST', '/api/auth/reset-password', {
    body: { email: 'test.user@example.com', otp: '000000', newPassword: 'ResetPass123' },
  });
  assert.equal(badOtp.status, 400);

  const r = await api('POST', '/api/auth/reset-password', {
    body: { email: 'test.user@example.com', otp: sent.data.devOtp, newPassword: 'ResetPass123' },
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.user.password_reset_required, false);

  const oldLogin = await api('POST', '/api/auth/login', {
    body: { email: 'test.user@example.com', password: 'NewPass123' },
  });
  assert.equal(oldLogin.status, 401, 'previous password must no longer work');

  const newLogin = await api('POST', '/api/auth/login', {
    body: { email: 'test.user@example.com', password: 'ResetPass123' },
  });
  assert.equal(newLogin.status, 200);
});

await check('logout revokes the token — further requests with it are rejected', async () => {
  const loginRes = await api('POST', '/api/auth/login', {
    body: { email: 'test.user@example.com', password: 'ResetPass123' },
  });
  assert.equal(loginRes.status, 200);
  const disposableToken = loginRes.data.token;

  const before = await api('GET', `/api/users/${userId}`, { token: disposableToken });
  assert.equal(before.status, 200);

  const out = await api('POST', '/api/auth/logout', { token: disposableToken });
  assert.equal(out.status, 200);
  assert.equal(out.data.success, true);

  const after = await api('GET', `/api/users/${userId}`, { token: disposableToken });
  assert.equal(after.status, 401);

  // The main userToken used by the rest of the suite (a separate login) is untouched.
  const stillWorks = await api('GET', `/api/users/${userId}`, { token: userToken });
  assert.equal(stillWorks.status, 200);
});

await check('login returns a refreshToken; /refresh exchanges it and rotates it', async () => {
  const loginRes = await api('POST', '/api/auth/login', {
    body: { email: 'test.user@example.com', password: 'ResetPass123' },
  });
  assert.equal(loginRes.status, 200);
  assert.ok(loginRes.data.refreshToken, 'login should return a refreshToken');
  const firstRefreshToken = loginRes.data.refreshToken;

  const refreshed = await api('POST', '/api/auth/refresh', { body: { refreshToken: firstRefreshToken } });
  assert.equal(refreshed.status, 200);
  assert.ok(refreshed.data.token);
  assert.ok(refreshed.data.refreshToken);
  assert.notEqual(refreshed.data.refreshToken, firstRefreshToken, 'refresh token should rotate');

  // The new access token actually works.
  const check1 = await api('GET', `/api/users/${userId}`, { token: refreshed.data.token });
  assert.equal(check1.status, 200);

  // The OLD refresh token was consumed by rotation — reusing it must fail.
  const reused = await api('POST', '/api/auth/refresh', { body: { refreshToken: firstRefreshToken } });
  assert.equal(reused.status, 401);

  // The NEW refresh token still works exactly once more.
  const secondRefresh = await api('POST', '/api/auth/refresh', { body: { refreshToken: refreshed.data.refreshToken } });
  assert.equal(secondRefresh.status, 200);
});

await check('/refresh rejects a garbage or non-refresh token', async () => {
  const garbage = await api('POST', '/api/auth/refresh', { body: { refreshToken: 'not-a-real-token' } });
  assert.equal(garbage.status, 401);

  // A regular access token is not a refresh token, even though it's validly signed.
  const wrongType = await api('POST', '/api/auth/refresh', { body: { refreshToken: userToken } });
  assert.equal(wrongType.status, 401);
});

await check('logout also revokes a refresh token passed in the body', async () => {
  const loginRes = await api('POST', '/api/auth/login', {
    body: { email: 'test.user@example.com', password: 'ResetPass123' },
  });
  const { token: disposableToken, refreshToken: disposableRefresh } = loginRes.data;

  const out = await api('POST', '/api/auth/logout', {
    token: disposableToken,
    body: { refreshToken: disposableRefresh },
  });
  assert.equal(out.status, 200);

  const afterLogout = await api('POST', '/api/auth/refresh', { body: { refreshToken: disposableRefresh } });
  assert.equal(afterLogout.status, 401);
});

// ── Social sign-in (Google / Apple) ─────────────────────────────────────────

await check('POST /api/auth/google rejects a garbage token', async () => {
  const r = await api('POST', '/api/auth/google', { body: { idToken: 'not-a-real-token' } });
  assert.equal(r.status, 401);
});

await check('POST /api/auth/google creates a new user on first sign-in', async () => {
  const fakeGooglePayload = JSON.stringify({
    sub: 'google-sub-12345',
    email: 'social.google@example.com',
    email_verified: true,
    name: 'Google User',
  });
  const r = await api('POST', '/api/auth/google', { body: { idToken: fakeGooglePayload } });
  assert.equal(r.status, 200);
  assert.equal(r.data.user.email, 'social.google@example.com');
  assert.equal(r.data.user.email_verified, true);
  assert.equal(r.data.user.google_linked, true);
  assert.equal(r.data.user.has_password, false, 'no password was ever set for a pure Google account');
  assert.ok(r.data.token);

  // Signing in again with the same google sub reuses the same account, not a duplicate.
  const again = await api('POST', '/api/auth/google', { body: { idToken: fakeGooglePayload } });
  assert.equal(again.status, 200);
  assert.equal(again.data.user.id, r.data.user.id);
});

await check('POST /api/auth/google links to an existing password account by email', async () => {
  const fakeGooglePayload = JSON.stringify({
    sub: 'google-sub-existing-user',
    email: 'test.user@example.com', // same email as the main password-based test user
    email_verified: true,
    name: 'Test User',
  });
  const r = await api('POST', '/api/auth/google', { body: { idToken: fakeGooglePayload } });
  assert.equal(r.status, 200);
  assert.equal(r.data.user.id, userId, 'links onto the existing account instead of creating a duplicate');
  assert.equal(r.data.user.google_linked, true);
  assert.equal(r.data.user.has_password, true, 'linking does not remove the existing password');
});

await check('POST /api/auth/apple rejects a garbage token', async () => {
  const r = await api('POST', '/api/auth/apple', { body: { identityToken: 'not-a-real-token' } });
  assert.equal(r.status, 401);
});

await check('findOrCreateSocialUser: apple provider creates, links, and reuses correctly', async () => {
  // Exercised directly since faking Apple's real JWKS-signed token isn't
  // worth the fragility — this is the exact logic /api/auth/apple calls
  // after verifying the token, shared with the Google route above.
  const created = await findOrCreateSocialUser({
    provider: 'apple',
    providerId: 'apple-sub-99999',
    email: 'social.apple@example.com',
    name: 'Apple User',
    emailVerified: true,
  });
  assert.equal(created.email, 'social.apple@example.com');
  assert.equal(created.apple_id, 'apple-sub-99999');
  assert.equal(created.email_verified, true);

  const reused = await findOrCreateSocialUser({
    provider: 'apple',
    providerId: 'apple-sub-99999',
    email: 'social.apple@example.com',
    name: 'Apple User',
    emailVerified: true,
  });
  assert.equal(String(reused._id), String(created._id));

  const preExisting = await api('POST', '/api/auth/register', {
    body: { name: 'Apple Link Target', email: 'apple.link.target@example.com', password: 'PlainPass123' },
  });
  assert.equal(preExisting.status, 201);

  const linked = await findOrCreateSocialUser({
    provider: 'apple',
    providerId: 'apple-sub-for-existing-account',
    email: 'apple.link.target@example.com',
    name: 'Apple Link Target',
    emailVerified: true,
  });
  assert.equal(String(linked._id), preExisting.data.user.id, 'links onto the pre-existing account by email');
  assert.equal(linked.apple_id, 'apple-sub-for-existing-account');
});

// ── Analyze with auto-persistence ────────────────────────────────────────────

await check('POST /api/v1/analyze persists assessment when userId given', async () => {
  const items = questions.sections.flatMap((s) => s.items);
  const responses = items.map((it, i) => ({ itemId: it.id, value: i % 5 }));
  const r = await api('POST', '/api/v1/analyze', {
    body: { assessmentId: questions.assessmentId, age: 25, gender: 'male', responses, userId },
  });
  assert.equal(r.status, 200);
  assert.ok(r.data.overall.score >= 0 && r.data.overall.score <= 100);
  assert.ok(r.data.assessmentRecordId, 'assessment should be auto-saved');
  analysis = r.data;
  firstAssessmentId = r.data.assessmentRecordId;
});

// ── Users API ────────────────────────────────────────────────────────────────

await check('GET /api/users/:id without token → 401', async () => {
  const r = await api('GET', `/api/users/${userId}`);
  assert.equal(r.status, 401);
});

await check('GET /api/users/:id returns user + assessments', async () => {
  const r = await api('GET', `/api/users/${userId}`, { token: userToken });
  assert.equal(r.status, 200);
  assert.equal(r.data.assessments.length, 1);
  assert.equal(r.data.assessments[0].report_json.overall.score, analysis.overall.score);
  assert.equal(r.data.password_hash, undefined, 'hash must never leak');
  assert.equal(r.data.temp_password, undefined, 'temp password hidden for non-admin');
});

await check('PATCH /api/users/:id restricts payment_status updates to admin', async () => {
  const r = await api('PATCH', `/api/users/${userId}`, {
    token: userToken,
    body: { payment_status: 'paid' },
  });
  assert.equal(r.status, 403);
});

await check('POST /api/v1/payments/create-checkout-session is protected and creates session', async () => {
  const unauth = await api('POST', '/api/v1/payments/create-checkout-session');
  assert.equal(unauth.status, 401);

  const auth = await api('POST', '/api/v1/payments/create-checkout-session', { token: userToken });
  assert.equal(auth.status, 501); // Since STRIPE_SECRET_KEY is empty in test environment
});

await check('POST /api/v1/webhooks/stripe processes event and marks user paid', async () => {
  process.env.STRIPE_WEBHOOK_SECRET = 'test_webhook_secret';
  const { config: testConfig, features: testFeatures } = await import('../src/config.js');
  testConfig.stripeWebhookSecret = 'test_webhook_secret';
  testFeatures.stripeWebhook = true;

  const payload = JSON.stringify({
    type: 'checkout.session.completed',
    data: {
      object: {
        payment_status: 'paid',
        client_reference_id: userId,
        customer_details: { email: 'test.user@example.com' }
      }
    }
  });

  const t = Math.floor(Date.now() / 1000);
  const crypto = await import('node:crypto');
  const expected = crypto.createHmac('sha256', 'test_webhook_secret').update(`${t}.${payload}`).digest('hex');

  const res = await fetch(`${BASE}/api/v1/webhooks/stripe`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'stripe-signature': `t=${t},v1=${expected}`
    },
    body: payload
  });
  
  assert.equal(res.status, 200);
  
  const user = await User.findById(userId);
  assert.equal(user.payment_status, 'paid');
});

await check('PATCH /api/users/:id report_json compat → updates latest assessment', async () => {
  const r = await api('PATCH', `/api/users/${userId}`, {
    token: userToken,
    body: { report_json: { ...analysis, marker: 'updated' } },
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.latestAssessment.report_json.marker, 'updated');
});

// ── Assessments API ──────────────────────────────────────────────────────────

await check('POST /api/assessments creates a record', async () => {
  const r = await api('POST', '/api/assessments', {
    token: userToken,
    body: { user_id: userId, report_json: analysis },
  });
  assert.equal(r.status, 201);
  assessmentId = r.data.id;
});

await check('PATCH /api/assessments/:id saves pdf_url', async () => {
  const r = await api('PATCH', `/api/assessments/${assessmentId}`, {
    token: userToken,
    body: { pdf_url: 'https://example.com/x.pdf' },
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.pdf_url, 'https://example.com/x.pdf');
});

// ── PDF generation + GridFS storage ─────────────────────────────────────────
// All PDF content must come from the AI model service ("Akshay's model") —
// never generated locally. The mock model service above stands in for it.

await check('POST /api/v1/generate-pdf proxies to the model service', async () => {
  const callsBefore = modelServiceCallCount;
  const r = await api('POST', '/api/v1/generate-pdf', { body: { analysis } });
  assert.equal(r.status, 200);
  assert.ok(r.contentType.includes('application/pdf'));
  assert.ok(Buffer.from(r.data).subarray(0, 5).toString() === '%PDF-');
  assert.equal(modelServiceCallCount, callsBefore + 1, 'must call the model service, not generate locally');
});

await check('POST /api/v1/generate-pdf rejects a placeholder/incomplete analysis with 422, never calling the model', async () => {
  const callsBefore = modelServiceCallCount;
  const r = await api('POST', '/api/v1/generate-pdf', {
    body: { analysis: { '...': 'paste report object from /api/v1/analyze' } },
  });
  assert.equal(r.status, 422);
  assert.ok(r.data.detail[0].msg.includes('missing required field'));
  assert.equal(modelServiceCallCount, callsBefore, 'must fail fast, never reach the model service');
});

await check('POST /api/reports/:userId/pdf rejects non-paid users for full reports (403)', async () => {
  await User.findByIdAndUpdate(userId, { payment_status: 'pending' });
  const blocked = await api('POST', `/api/reports/${userId}/pdf`, {
    token: userToken,
    body: { analysis, assessmentId: firstAssessmentId },
  });
  assert.equal(blocked.status, 403);

  // Teaser generation must still be allowed for non-paid accounts.
  const teaser = await api('POST', `/api/reports/${userId}/pdf`, {
    token: userToken,
    body: { analysis, assessmentId: firstAssessmentId, teaser: true },
  });
  assert.equal(teaser.status, 201);

  // Restore paid status for the remaining tests.
  await User.findByIdAndUpdate(userId, { payment_status: 'paid' });
});

await check('POST /api/reports/:userId/pdf stores PDF from the model service on the given assessment', async () => {
  const callsBefore = modelServiceCallCount;
  const r = await api('POST', `/api/reports/${userId}/pdf`, {
    token: userToken,
    body: { analysis, assessmentId: firstAssessmentId },
  });
  assert.equal(r.status, 201);
  assert.ok(r.data.pdfUrl.includes(`/files/pdf-reports/${userId}/`));
  assert.ok(r.data.pdfUrl.includes(firstAssessmentId), 'filename must be keyed to the assessment id');
  assert.equal(r.data.assessment.id, firstAssessmentId, 'must update the SPECIFIC assessment requested');
  assert.equal(r.data.assessment.pdf_url, r.data.pdfUrl);
  assert.equal(modelServiceCallCount, callsBefore + 1, 'must call the model service, not generate locally');
  pdfUrl = new URL(r.data.pdfUrl);
});

await check('POST /api/reports/:userId/pdf works with just assessmentId — no analysis needed once stored', async () => {
  const callsBefore = modelServiceCallCount;
  const r = await api('POST', `/api/reports/${userId}/pdf`, {
    token: userToken,
    body: { assessmentId: firstAssessmentId, teaser: true }, // no `analysis` — must reuse the stored report_json
  });
  assert.equal(r.status, 201);
  assert.equal(modelServiceCallCount, callsBefore + 1, 'must still reach the model service using the stored analysis');
});

await check('multiple assessments never collide — each keeps its own PDF', async () => {
  const second = await api('POST', `/api/reports/${userId}/pdf`, {
    token: userToken,
    body: { analysis, assessmentId },
  });
  assert.equal(second.status, 201);
  assert.equal(second.data.assessment.id, assessmentId);
  assert.notEqual(second.data.pdfUrl, pdfUrl.href, 'second assessment must get its own PDF URL');

  // Both assessments must retain their own distinct pdf_url afterward.
  const user = await api('GET', `/api/users/${userId}`, { token: userToken });
  const a1 = user.data.assessments.find((a) => a.id === firstAssessmentId);
  const a2 = user.data.assessments.find((a) => a.id === assessmentId);
  assert.equal(a1.pdf_url, pdfUrl.href);
  assert.equal(a2.pdf_url, second.data.pdfUrl);
});

await check('assessmentId not owned by this user is rejected (404)', async () => {
  await verifyEmailOtp('other.owner@example.com');
  const other = await api('POST', '/api/auth/register', {
    body: { name: 'Other Owner', email: 'other.owner@example.com' },
  });
  // A well-formed but unrelated ObjectId (not this user's assessment) must
  // never resolve — otherwise one user could overwrite another's PDF.
  const r = await api('POST', `/api/reports/${userId}/pdf`, {
    token: userToken,
    body: { analysis, assessmentId: other.data.user.id },
  });
  assert.equal(r.status, 404);
});

await check('GET public PDF URL streams the stored PDF', async () => {
  const r = await api('GET', pdfUrl.pathname);
  assert.equal(r.status, 200);
  assert.ok(r.contentType.includes('application/pdf'));
  assert.ok(Buffer.from(r.data).subarray(0, 5).toString() === '%PDF-');
});

await check('POST /api/files/pdf-reports/:userId uploads raw PDF (upsert)', async () => {
  const gen = await api('POST', '/api/v1/generate-teaser-pdf', { body: { analysis } });
  const r = await api('POST', `/api/files/pdf-reports/${userId}?fileName=custom.pdf`, {
    token: userToken,
    raw: Buffer.from(gen.data),
  });
  assert.equal(r.status, 201);
  const served = await api('GET', new URL(r.data.publicUrl).pathname);
  assert.equal(served.status, 200);
});

await check('file upload rejects non-PDF body', async () => {
  const r = await api('POST', `/api/files/pdf-reports/${userId}?fileName=evil.pdf`, {
    token: userToken,
    raw: Buffer.from('<script>alert(1)</script>'),
  });
  assert.equal(r.status, 400);
});

// ── Plans ────────────────────────────────────────────────────────────────────

await check('GET /api/plans returns seeded plan', async () => {
  const r = await api('GET', '/api/plans');
  assert.equal(r.status, 200);
  assert.equal(r.data[0].name, 'Premium Report');
  assert.equal(r.data[0].price, 19);
});

// ── Enquiries ────────────────────────────────────────────────────────────────

await check('POST /api/enquiries creates a feedback record (public)', async () => {
  const r = await api('POST', '/api/enquiries', {
    body: { name: 'Visitor', email: 'visitor@example.com', message: 'Love the product!' },
  });
  assert.equal(r.status, 201);
  assert.equal(r.data.status, 'new');
});

await check('POST /api/enquiries validates missing message (422)', async () => {
  const r = await api('POST', '/api/enquiries', {
    body: { name: 'Visitor', email: 'visitor@example.com' },
  });
  assert.equal(r.status, 422);
});

// ── Admin API ────────────────────────────────────────────────────────────────

await check('admin login rejects wrong credentials', async () => {
  const r = await api('POST', '/api/admin/login', {
    body: { username: 'admin', password: 'nope' },
  });
  assert.equal(r.status, 401);
});

await check('admin login works with env credentials', async () => {
  const r = await api('POST', '/api/admin/login', {
    body: { username: 'admin', password: 'limitlessadmin' },
  });
  assert.equal(r.status, 200);
  adminToken = r.data.token;
});

await check('user token cannot access admin routes (403)', async () => {
  const r = await api('GET', '/api/admin/users', { token: userToken });
  assert.equal(r.status, 403);
});

await check('user cannot access another user (403)', async () => {
  await verifyEmailOtp('other@example.com');
  const other = await api('POST', '/api/auth/register', {
    body: { name: 'Other', email: 'other@example.com' },
  });
  assert.equal(other.status, 201);
  const r = await api('GET', `/api/users/${other.data.user.id}`, { token: userToken });
  assert.equal(r.status, 403);
});

await check('GET /api/admin/users lists users with assessments + credentials', async () => {
  const r = await api('GET', '/api/admin/users', { token: adminToken });
  assert.equal(r.status, 200);
  // main test user + Cooldown + Own Pw + social.google + social.apple + Apple Link Target
  // + Other (403 test) + Other Owner (404 assessmentId test)
  assert.equal(r.data.length, 8);
  const me = r.data.find((u) => u.id === userId);
  assert.ok(me.assessments.length >= 2);
  assert.ok(me.report_json, 'latest report mirrored onto user');
  assert.ok('temp_password' in me, 'admin sees credentials');
  assert.equal(me.password_hash, undefined);
});

await check('GET /api/admin/users/:id returns detail', async () => {
  const r = await api('GET', `/api/admin/users/${userId}`, { token: adminToken });
  assert.equal(r.status, 200);
  assert.equal(r.data.email, 'test.user@example.com');
});

await check('GET /api/admin/stats aggregates correctly', async () => {
  const r = await api('GET', '/api/admin/stats', { token: adminToken });
  assert.equal(r.status, 200);
  assert.equal(r.data.total_users, 8);
  assert.equal(r.data.paid_users, 1);
  assert.equal(r.data.mrr, 19);
  assert.ok(r.data.completed_assessments >= 2);
});

await check('GET /api/admin/enquiries lists enquiries; DELETE removes one', async () => {
  const list = await api('GET', '/api/admin/enquiries', { token: adminToken });
  assert.equal(list.status, 200);
  assert.equal(list.data.length, 1);
  assert.equal(list.data[0].email, 'visitor@example.com');
  const del = await api('DELETE', `/api/admin/enquiries/${list.data[0].id}`, { token: adminToken });
  assert.equal(del.status, 200);
  const after = await api('GET', '/api/admin/enquiries', { token: adminToken });
  assert.equal(after.data.length, 0);
});

await check('PUT /api/admin/users/:id/plan upgrades/downgrades user plan', async () => {
  const up = await api('PUT', `/api/admin/users/${userId}/plan`, {
    token: adminToken,
    body: { payment_status: 'paid' },
  });
  assert.equal(up.status, 200);
  assert.equal(up.data.user.payment_status, 'paid');

  const bad = await api('PUT', `/api/admin/users/${userId}/plan`, {
    token: adminToken,
    body: { payment_status: 'invalid_status' },
  });
  assert.equal(bad.status, 400);
});

await check('DELETE /api/admin/users/:id cascades assessments', async () => {
  const r = await api('DELETE', `/api/admin/users/${userId}`, { token: adminToken });
  assert.equal(r.status, 200);
  assert.ok(r.data.deletedAssessments >= 2);
  const gone = await api('GET', `/api/admin/users/${userId}`, { token: adminToken });
  assert.equal(gone.status, 404);
  const file = await api('GET', pdfUrl.pathname);
  assert.equal(file.status, 404, 'user PDFs removed from GridFS');
});

// ── Teardown ─────────────────────────────────────────────────────────────────

server.close();
modelService.close();
await disconnectMongo();
await mongod.stop();

const failed = results.filter(([s]) => s === 'FAIL').length;
console.log(`\n${results.length} checks, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
