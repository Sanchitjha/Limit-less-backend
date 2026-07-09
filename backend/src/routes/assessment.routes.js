import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { features } from '../config.js';
import { isDbReady } from '../db/mongo.js';
import { User } from '../db/models/User.js';
import { Assessment } from '../db/models/Assessment.js';
import { buildBankSections } from '../services/questionBank.js';
import { analyzeResponses } from '../services/analysisEngine.js';
import { generateQuestionsWithAI, enrichAnalysisWithAI } from '../services/aiService.js';
import { assert, asInt, asString, ValidationError } from '../middleware/validate.js';

const router = Router();

const normalizeGender = (raw) => {
  const g = String(raw || '').trim().toLowerCase().replace(/_/g, '-');
  const allowed = ['male', 'female', 'other', 'prefer-not-to-say'];
  return allowed.includes(g) ? g : 'prefer-not-to-say';
};

/**
 * POST /api/v1/generate-questions
 * Body: { age: 18-66, gender: string, locale?: string }
 * Response: { assessmentId, sections: [{ id, title, items: [{id, text}] }] }
 */
router.post('/generate-questions', async (req, res) => {
  const body = req.body || {};
  const age = asInt(body.age, 'age', { min: 10, max: 120 });
  const gender = normalizeGender(asString(body.gender, 'gender', { required: false }));
  asString(body.locale, 'locale', { required: false, maxLength: 20 });

  const assessmentId = randomUUID();
  let sections;
  let source = 'bank';

  if (features.ai) {
    try {
      sections = await generateQuestionsWithAI({ age, gender });
      source = 'ai';
    } catch (err) {
      console.warn('[ai] question generation failed, using question bank:', err.message);
    }
  }
  if (!sections) sections = buildBankSections();

  const totalQuestions = sections.reduce((n, s) => n + s.items.length, 0);
  res.json({
    assessmentId,
    sections,
    meta: { source, totalQuestions, scale: ['Never', 'Rarely', 'Sometimes', 'Often', 'Always'] },
  });
});

/**
 * POST /api/v1/analyze
 * Body: { assessmentId, age, gender, responses: [{itemId, value: 0-4}] }
 * Response: the full analysis report JSON (see analysisEngine.js).
 */
router.post('/analyze', async (req, res) => {
  const body = req.body || {};
  const assessmentId = asString(body.assessmentId, 'assessmentId', { required: false }) || randomUUID();
  const age = asInt(body.age, 'age', { min: 10, max: 120 });
  const gender = normalizeGender(asString(body.gender, 'gender', { required: false }));

  assert(Array.isArray(body.responses), 'responses must be an array', ['responses']);
  assert(body.responses.length > 0, 'responses must not be empty', ['responses']);
  assert(body.responses.length <= 500, 'too many responses', ['responses']);

  const responses = body.responses.map((r, i) => {
    if (!r || typeof r !== 'object') {
      throw new ValidationError(`responses[${i}] must be an object`, ['responses', String(i)]);
    }
    assert(typeof r.itemId === 'string' && r.itemId.length > 0, `responses[${i}].itemId is required`, [
      'responses',
      String(i),
      'itemId',
    ]);
    const value = Number(r.value);
    assert(Number.isFinite(value), `responses[${i}].value must be a number`, [
      'responses',
      String(i),
      'value',
    ]);
    return { itemId: r.itemId, value };
  });

  let analysis = analyzeResponses({ assessmentId, age, gender, responses });

  if (features.ai) {
    analysis = await enrichAnalysisWithAI(analysis);
  }

  // Best-effort persistence: when the frontend sends a userId, save the report
  // as an assessment record so it's never lost even if the client-side save fails.
  const userId = String(body.userId || '');
  if (isDbReady() && mongoose.isValidObjectId(userId)) {
    try {
      const user = await User.findById(userId).lean();
      if (user) {
        const record = await Assessment.create({ user_id: userId, report_json: analysis });
        analysis.assessmentRecordId = String(record._id);
      }
    } catch (err) {
      console.warn('[analyze] could not persist assessment (non-fatal):', err.message);
    }
  }

  res.json(analysis);
});

export default router;
