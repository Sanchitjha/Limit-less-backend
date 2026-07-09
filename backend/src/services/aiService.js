/**
 * Optional AI layer (Claude API).
 *
 * Everything here is best-effort: if ANTHROPIC_API_KEY is not configured, or
 * a call fails, times out, or returns an unexpected shape, callers fall back
 * to the deterministic question bank / recommendation library. The API never
 * returns an error to the frontend because of this module.
 *
 * Scores are never computed by AI — only question phrasing and narrative text.
 */

import Anthropic from '@anthropic-ai/sdk';
import { config, features } from '../config.js';
import {
  COGNITIVE_DOMAINS,
  LIFESTYLE_FACTORS,
  QUESTIONS_PER_DOMAIN,
  QUESTIONS_PER_FACTOR,
  buildSectionsFromAI,
  validateAIQuestions,
} from './questionBank.js';

let client = null;
if (features.ai) {
  client = new Anthropic({ apiKey: config.anthropicApiKey });
}

const AI_TIMEOUT_MS = 60_000;

const withTimeout = (promise, ms, label) =>
  Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ]);

const questionItemSchema = {
  type: 'object',
  properties: {
    text: { type: 'string' },
    polarity: { type: 'string', enum: ['p', 'n'] },
  },
  required: ['text', 'polarity'],
  additionalProperties: false,
};

const questionsSchema = {
  type: 'object',
  properties: {
    ...Object.fromEntries(
      COGNITIVE_DOMAINS.map((d) => [d.key, { type: 'array', items: questionItemSchema }])
    ),
    lifestyle: {
      type: 'object',
      properties: Object.fromEntries(
        LIFESTYLE_FACTORS.map((f) => [f.key, { type: 'array', items: questionItemSchema }])
      ),
      required: LIFESTYLE_FACTORS.map((f) => f.key),
      additionalProperties: false,
    },
  },
  required: [...COGNITIVE_DOMAINS.map((d) => d.key), 'lifestyle'],
  additionalProperties: false,
};

const extractText = (response) => {
  for (const block of response.content) {
    if (block.type === 'text') return block.text;
  }
  throw new Error('AI response contained no text block');
};

/**
 * Generate personalized assessment sections with Claude.
 * Returns sections in the frontend shape, or throws (caller falls back to bank).
 */
export async function generateQuestionsWithAI({ age, gender }) {
  if (!client) throw new Error('AI not configured');

  const domainList = COGNITIVE_DOMAINS.map(
    (d) => `- "${d.key}" (${d.label}): exactly ${QUESTIONS_PER_DOMAIN} questions`
  ).join('\n');
  const factorList = LIFESTYLE_FACTORS.map(
    (f) => `- "${f.key}" (${f.label}): exactly ${QUESTIONS_PER_FACTOR} questions`
  ).join('\n');

  const response = await withTimeout(
    client.messages.create({
      model: config.anthropicModel,
      max_tokens: 16000,
      system:
        'You write self-assessment questionnaires for a consumer cognitive-wellness app. ' +
        'Questions must be answerable on a 5-point frequency scale: Never / Rarely / Sometimes / Often / Always. ' +
        'Every question must start with "How often". Keep each question under 130 characters, plain everyday language, ' +
        'relatable to the person\'s age and daily life, never clinical or alarming. ' +
        'polarity "p" means answering "Always" indicates GOOD cognitive health; "n" means answering "Always" indicates a problem. ' +
        'Mix both polarities within each domain.',
      messages: [
        {
          role: 'user',
          content:
            `Create a personalized cognitive wellness questionnaire for a ${age}-year-old (gender: ${gender}). ` +
            `Tailor scenarios to this life stage (e.g. studies/career for younger adults, work/family for mid-life, daily routines for older adults).\n\n` +
            `Cognitive domains:\n${domainList}\n\nLifestyle factors (under the "lifestyle" object):\n${factorList}`,
        },
      ],
      output_config: {
        format: { type: 'json_schema', schema: questionsSchema },
      },
    }),
    AI_TIMEOUT_MS,
    'AI question generation'
  );

  const aiQuestions = JSON.parse(extractText(response));
  validateAIQuestions(aiQuestions);
  return buildSectionsFromAI(aiQuestions);
}

const enrichmentSchema = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    recommendations: {
      type: 'array',
      items: { type: 'string' },
    },
  },
  required: ['summary', 'recommendations'],
  additionalProperties: false,
};

/**
 * Rewrite the report's summary and recommendations with Claude, personalized
 * to the computed scores. Mutates nothing on failure — returns the original
 * analysis object untouched if anything goes wrong.
 */
export async function enrichAnalysisWithAI(analysis) {
  if (!client) return analysis;

  try {
    const scoreLines = COGNITIVE_DOMAINS.map(
      (d) => `${d.label}: ${analysis.domains[d.key]}/100`
    ).join('\n');
    const lifestyleLines = LIFESTYLE_FACTORS.map(
      (f) => `${f.label}: ${analysis.lifestyle[f.key]}/100 (impact: ${analysis.lifestyleImpacts[f.key]})`
    ).join('\n');

    const response = await withTimeout(
      client.messages.create({
        model: config.anthropicModel,
        max_tokens: 16000,
        system:
          'You are a supportive cognitive-wellness coach writing a personalized report section. ' +
          'Warm, practical, specific, never clinical or alarming. Never give medical advice or mention diseases. ' +
          'Recommendations must be concrete daily actions (what, how long, how often), 1-2 sentences each, 4 to 6 total. ' +
          'The summary is 2-3 sentences addressed directly to the user ("you").',
        messages: [
          {
            role: 'user',
            content:
              `Write the summary and recommendations for this assessment result.\n\n` +
              `Person: ${analysis.demographics.age}-year-old, gender ${analysis.demographics.gender}.\n` +
              `Overall score: ${analysis.overall.score}/100 (${analysis.overall.rating}).\n\n` +
              `Domain scores:\n${scoreLines}\n\nLifestyle:\n${lifestyleLines}`,
          },
        ],
        output_config: {
          format: { type: 'json_schema', schema: enrichmentSchema },
        },
      }),
      AI_TIMEOUT_MS,
      'AI report enrichment'
    );

    const enrichment = JSON.parse(extractText(response));
    const recommendations = (enrichment.recommendations || [])
      .filter((r) => typeof r === 'string' && r.length >= 20)
      .slice(0, 6);

    if (recommendations.length >= 4 && typeof enrichment.summary === 'string') {
      return {
        ...analysis,
        overall: { ...analysis.overall, summary: enrichment.summary },
        recommendations,
        audit: { ...analysis.audit, narrative_source: 'ai' },
      };
    }
    return analysis;
  } catch (err) {
    console.warn('[ai] enrichment failed, using rules-based narrative:', err.message);
    return analysis;
  }
}
