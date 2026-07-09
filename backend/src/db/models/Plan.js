import mongoose from 'mongoose';

const planSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 200 },
    price: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'USD', maxlength: 10 },
    interval: {
      type: String,
      enum: ['one_time', 'month', 'year'],
      default: 'one_time',
    },
    features: { type: [String], default: [] },
    is_active: { type: Boolean, default: true },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    versionKey: false,
  }
);

export function sanitizePlan(plan) {
  const obj = typeof plan.toObject === 'function' ? plan.toObject() : { ...plan };
  return {
    id: String(obj._id),
    name: obj.name,
    price: obj.price,
    currency: obj.currency,
    interval: obj.interval,
    features: obj.features,
    is_active: obj.is_active,
    created_at: obj.created_at,
  };
}

export const Plan = mongoose.model('Plan', planSchema);
