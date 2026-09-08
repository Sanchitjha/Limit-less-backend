import mongoose from 'mongoose';

const couponSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true, index: true },
    discount_type: { type: String, enum: ['percentage', 'fixed'], default: 'percentage' },
    discount_value: { type: Number, required: true, min: 0 },
    valid_until: { type: Date, default: null },
    max_uses: { type: Number, default: 0 }, // 0 = unlimited
    used_count: { type: Number, default: 0 },
    is_active: { type: Boolean, default: true, index: true },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    versionKey: false,
  }
);

export const Coupon = mongoose.model('Coupon', couponSchema);
