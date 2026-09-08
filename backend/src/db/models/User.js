import mongoose from 'mongoose';

export const PAYMENT_STATUSES = ['pending', 'paid', 'demo', 'free', 'trial', 'suspended'];
export const USER_ROLES = ['admin', 'user', 'parent_guardian'];
export const USER_STATUSES = ['active', 'suspended', 'pending_approval'];

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
    role: {
      type: String,
      enum: USER_ROLES,
      default: 'user',
      index: true,
    },
    status: {
      type: String,
      enum: USER_STATUSES,
      default: 'active',
      index: true,
    },
    mfa_enabled: { type: Boolean, default: false },
    temp_password: { type: String, default: null },
    password_hash: { type: String, default: null },
    password_reset_required: { type: Boolean, default: true },
    email_verified: { type: Boolean, default: false },
    // No `default` here on purpose — a sparse unique index only skips
    // documents where the field is truly ABSENT, not ones explicitly set to
    // null, so a default of null would collide across every non-social user.
    google_id: { type: String, unique: true, sparse: true },
    apple_id: { type: String, unique: true, sparse: true },
    payment_status: {
      type: String,
      enum: PAYMENT_STATUSES,
      default: 'pending',
      index: true,
    },
    age: { type: Number, min: 10, max: 120, default: null },
    gender: { type: String, trim: true, maxlength: 30, default: null },
    last_login_at: { type: Date, default: null },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    versionKey: false,
  }
);

userSchema.index({ email: 1, role: 1 });
userSchema.index({ payment_status: 1, created_at: -1 });

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
    role: obj.role || 'user',
    status: obj.status || 'active',
    mfa_enabled: Boolean(obj.mfa_enabled),
    email_verified: Boolean(obj.email_verified),
    has_password: Boolean(obj.password_hash),
    google_linked: Boolean(obj.google_id),
    apple_linked: Boolean(obj.apple_id),
    password_reset_required: obj.password_reset_required,
    payment_status: obj.payment_status,
    age: obj.age ?? null,
    gender: obj.gender ?? null,
    last_login_at: obj.last_login_at ?? null,
    created_at: obj.created_at,
    updated_at: obj.updated_at,
  };
  if (includeCredentials) out.temp_password = obj.temp_password ?? null;
  return out;
}

export const User = mongoose.model('User', userSchema);
