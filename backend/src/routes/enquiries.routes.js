import { Router } from 'express';
import { Enquiry, sanitizeEnquiry } from '../db/models/Enquiry.js';
import { requireDb } from '../middleware/auth.js';
import { assert, asString } from '../middleware/validate.js';
import { sendEnquiryNotification } from '../services/emailService.js';

const router = Router();
router.use(requireDb);

/**
 * POST /api/enquiries — public contact/feedback form
 * Body: { name, email, message }
 * Also emails the admin inbox when SMTP is configured (replaces formsubmit.co).
 */
router.post('/', async (req, res) => {
  const body = req.body || {};
  const name = asString(body.name, 'name', { required: true, maxLength: 200 });
  const email = asString(body.email, 'email', { required: true, maxLength: 320 }).toLowerCase();
  const message = asString(body.message, 'message', { required: true, maxLength: 5000 });
  assert(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), 'email must be a valid email address', ['email']);

  const enquiry = await Enquiry.create({ name, email, message });

  sendEnquiryNotification({ name, email, message }).catch(() => {});

  res.status(201).json(sanitizeEnquiry(enquiry));
});

export default router;
