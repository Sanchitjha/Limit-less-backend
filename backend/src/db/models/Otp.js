import mongoose from 'mongoose';

/**
 * Email verification OTPs (one active record per email).
 * The code itself is never stored — only an HMAC hash. Records auto-expire
 * via a TTL index on expires_at.
 */
const otpSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 320,
      index: true,
    },
    otp_hash: { type: String, required: true },
    attempts: { type: Number, default: 0 },
    verified: { type: Boolean, default: false },
    expires_at: { type: Date, required: true },
    last_sent_at: { type: Date, default: Date.now },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    versionKey: false,
  }
);

// MongoDB TTL cleanup — the document is removed once expires_at passes.
otpSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });

export const Otp = mongoose.model('Otp', otpSchema);
