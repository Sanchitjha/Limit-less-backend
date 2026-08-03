import mongoose from 'mongoose';

/**
 * Active (unused, unexpired) refresh tokens, tracked by their `jti` claim.
 * Presence of a row IS the "valid" signal — /refresh deletes the row the
 * moment it's redeemed (rotation), so a stolen-and-replayed old token is
 * simply not found here and gets rejected. The TTL index cleans up rows
 * whose token would have expired anyway.
 */
const refreshTokenSchema = new mongoose.Schema(
  {
    jti: { type: String, required: true, unique: true },
    user_id: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    expires_at: { type: Date, required: true },
  },
  { versionKey: false }
);

refreshTokenSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });

export const RefreshToken = mongoose.model('RefreshToken', refreshTokenSchema);
