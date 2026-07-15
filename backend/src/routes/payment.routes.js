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

export default router;
