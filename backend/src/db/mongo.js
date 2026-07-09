import mongoose from 'mongoose';
import { config, features } from '../config.js';
import { Plan } from './models/Plan.js';

/**
 * Connect to MongoDB. Non-fatal when MONGODB_URI is unset — the AI/PDF
 * endpoints keep working and DB-backed routes return 503 until configured.
 */
export async function connectMongo() {
  if (!features.db) {
    console.warn('[db] MONGODB_URI not set — database routes are disabled.');
    return false;
  }
  mongoose.set('strictQuery', true);
  await mongoose.connect(config.mongoUri, {
    dbName: config.mongoDbName,
    serverSelectionTimeoutMS: 10_000,
  });
  console.log(`[db] connected to MongoDB (db: ${config.mongoDbName})`);

  await seedPlans();
  return true;
}

export const isDbReady = () => mongoose.connection.readyState === 1;

export async function disconnectMongo() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
}

async function seedPlans() {
  try {
    const count = await Plan.estimatedDocumentCount();
    if (count === 0) {
      await Plan.create({
        name: 'Premium Report',
        price: 19,
        currency: 'USD',
        interval: 'one_time',
        features: [
          'Full cognitive report',
          'Personalized recommendations',
          'Cognitive age estimate',
          'Lifestyle assessment',
          'Downloadable PDF',
        ],
        is_active: true,
      });
      console.log('[db] seeded default plan: Premium Report ($19)');
    }
  } catch (err) {
    console.warn('[db] plan seeding failed (non-fatal):', err.message);
  }
}
