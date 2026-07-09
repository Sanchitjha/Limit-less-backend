import { Router } from 'express';
import { Plan, sanitizePlan } from '../db/models/Plan.js';
import { requireDb } from '../middleware/auth.js';

const router = Router();

/** GET /api/plans — active plans ordered by price (public). */
router.get('/', requireDb, async (req, res) => {
  const plans = await Plan.find({ is_active: true }).sort({ price: 1 });
  res.json(plans.map(sanitizePlan));
});

export default router;
