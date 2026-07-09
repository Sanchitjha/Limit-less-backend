import { Router } from 'express';
import mongoose from 'mongoose';
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';
import { User, sanitizeUser } from '../db/models/User.js';
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

/** GET /api/admin/users — all users, newest first, with assessment history. */
router.get('/users', requireAdmin, async (req, res) => {
  const users = await User.find().sort({ created_at: -1 }).limit(5000);
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

/** GET /api/admin/stats — aggregated dashboard KPIs. */
router.get('/stats', requireAdmin, async (req, res) => {
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [byStatus, totalUsers, newUsers24h, completedAssessments, usersWithReport] =
    await Promise.all([
      User.aggregate([{ $group: { _id: '$payment_status', count: { $sum: 1 } } }]),
      User.countDocuments(),
      User.countDocuments({ created_at: { $gte: since24h } }),
      Assessment.countDocuments({ report_json: { $ne: null } }),
      Assessment.distinct('user_id', { report_json: { $ne: null } }),
    ]);

  const statusCount = Object.fromEntries(byStatus.map((s) => [s._id, s.count]));
  const paid = statusCount.paid || 0;

  res.json({
    total_users: totalUsers,
    paid_users: paid,
    pending_users: statusCount.pending || 0,
    demo_users: (statusCount.demo || 0) + (statusCount.trial || 0),
    free_users: statusCount.free || 0,
    completed_assessments: completedAssessments,
    users_with_report: usersWithReport.length,
    new_users_24h: newUsers24h,
    mrr: paid * 19,
    conversion_rate: totalUsers > 0 ? Math.round((paid / totalUsers) * 1000) / 10 : 0,
  });
});

export default router;
