import { Router } from 'express';
import Stripe from 'stripe';
import { config } from '../config.js';
import { User } from '../db/models/User.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// Endpoint: POST /api/v1/payments/create-checkout-session
// Auth: require valid login token
router.post('/create-checkout-session', requireAuth, async (req, res) => {
  if (!config.stripeSecretKey) {
    return res.status(501).json({
      error: 'Stripe integration not configured',
      message: 'Set STRIPE_SECRET_KEY in your environment variables to enable checkout.',
    });
  }

  try {
    const user = await User.findById(req.auth.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const stripe = new Stripe(config.stripeSecretKey);
    const origin = config.frontendUrl || req.headers.origin || 'http://localhost:5173';

    // Create the Stripe Checkout Session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      customer_email: user.email,
      client_reference_id: String(user._id),
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'Limitless Premium Cognitive Wellness Report',
              description: 'Unlock your full personalized cognitive report, lifestyle insights, and dynamic action plan.',
            },
            unit_amount: 1900, // $19.00
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: `${origin}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/payment`,
      metadata: {
        userId: String(user._id),
        email: user.email,
      },
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('[stripe] failed to create checkout session:', err);
    res.status(500).json({ error: 'Failed to create payment checkout session.' });
  }
});

// Endpoint: POST /api/v1/payments/verify-session
// Fallback for when the Stripe webhook hasn't (yet, or ever) reached us —
// checks the session directly with Stripe instead of waiting on delivery.
router.post('/verify-session', requireAuth, async (req, res) => {
  if (!config.stripeSecretKey) {
    return res.status(501).json({ error: 'Stripe integration not configured' });
  }

  const sessionId = req.body?.sessionId;
  if (!sessionId || typeof sessionId !== 'string') {
    return res.status(400).json({ error: 'sessionId is required' });
  }

  try {
    const stripe = new Stripe(config.stripeSecretKey);
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (session.client_reference_id !== String(req.auth.userId)) {
      return res.status(403).json({ error: 'This session does not belong to the current user.' });
    }

    if (session.payment_status === 'paid') {
      const user = await User.findById(req.auth.userId);
      if (user && user.payment_status !== 'paid') {
        user.payment_status = 'paid';
        await user.save();
        console.log(`[stripe] verify-session marked user ${user._id} (${user.email}) paid (webhook fallback)`);
      }
      return res.json({ paid: true });
    }

    return res.json({ paid: false });
  } catch (err) {
    console.error('[stripe] verify-session failed:', err);
    res.status(500).json({ error: 'Failed to verify payment session.' });
  }
});

export default router;
