import mongoose from 'mongoose';

export const PAYMENT_STATUSES = ['pending', 'paid', 'demo', 'free', 'trial'];

const userSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, maxlength: 200 },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 320,
      index: true,
    },
    temp_password: { type: String, default: null },
    password_hash: { type: String, default: null },
    password_reset_required: { type: Boolean, default: true },
    payment_status: {
      type: String,
      enum: PAYMENT_STATUSES,
      default: 'pending',
      index: true,
    },
    age: { type: Number, min: 10, max: 120, default: null },
    gender: { type: String, trim: true, maxlength: 30, default: null },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    versionKey: false,
  }
);

/**
 * Serialize a user for API responses.
 * password_hash is NEVER exposed; temp_password only for admin views
 * (the admin panel shows user credentials) and the registration response.
 */
export function sanitizeUser(user, { includeCredentials = false } = {}) {
  if (!user) return null;
  const obj = typeof user.toObject === 'function' ? user.toObject() : { ...user };
  const out = {
    id: String(obj._id),
    name: obj.name ?? null,
    email: obj.email,
    password_reset_required: obj.password_reset_required,
    payment_status: obj.payment_status,
    age: obj.age ?? null,
    gender: obj.gender ?? null,
    created_at: obj.created_at,
    updated_at: obj.updated_at,
  };
  if (includeCredentials) out.temp_password = obj.temp_password ?? null;
  return out;
}

export const User = mongoose.model('User', userSchema);
