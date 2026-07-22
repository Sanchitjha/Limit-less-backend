import mongoose from 'mongoose';

/**
 * Logged-out JWTs, tracked by their `jti` claim until the token's own
 * expiry. The TTL index auto-deletes each entry once the token would have
 * expired anyway, so this collection never grows unbounded.
 */
const revokedTokenSchema = new mongoose.Schema(
  {
    jti: { type: String, required: true, unique: true },
    expires_at: { type: Date, required: true },
  },
  { versionKey: false }
);

revokedTokenSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });

export const RevokedToken = mongoose.model('RevokedToken', revokedTokenSchema);
