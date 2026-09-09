import 'dotenv/config';
import crypto from 'node:crypto';

const toInt = (value, fallback) => {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
};

const parseOrigins = (raw) => {
  if (!raw || raw.trim() === '' || raw.trim() === '*') return '*';
  return raw
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter(Boolean);
};

const jwtSecret = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.JWT_SECRET) {
  console.warn(
    '[config] JWT_SECRET not set — using a random secret. Tokens will be invalidated on every restart. Set JWT_SECRET in production!'
  );
}

export const config = {
  // Default 4000 — ports 3000/3001 on the production VPS are reserved for
  // Vigil (see Vigil_Team_Reply_30June2026.pdf, §1.2).
  port: toInt(process.env.PORT, 4000),
  nodeEnv: process.env.NODE_ENV || 'development',
  allowedOrigins: parseOrigins(process.env.ALLOWED_ORIGINS),

  // Public base URL of THIS backend (used to build public PDF links).
  // Falls back to the incoming request's host when unset.
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, ''),

  // AI report-generation model service ("Akshay's model") — the sole source
  // of truth for assessment PDFs. Never generate reports locally.
  modelServiceUrl: (
    process.env.MODEL_SERVICE_URL || 'https://limitless-model.160-153-179-249.sslip.io'
  ).replace(/\/+$/, ''),

  // MongoDB
  mongoUri: process.env.MONGODB_URI || '',
  mongoDbName: process.env.MONGODB_DB_NAME || 'limitless',

  // Auth
  jwtSecret,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  adminUsername: process.env.ADMIN_USERNAME || 'admin',
  adminEmail: (process.env.ADMIN_EMAIL || 'admin@limitlessworld.net').toLowerCase(),
  adminPassword: process.env.ADMIN_PASSWORD || 'limitlessadmin',

  // Optional AI enrichment
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  anthropicModel: process.env.ANTHROPIC_MODEL || 'claude-opus-4-8',

  // Optional Stripe webhook verification
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
  stripeSecretKey: process.env.STRIPE_SECRET_KEY || '',

  // Limitless Executive AI Coach — server-to-server only (see
  // routes/executive.routes.js). Never expose this key to the frontend.
  executiveApiUrl: (process.env.EXECUTIVE_API_URL || '').replace(/\/+$/, ''),
  executiveApiKey: process.env.EXECUTIVE_API_KEY || '',

  // Optional backend email (Nodemailer / SMTP)
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: toInt(process.env.SMTP_PORT, 587),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.EMAIL_FROM || process.env.SMTP_USER || '',
  },
  adminNotifyEmail: process.env.ADMIN_NOTIFY_EMAIL || '',
  atulEmail: process.env.ATUL_EMAIL || '',
  frontendUrl: (process.env.FRONTEND_URL || '').replace(/\/+$/, ''),

  // Social sign-in — comma-separated list of accepted audiences, since a
  // mobile app + web app pair typically use different OAuth client IDs for
  // the same sign-in flow.
  googleClientIds: (process.env.GOOGLE_CLIENT_IDS || process.env.GOOGLE_CLIENT_ID || '')
    .split(',').map((s) => s.trim()).filter(Boolean),
  appleClientIds: (process.env.APPLE_CLIENT_IDS || process.env.APPLE_CLIENT_ID || '')
    .split(',').map((s) => s.trim()).filter(Boolean),
};

export const features = {
  db: Boolean(config.mongoUri),
  ai: Boolean(config.anthropicApiKey),
  stripeWebhook: Boolean(config.stripeWebhookSecret && config.mongoUri),
  email: Boolean(config.smtp.host && config.smtp.user),
  googleSignIn: config.googleClientIds.length > 0,
  appleSignIn: config.appleClientIds.length > 0,
  executiveApi: Boolean(config.executiveApiUrl && config.executiveApiKey),
};

if (
  config.nodeEnv === 'production' &&
  (!process.env.ADMIN_PASSWORD || config.adminPassword === 'limitlessadmin')
) {
  console.warn('[config] ⚠ ADMIN_PASSWORD is using the default value — change it in production!');
}
