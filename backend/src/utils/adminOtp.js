/**
 * In-memory OTP store for admin panel login.
 *
 * Generates a cryptographically random 6-digit OTP, stores it with a 10-min
 * TTL, and validates it on the verify step.  No database model is needed —
 * this is intentionally stateless across server restarts (which forces a
 * re-login anyway).
 *
 * Only ONE pending OTP is valid at a time.  Generating a new one replaces the
 * previous entry, so rapid retries can't accumulate stale codes.
 */

import crypto from 'node:crypto';

const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const OTP_LENGTH = 6;

// Map<code, { expiresAt: number }>
// We keep only one active OTP at a time (see CURRENT_KEY below).
const store = new Map();

// Sentinel key so we can replace the previous OTP without iterating the map.
const CURRENT_KEY = '__current__';

/**
 * Generate a new 6-digit OTP, store it, and return the code string.
 * Any previously issued OTP is immediately invalidated.
 */
export const generateOtp = () => {
  // crypto.randomInt upper bound is exclusive, so 1_000_000 gives [0, 999999]
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(OTP_LENGTH, '0');

  // Invalidate any previous code
  store.clear();

  store.set(code, { expiresAt: Date.now() + OTP_TTL_MS });
  // Also track which code is "current" so cleanup can find it quickly
  store.set(CURRENT_KEY, code);

  console.log('[adminOtp] OTP generated (expires in 10 min)');
  return code;
};

/**
 * Verify a submitted OTP.
 * Returns true and deletes the code on success; returns false on any failure.
 *
 * @param {string} code  The raw code string submitted by the admin.
 */
export const verifyOtp = (code) => {
  if (!code || typeof code !== 'string') return false;

  const entry = store.get(code.trim());
  if (!entry) {
    console.warn('[adminOtp] OTP not found or already used');
    return false;
  }

  if (Date.now() > entry.expiresAt) {
    store.clear();
    console.warn('[adminOtp] OTP expired');
    return false;
  }

  // Consume — valid OTPs are single-use
  store.clear();
  console.log('[adminOtp] OTP verified successfully');
  return true;
};

// Periodic cleanup (belt-and-suspenders) — removes any expired entry every 5 min
setInterval(() => {
  const current = store.get(CURRENT_KEY);
  if (current) {
    const entry = store.get(current);
    if (entry && Date.now() > entry.expiresAt) {
      store.clear();
      console.log('[adminOtp] Expired OTP purged by cleanup');
    }
  }
}, 5 * 60 * 1000).unref(); // .unref() so this timer never blocks process exit
