import app from './app.js';
import { config, features } from './config.js';
import { connectMongo, disconnectMongo } from './db/mongo.js';

// Connect to MongoDB first (non-fatal when unconfigured — AI/PDF endpoints
// still work; DB routes return 503 until MONGODB_URI is set).
try {
  await connectMongo();
} catch (err) {
  console.error('[db] MongoDB connection failed:', err.message);
  console.error('[db] Database routes will return 503 until the connection succeeds.');
}

const server = app.listen(config.port, () => {
  console.log('──────────────────────────────────────────────');
  console.log(`  Limitless backend listening on port ${config.port}`);
  console.log(`  Environment : ${config.nodeEnv}`);
  console.log(`  Database    : ${features.db ? 'MongoDB configured' : 'NOT configured (set MONGODB_URI)'}`);
  console.log(`  AI questions: ${features.ai ? `enabled (${config.anthropicModel})` : 'disabled — using built-in question bank'}`);
  console.log(`  Stripe hook : ${features.stripeWebhook ? 'enabled' : 'disabled'}`);
  console.log(`  SMTP email  : ${features.email ? 'enabled' : 'disabled'}`);
  console.log('──────────────────────────────────────────────');
});

// Give slow AI/PDF requests room to finish
server.requestTimeout = 180_000;
server.headersTimeout = 185_000;

const shutdown = (signal) => {
  console.log(`\n${signal} received — shutting down gracefully...`);
  server.close(async () => {
    await disconnectMongo().catch(() => {});
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});
