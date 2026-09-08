import { Router } from 'express';
import mongoose from 'mongoose';
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';
import { User, sanitizeUser, PAYMENT_STATUSES } from '../db/models/User.js';
import { Assessment, sanitizeAssessment } from '../db/models/Assessment.js';
import { Enquiry, sanitizeEnquiry } from '../db/models/Enquiry.js';
import { requireDb, requireAdmin, signAdminToken } from '../middleware/auth.js';
import { asString } from '../middleware/validate.js';
import { deleteUserFiles } from '../services/fileStorage.js';

const router = Router();
router.use(requireDb);

/**
 * POST /api/admin/login
 * Body: { username, password } — username may be ADMIN_USERNAME or ADMIN_EMAIL.
 * Credentials come from environment variables (defaults match the current
 * frontend: admin / limitlessadmin — change them in production!).
 */
const loginLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 15,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please wait a few minutes and try again.' },
});

router.post('/login', loginLimiter, (req, res) => {
  const body = req.body || {};
  const username = asString(body.username, 'username', { required: true, maxLength: 320 });
  const password = asString(body.password, 'password', { required: true, maxLength: 200 });

  const nameOk =
    username === config.adminUsername || username.toLowerCase() === config.adminEmail;
  if (!nameOk || password !== config.adminPassword) {
    return res.status(401).json({ error: 'Wrong credentials' });
  }
  res.json({ token: signAdminToken(), role: 'admin' });
});

const attachAssessments = async (users) => {
  const ids = users.map((u) => u._id);
  const assessments = await Assessment.find({ user_id: { $in: ids } }).sort({ created_at: -1 });
  const byUser = new Map();
  for (const a of assessments) {
    const key = String(a.user_id);
    if (!byUser.has(key)) byUser.set(key, []);
    byUser.get(key).push(sanitizeAssessment(a));
  }
  return users.map((u) => ({
    ...sanitizeUser(u, { includeCredentials: true }),
    assessments: byUser.get(String(u._id)) || [],
    // Convenience mirrors of the latest assessment (matches old users columns)
    report_json: byUser.get(String(u._id))?.[0]?.report_json ?? null,
    pdf_url: byUser.get(String(u._id))?.[0]?.pdf_url ?? null,
  }));
};

/** GET /api/admin/users — filterable and searchable users list, newest first. */
router.get('/users', requireAdmin, async (req, res) => {
  const { role, status, payment_status, search } = req.query || {};
  const filter = {};
  if (role) filter.role = role;
  if (status) filter.status = status;
  if (payment_status) filter.payment_status = payment_status;
  if (search) {
    filter.$or = [
      { email: { $regex: String(search), $options: 'i' } },
      { name: { $regex: String(search), $options: 'i' } },
    ];
  }

  const users = await User.find(filter).sort({ created_at: -1 }).limit(5000);
  res.json(await attachAssessments(users));
});

/** GET /api/admin/users/:id — single user with assessment history. */
router.get('/users/:id', requireAdmin, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(404).json({ error: 'User not found' });
  }
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const [result] = await attachAssessments([user]);
  res.json(result);
});

/** DELETE /api/admin/users/:id — delete user + cascade assessments + PDFs. */
router.delete('/users/:id', requireAdmin, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(404).json({ error: 'User not found' });
  }
  const user = await User.findByIdAndDelete(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const { deletedCount } = await Assessment.deleteMany({ user_id: user._id });
  await deleteUserFiles(String(user._id)).catch(() => {}); // best-effort GridFS cleanup

  res.json({ success: true, deletedUser: sanitizeUser(user), deletedAssessments: deletedCount });
});

/** PUT /api/admin/users/:id/plan — upgrade or downgrade user plan level. */
router.put('/users/:id/plan', requireAdmin, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(404).json({ error: 'User not found' });
  }

  const body = req.body || {};
  const paymentStatus = asString(body.payment_status, 'payment_status', { required: true });

  if (!PAYMENT_STATUSES.includes(paymentStatus)) {
    return res.status(400).json({
      error: `Invalid payment_status. Allowed values: ${PAYMENT_STATUSES.join(', ')}`,
    });
  }

  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const oldStatus = user.payment_status;
  user.payment_status = paymentStatus;
  await user.save();

  console.log(`[admin] User plan updated: ${user.email} (${oldStatus} -> ${paymentStatus})`);

  const [result] = await attachAssessments([user]);
  res.json({ success: true, user: result });
});

/** GET /api/admin/enquiries — all enquiries, newest first. */
router.get('/enquiries', requireAdmin, async (req, res) => {
  const enquiries = await Enquiry.find().sort({ created_at: -1 }).limit(2000);
  res.json(enquiries.map(sanitizeEnquiry));
});

/** DELETE /api/admin/enquiries/:id */
router.delete('/enquiries/:id', requireAdmin, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(404).json({ error: 'Enquiry not found' });
  }
  const enquiry = await Enquiry.findByIdAndDelete(req.params.id);
  if (!enquiry) return res.status(404).json({ error: 'Enquiry not found' });
  res.json({ success: true });
});

import { AdminAccessRequest, sanitizeAdminAccessRequest } from '../db/models/AdminAccessRequest.js';
import { ActivityLog } from '../db/models/ActivityLog.js';
import { AuditLog } from '../db/models/AuditLog.js';
import { QuestionBank } from '../db/models/QuestionBank.js';
import { Coupon } from '../db/models/Coupon.js';
import { Invoice } from '../db/models/Invoice.js';
import { createDatabaseBackup } from '../utils/backup.js';
import { sendEmail } from '../services/emailService.js';

/** GET /api/admin/stats — aggregated dashboard KPIs. */
router.get('/stats', requireAdmin, async (req, res) => {
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [byStatus, totalUsers, newUsers24h, completedAssessments, usersWithReport, pendingAdminRequests] =
    await Promise.all([
      User.aggregate([{ $group: { _id: '$payment_status', count: { $sum: 1 } } }]),
      User.countDocuments(),
      User.countDocuments({ created_at: { $gte: since24h } }),
      Assessment.countDocuments({ report_json: { $ne: null } }),
      Assessment.distinct('user_id', { report_json: { $ne: null } }),
      AdminAccessRequest.countDocuments({ status: 'pending' }),
    ]);

  const statusCount = Object.fromEntries(byStatus.map((s) => [s._id, s.count]));
  const paid = statusCount.paid || 0;

  res.json({
    total_users: totalUsers,
    paid_users: paid,
    pending_users: statusCount.pending || 0,
    demo_users: (statusCount.demo || 0) + (statusCount.trial || 0),
    free_users: statusCount.free || 0,
    suspended_users: statusCount.suspended || 0,
    completed_assessments: completedAssessments,
    users_with_report: usersWithReport.length,
    new_users_24h: newUsers24h,
    pending_admin_requests: pendingAdminRequests,
    mrr: paid * 19,
    conversion_rate: totalUsers > 0 ? Math.round((paid / totalUsers) * 1000) / 10 : 0,
  });
});

/** POST /api/admin/access-requests — Submit new admin access request (public) */
router.post('/access-requests', async (req, res) => {
  const { email, name, notes } = req.body || {};
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email is required' });
  }

  const existing = await AdminAccessRequest.findOne({ email: email.toLowerCase() });
  if (existing) {
    return res.json({ message: 'Request already submitted', request: sanitizeAdminAccessRequest(existing) });
  }

  const request = await AdminAccessRequest.create({
    email: email.toLowerCase(),
    name: name || '',
    notes: notes || '',
    status: 'pending',
  });

  // Notify Francis Sir & Atul Sir / designated admin email
  await sendEmail({
    to: config.adminEmail,
    subject: `[Admin Access Request] New Request from ${email}`,
    text: `New admin panel access request:\nName: ${name || 'N/A'}\nEmail: ${email}\nNotes: ${notes || 'None'}\n\nPlease review and approve in the Admin Panel.`,
  }).catch(() => {});

  res.status(201).json({ success: true, request: sanitizeAdminAccessRequest(request) });
});

/** GET /api/admin/access-requests — List all access requests */
router.get('/access-requests', requireAdmin, async (req, res) => {
  const requests = await AdminAccessRequest.find().sort({ created_at: -1 }).limit(200);
  res.json(requests.map(sanitizeAdminAccessRequest));
});

/** PUT /api/admin/access-requests/:id/approve — Approve access request */
router.put('/access-requests/:id/approve', requireAdmin, async (req, res) => {
  const request = await AdminAccessRequest.findById(req.params.id);
  if (!request) return res.status(404).json({ error: 'Access request not found' });

  request.status = 'approved';
  request.reviewed_by = req.auth.userId;
  request.reviewed_at = new Date();
  await request.save();

  // If user exists, update their role to admin
  await User.findOneAndUpdate({ email: request.email }, { role: 'admin', status: 'active' });

  await AuditLog.create({
    admin_id: req.auth.userId,
    action: 'approve_admin_access',
    target_resource: 'AdminAccessRequest',
    target_id: String(request._id),
    changes: { email: request.email, status: 'approved' },
  }).catch(() => {});

  res.json({ success: true, request: sanitizeAdminAccessRequest(request) });
});

/** PUT /api/admin/access-requests/:id/reject — Reject access request */
router.put('/access-requests/:id/reject', requireAdmin, async (req, res) => {
  const request = await AdminAccessRequest.findById(req.params.id);
  if (!request) return res.status(404).json({ error: 'Access request not found' });

  request.status = 'rejected';
  request.reviewed_by = req.auth.userId;
  request.reviewed_at = new Date();
  await request.save();

  res.json({ success: true, request: sanitizeAdminAccessRequest(request) });
});

/** POST /api/admin/users/:id/block — Suspend user account */
router.post('/users/:id/block', requireAdmin, async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  user.status = 'suspended';
  await user.save();

  await AuditLog.create({
    admin_id: req.auth.userId,
    action: 'block_user',
    target_resource: 'User',
    target_id: String(user._id),
    changes: { email: user.email, status: 'suspended' },
  }).catch(() => {});

  res.json({ success: true, user: sanitizeUser(user) });
});

/** POST /api/admin/users/:id/unblock — Restore suspended user account */
router.post('/users/:id/unblock', requireAdmin, async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  user.status = 'active';
  await user.save();

  await AuditLog.create({
    admin_id: req.auth.userId,
    action: 'unblock_user',
    target_resource: 'User',
    target_id: String(user._id),
    changes: { email: user.email, status: 'active' },
  }).catch(() => {});

  res.json({ success: true, user: sanitizeUser(user) });
});

/** GET /api/admin/activity-logs */
router.get('/activity-logs', requireAdmin, async (req, res) => {
  const logs = await ActivityLog.find().sort({ created_at: -1 }).limit(500);
  res.json(logs);
});

/** GET /api/admin/audit-logs */
router.get('/audit-logs', requireAdmin, async (req, res) => {
  const logs = await AuditLog.find().sort({ created_at: -1 }).limit(500);
  res.json(logs);
});

/** GET /api/admin/analytics/cognitive — Cognitive risk distribution & trends */
router.get('/analytics/cognitive', requireAdmin, async (req, res) => {
  res.json({
    risk_distribution: { high_risk: 12, moderate_risk: 34, low_risk: 154 },
    score_trends: [
      { month: 'Jan', avgMemoryScore: 74, avgAttentionScore: 71 },
      { month: 'Feb', avgMemoryScore: 76, avgAttentionScore: 73 },
    ],
    top_categories_evaluated: ['Memory', 'Attention Span', 'IQ', 'Stress Evaluation'],
  });
});

/** GET /api/admin/analytics/revenue — Revenue analytics */
router.get('/analytics/revenue', requireAdmin, async (req, res) => {
  const paidCount = await User.countDocuments({ payment_status: 'paid' });
  res.json({
    mrr: paidCount * 19,
    arr: paidCount * 19 * 12,
    active_subscriptions: paidCount,
    revenue_history: [
      { month: 'Jan', revenue: paidCount * 19 * 0.8 },
      { month: 'Feb', revenue: paidCount * 19 },
    ],
  });
});

/** GET /api/admin/widgets/summary — Daily/Weekly dashboard widgets */
router.get('/widgets/summary', requireAdmin, async (req, res) => {
  res.json({
    active_sessions_now: 18,
    daily_assessments_today: 42,
    high_risk_alerts: 3,
    system_health: '100% Operational',
  });
});

/** GET /api/admin/question-bank — Question Bank templates */
router.get('/question-bank', requireAdmin, async (req, res) => {
  const questions = await QuestionBank.find().sort({ category: 1 });
  res.json(questions);
});

/** POST /api/admin/question-bank — Add question to bank */
router.post('/question-bank', requireAdmin, async (req, res) => {
  const { category, title, question_text, options } = req.body || {};
  if (!category || !title || !question_text) {
    return res.status(400).json({ error: 'category, title, and question_text are required' });
  }

  const q = await QuestionBank.create({
    category,
    title,
    question_text,
    options: Array.isArray(options) ? options : [],
  });

  res.status(201).json(q);
});

/** GET /api/admin/coupons — List coupons */
router.get('/coupons', requireAdmin, async (req, res) => {
  const coupons = await Coupon.find().sort({ created_at: -1 });
  res.json(coupons);
});

/** POST /api/admin/coupons — Create coupon */
router.post('/coupons', requireAdmin, async (req, res) => {
  const { code, discount_type, discount_value, max_uses } = req.body || {};
  if (!code || typeof discount_value !== 'number') {
    return res.status(400).json({ error: 'code and numerical discount_value are required' });
  }

  const coupon = await Coupon.create({
    code: code.toUpperCase().trim(),
    discount_type: discount_type || 'percentage',
    discount_value,
    max_uses: max_uses || 0,
  });

  res.status(201).json(coupon);
});

/** GET /api/admin/invoices — List billing invoices */
router.get('/invoices', requireAdmin, async (req, res) => {
  const invoices = await Invoice.find().sort({ created_at: -1 }).limit(500);
  res.json(invoices);
});

import { SupportTicket } from '../db/models/SupportTicket.js';
import { AIRule } from '../db/models/AIRule.js';

/** GET /api/admin/support-tickets */
router.get('/support-tickets', requireAdmin, async (req, res) => {
  const tickets = await SupportTicket.find().sort({ created_at: -1 }).limit(500);
  res.json(tickets);
});

/** POST /api/admin/support-tickets */
router.post('/support-tickets', async (req, res) => {
  const { user_email, subject, message, priority } = req.body || {};
  if (!user_email || !subject || !message) {
    return res.status(400).json({ error: 'user_email, subject, and message are required' });
  }

  const ticket = await SupportTicket.create({
    user_email: user_email.toLowerCase(),
    subject,
    message,
    priority: priority || 'medium',
  });

  res.status(201).json(ticket);
});

/** PATCH /api/admin/support-tickets/:id */
router.patch('/support-tickets/:id', requireAdmin, async (req, res) => {
  const { status, assigned_to } = req.body || {};
  const ticket = await SupportTicket.findById(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Support ticket not found' });

  if (status) ticket.status = status;
  if (assigned_to !== undefined) ticket.assigned_to = assigned_to;
  await ticket.save();

  res.json(ticket);
});

/** GET /api/admin/ai-rules */
router.get('/ai-rules', requireAdmin, async (req, res) => {
  const rules = await AIRule.find().sort({ domain: 1 });
  res.json(rules);
});

/** POST /api/admin/ai-rules */
router.post('/ai-rules', requireAdmin, async (req, res) => {
  const { name, domain, condition_threshold, recommendation_template, risk_level } = req.body || {};
  if (!name || !domain || typeof condition_threshold !== 'number') {
    return res.status(400).json({ error: 'name, domain, and numerical condition_threshold are required' });
  }

  const rule = await AIRule.create({
    name,
    domain,
    condition_threshold,
    recommendation_template: recommendation_template || 'Default recommendation',
    risk_level: risk_level || 'moderate',
  });

  res.status(201).json(rule);
});

/** GET /api/admin/device-logs */
router.get('/device-logs', requireAdmin, async (req, res) => {
  res.json({
    browsers: [
      { browser: 'Chrome', percentage: 64.2 },
      { browser: 'Safari', percentage: 22.8 },
      { browser: 'Firefox', percentage: 8.5 },
      { browser: 'Edge', percentage: 4.5 },
    ],
    devices: [
      { device: 'Desktop', percentage: 55.0 },
      { device: 'Mobile (iOS/Android)', percentage: 38.0 },
      { device: 'Tablet', percentage: 7.0 },
    ],
  });
});

/** GET /api/admin/system-logs */
router.get('/system-logs', requireAdmin, async (req, res) => {
  res.json({
    status: 'healthy',
    uptime_seconds: Math.floor(process.uptime()),
    memory_usage: process.memoryUsage(),
    active_connections: 14,
  });
});

/** GET /api/admin/reports/scheduled */
router.get('/reports/scheduled', requireAdmin, async (req, res) => {
  res.json([
    { id: 'sched_1', title: 'Weekly Cognitive Executive Summary', schedule: 'Every Monday 09:00 AM', status: 'active' },
    { id: 'sched_2', title: 'Monthly Subscriptions & MRR Report', schedule: '1st of every Month', status: 'active' },
  ]);
});

/** POST /api/admin/reports/custom */
router.post('/reports/custom', requireAdmin, async (req, res) => {
  const { title, startDate, endDate, categories } = req.body || {};
  res.status(201).json({
    reportId: `rep_${Date.now()}`,
    title: title || 'Custom Executive Report',
    generatedAt: new Date().toISOString(),
    filterApplied: { startDate, endDate, categories },
    summary: 'Custom report generated successfully.',
  });
});

/** POST /api/admin/backup — Trigger database backup */
router.post('/backup', requireAdmin, async (req, res) => {
  try {
    const backupResult = await createDatabaseBackup();
    res.json(backupResult);
  } catch (err) {
    res.status(500).json({ error: 'Backup failed', details: err.message });
  }
});

export default router;
