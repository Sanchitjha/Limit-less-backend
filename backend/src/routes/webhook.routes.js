/**
 * Stripe webhook — makes payment confirmation tamper-proof.
 *
 * When configured (STRIPE_WEBHOOK_SECRET + MongoDB), Stripe notifies this
 * endpoint of real payments and the matching user (by checkout email) is
 * marked "paid" server-side — no more trusting the client-side redirect.
 *
 * Signature verification is implemented directly (HMAC-SHA256 over
 * "<timestamp>.<raw body>") so no Stripe SDK dependency is needed.
 */

import { Router, raw } from 'express';
import crypto from 'node:crypto';
import { config, features } from '../config.js';
import { isDbReady } from '../db/mongo.js';
import { User } from '../db/models/User.js';

const router = Router();

const TOLERANCE_SECONDS = 300;

function verifyStripeSignature(rawBody, signatureHeader, secret) {
  if (!signatureHeader) return false;

  const parts = Object.create(null);
  for (const pair of signatureHeader.split(',')) {
    const [key, value] = pair.split('=');
    if (!key || !value) continue;
    if (key === 'v1') (parts.v1 ||= []).push(value);
    else parts[key] = value;
  }
  const timestamp = parseInt(parts.t, 10);
  if (!Number.isFinite(timestamp) || !Array.isArray(parts.v1)) return false;
  if (Math.abs(Date.now() / 1000 - timestamp) > TOLERANCE_SECONDS) return false;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');
  const expectedBuf = Buffer.from(expected, 'utf8');

  return parts.v1.some((candidate) => {
    const candidateBuf = Buffer.from(candidate, 'utf8');
    return (
      candidateBuf.length === expectedBuf.length &&
      crypto.timingSafeEqual(candidateBuf, expectedBuf)
    );
  });
}

router.post('/stripe', raw({ type: 'application/json' }), async (req, res) => {
  if (!features.stripeWebhook || !isDbReady()) {
    return res.status(501).json({
      error: 'Stripe webhook not configured',
      message: 'Set STRIPE_WEBHOOK_SECRET and MONGODB_URI to enable it.',
    });
  }

  const rawBody = req.body instanceof Buffer ? req.body.toString('utf8') : '';
  const signature = req.headers['stripe-signature'];

  if (!verifyStripeSignature(rawBody, signature, config.stripeWebhookSecret)) {
    return res.status(400).json({ error: 'Invalid Stripe signature' });
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return res.status(400).json({ error: 'Invalid JSON payload' });
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data?.object || {};
      const userId = session.client_reference_id;
      const email = session.customer_details?.email || session.customer_email;
      const paymentOk = session.payment_status ? session.payment_status === 'paid' : true;

      if (paymentOk) {
        let updated = false;
        if (userId) {
          const user = await User.findById(userId);
          if (user) {
            user.payment_status = 'paid';
            await user.save();
            console.log(`[stripe] checkout completed for user ID ${userId} (${user.email}) — marked paid`);
            updated = true;
          }
        }

        // Fallback to email matching
        if (!updated && email) {
          const { modifiedCount } = await User.updateMany(
            { email: String(email).trim().toLowerCase() },
            { $set: { payment_status: 'paid' } }
          );
          console.log(`[stripe] checkout completed for email ${email} — ${modifiedCount} user(s) marked paid`);
          updated = modifiedCount > 0;
        }

        if (!updated) {
          console.warn(`[stripe] checkout.session.completed received but user not found for ID: ${userId}, Email: ${email}`);
        }
      } else {
        console.warn('[stripe] checkout.session.completed received but payment not completed');
      }
    }
    // Acknowledge everything else so Stripe stops retrying.
    res.json({ received: true });
  } catch (err) {
    console.error('[stripe] failed to process event:', err);
    // Non-2xx tells Stripe to retry later — desirable for transient DB errors.
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

export default router;
