import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { config, features } from './config.js';
import { isDbReady } from './db/mongo.js';
import assessmentRoutes from './routes/assessment.routes.js';
import pdfRoutes from './routes/pdf.routes.js';
import webhookRoutes from './routes/webhook.routes.js';
import authRoutes from './routes/auth.routes.js';
import usersRoutes from './routes/users.routes.js';
import assessmentsRoutes from './routes/assessments.routes.js';
import adminRoutes from './routes/admin.routes.js';
import plansRoutes from './routes/plans.routes.js';
import reportsRoutes from './routes/reports.routes.js';
import enquiriesRoutes from './routes/enquiries.routes.js';
import paymentRoutes from './routes/payment.routes.js';
import { publicFilesRouter, apiFilesRouter } from './routes/files.routes.js';
import { notFoundHandler, errorHandler } from './middleware/errorHandler.js';

const app = express();

app.set('trust proxy', 1); // Render/Heroku-style proxy — needed for rate limiting by IP
app.disable('x-powered-by');

app.use(helmet());
app.use(
  cors({
    origin: config.allowedOrigins === '*' ? true : config.allowedOrigins,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86400,
  })
);

// Stripe webhook and PDF uploads need raw bodies — mount them BEFORE the
// JSON body parser.
app.use('/api/v1/webhooks', webhookRoutes);
app.use('/api/files', apiFilesRouter);
app.use('/files', publicFilesRouter);

app.use(express.json({ limit: '2mb' }));

// Rate limits: generous general limit + tighter ones for expensive/abusable routes.
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    limit: 120,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many requests, please slow down.' },
  })
);
const generationLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many assessment requests. Please wait a few minutes and try again.' },
});
const authLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 25,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please wait a few minutes and try again.' },
});

// Health checks (Render pings these; the frontend "wakes up" the server too)
const health = (req, res) =>
  res.json({
    status: 'ok',
    service: 'limitless-backend',
    version: '2.0.0',
    features: {
      database: isDbReady(),
      ai: features.ai,
      stripeWebhook: features.stripeWebhook,
      email: features.email,
    },
    timestamp: new Date().toISOString(),
  });
app.get('/', health);
app.get('/health', health);
app.get('/api/v1/health', health);

// AI / assessment engine (stateless — works even without a database)
app.use('/api/v1', generationLimiter, assessmentRoutes);
app.use('/api/v1', pdfRoutes);

// Database-backed REST API (MongoDB)
app.use('/api/v1/payments', paymentRoutes);
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/assessments', assessmentsRoutes);
app.use('/api/admin', adminRoutes); // login inside has its own brute-force limiter
app.use('/api/plans', plansRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/enquiries', generationLimiter, enquiriesRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
