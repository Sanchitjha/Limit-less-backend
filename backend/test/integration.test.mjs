/**
 * End-to-end integration test against an in-memory MongoDB.
 * Run: npm test   (spins up mongod, boots the app, exercises every endpoint)
 */

import assert from 'node:assert/strict';
import { MongoMemoryServer } from 'mongodb-memory-server';

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

const { connectMongo, disconnectMongo } = await import('../src/db/mongo.js');
await connectMongo();
const { default: app } = await import('../src/app.js');

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

let userToken, userId, adminToken, tempPassword, assessmentId, analysis, pdfUrl;

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

/** Complete the OTP verification for an email (uses devOtp from the response). */
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

await check('register without OTP verification → 403', async () => {
  const r = await api('POST', '/api/auth/register', {
    body: { name: 'No Otp', email: 'no.otp@example.com' },
  });
  assert.equal(r.status, 403);
});

await check('send-otp + wrong code → 400, correct code verifies', async () => {
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
});

await check('send-otp resend within cooldown → 429', async () => {
  const r = await api('POST', '/api/auth/send-otp', { body: { email: 'test.user@example.com' } });
  assert.equal(r.status, 429);
});

await check('POST /api/auth/register creates user + returns temp password & JWT', async () => {
  const r = await api('POST', '/api/auth/register', {
    body: { name: 'Test User', email: 'Test.User@Example.com', age: 25, gender: 'male' },
  });
  assert.equal(r.status, 201);
  assert.equal(r.data.user.email, 'test.user@example.com'); // lowercased
  assert.equal(r.data.user.payment_status, 'pending');
  assert.equal(r.data.user.password_reset_required, true);
  assert.ok(r.data.tempPassword.length >= 8);
  assert.ok(r.data.token);
  userToken = r.data.token;
  userId = r.data.user.id;
  tempPassword = r.data.tempPassword;
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

await check('PATCH /api/users/:id updates payment_status', async () => {
  const r = await api('PATCH', `/api/users/${userId}`, {
    token: userToken,
    body: { payment_status: 'paid' },
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.payment_status, 'paid');
});

await check('PATCH /api/users/:id rejects bad payment_status (422)', async () => {
  const r = await api('PATCH', `/api/users/${userId}`, {
    token: userToken,
    body: { payment_status: 'hacked' },
  });
  assert.equal(r.status, 422);
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

await check('POST /api/v1/generate-pdf returns a PDF', async () => {
  const r = await api('POST', '/api/v1/generate-pdf', { body: { analysis } });
  assert.equal(r.status, 200);
  assert.ok(r.contentType.includes('application/pdf'));
  assert.ok(Buffer.from(r.data).subarray(0, 5).toString() === '%PDF-');
});

await check('POST /api/reports/:userId/pdf stores PDF + updates assessment', async () => {
  const r = await api('POST', `/api/reports/${userId}/pdf`, {
    token: userToken,
    body: { analysis },
  });
  assert.equal(r.status, 201);
  assert.ok(r.data.pdfUrl.includes(`/files/pdf-reports/${userId}/`));
  assert.equal(r.data.assessment.pdf_url, r.data.pdfUrl);
  pdfUrl = new URL(r.data.pdfUrl);
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
  assert.equal(r.data.length, 2);
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
  assert.equal(r.data.total_users, 2);
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
await disconnectMongo();
await mongod.stop();

const failed = results.filter(([s]) => s === 'FAIL').length;
console.log(`\n${results.length} checks, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
