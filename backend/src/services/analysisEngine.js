/**
 * Deterministic analysis engine.
 *
 * Scores are ALWAYS computed here by fixed rules — the optional AI layer only
 * rewrites narrative text (recommendations/summary), never numbers.
 *
 * The output shape is exactly what the frontend Dashboard (src/components/
 * Dashboard.jsx) and admin dashboard consume:
 *   overall{score,rating}, domains{}, charts{radarDomains,barLifestyleImpacts},
 *   lifestyleImpacts{}, riskIndicators[], strengths[], recommendations[],
 *   cognitiveAge{}, audit{}, privacy{}, disclaimers[]
 */

import { COGNITIVE_DOMAINS, LIFESTYLE_FACTORS } from './questionBank.js';

const RULES_VERSION = '1.0.0';

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

const ageCohort = (age) => {
  if (age <= 30) return '18-30';
  if (age <= 45) return '31-45';
  if (age <= 60) return '46-60';
  return '61+';
};

// Rating buckets — the admin dashboard groups users by these exact strings.
const ratingFor = (score) => {
  if (score >= 85) return 'Excellent';
  if (score >= 70) return 'Good';
  if (score >= 50) return 'Moderate';
  return 'At Risk';
};

const impactLevelFor = (score) => {
  // "Impact" is negative impact on cognition: a healthy habit scores High
  // wellness → Low impact.
  if (score >= 70) return 'Low';
  if (score >= 45) return 'Moderate';
  return 'High';
};

/**
 * Parse an item ID produced by questionBank.js.
 * Returns { kind: 'cognitive'|'lifestyle', key, polarity } or null if unknown.
 */
function parseItemId(itemId) {
  if (typeof itemId !== 'string') return null;
  const parts = itemId.split('_');
  if (parts[0] !== 'q') return null;

  if (parts[1] === 'ls' && parts.length >= 5) {
    const key = parts[2];
    const polarity = parts[parts.length - 1] === 'p' ? 'p' : 'n';
    if (LIFESTYLE_FACTORS.some((f) => f.key === key)) {
      return { kind: 'lifestyle', key, polarity };
    }
    return null;
  }

  if (parts.length >= 4) {
    const key = parts[1];
    const polarity = parts[parts.length - 1] === 'p' ? 'p' : 'n';
    if (COGNITIVE_DOMAINS.some((d) => d.key === key)) {
      return { kind: 'cognitive', key, polarity };
    }
  }
  return null;
}

const RISK_TEXT = {
  memory: 'Frequent everyday memory lapses reported (names, items, recent events)',
  attention: 'Sustained attention appears reduced — distractions derail tasks often',
  processingSpeed: 'Slower information processing reported under time pressure',
  executiveFunction: 'Planning and follow-through difficulties may affect daily productivity',
  language: 'Word-finding and verbal fluency difficulties reported',
  visuospatial: 'Spatial orientation and distance judgment difficulties reported',
};

const STRENGTH_TEXT = {
  memory: 'Strong everyday memory for names, events, and details',
  attention: 'Excellent sustained focus, even with distractions around',
  processingSpeed: 'Fast, accurate thinking under time pressure',
  executiveFunction: 'Strong planning, organization, and follow-through',
  language: 'Clear verbal expression and comprehension',
  visuospatial: 'Strong spatial awareness and navigation skills',
};

const LIFESTYLE_RISK_TEXT = {
  sleepQuality: 'Poor sleep quality — a key driver of memory and attention problems',
  stressLevel: 'High stress levels — chronic stress impairs focus and recall',
  physicalActivity: 'Low physical activity — regular movement protects brain health',
  screenTime: 'Excessive screen time — may fragment attention and disrupt sleep',
};

const DOMAIN_RECOMMENDATIONS = {
  memory:
    'Train recall actively: after conversations or reading, pause and summarize the key points out loud or in a note. Spaced-repetition apps 10 minutes a day strengthen memory measurably within weeks.',
  attention:
    'Work in 25-minute focus blocks with notifications silenced, followed by 5-minute breaks. Single-tasking rebuilds sustained attention faster than any brain-training app.',
  processingSpeed:
    'Add light aerobic exercise (brisk 20–30 minute walks) 4–5 days a week — it is the best-evidenced way to improve processing speed. Timed puzzle games add useful practice.',
  executiveFunction:
    'Every evening, write down your top 3 priorities for tomorrow and break the biggest one into 3 concrete steps. External structure offloads planning strain and builds the habit.',
  language:
    'Read varied material daily and retell what you read to someone (or record yourself). Learning 2–3 new words a week and using them in conversation rebuilds verbal fluency.',
  visuospatial:
    'Practice navigation without GPS on familiar routes, and add spatial hobbies — jigsaw puzzles, sketching rooms from memory, or assembly projects — twice a week.',
};

const LIFESTYLE_RECOMMENDATIONS = {
  sleepQuality:
    'Protect a consistent sleep window: same bedtime and wake time (±30 min), screens off 60 minutes before bed, and a cool, dark room. Sleep is when the brain consolidates memory.',
  stressLevel:
    'Use a daily 10-minute decompression ritual — breathing exercises, a short walk, or guided meditation. Lowering baseline stress directly improves focus and recall.',
  physicalActivity:
    'Aim for 150 minutes of moderate activity per week. Even three 10-minute walks a day increase blood flow to the brain and support new neural connections.',
  screenTime:
    'Set app timers and create screen-free zones (meals, first hour of the morning, last hour before bed). Replacing 30 minutes of scrolling with reading or walking pays off quickly.',
};

const GENERAL_RECOMMENDATION =
  'Re-take this assessment in 8–12 weeks to track your progress. Small, consistent habits compound — pick two recommendations and make them daily before adding more.';

/**
 * Main entry point.
 * @param {{assessmentId:string, age:number, gender:string, responses:Array<{itemId:string,value:number}>}} input
 */
export function analyzeResponses({ assessmentId, age, gender, responses }) {
  const audit = {
    rules_version: RULES_VERSION,
    age_cohort: ageCohort(age),
    clamped_values: [],
    imputation_notes: [],
    insufficient_sections: [],
  };

  const cognitiveScores = {}; // domainKey -> number[]
  const lifestyleScores = {}; // factorKey -> number[]
  const unknownValues = [];

  for (const response of responses) {
    let value = Number(response.value);
    if (!Number.isFinite(value)) continue;
    if (value < 0 || value > 4) {
      audit.clamped_values.push(`${response.itemId}=${value}`);
      value = clamp(value, 0, 4);
    }

    const parsed = parseItemId(response.itemId);
    if (!parsed) {
      unknownValues.push(value);
      continue;
    }

    // 0..4 -> 0..100, flipped for negatively-phrased questions
    const score = parsed.polarity === 'p' ? value * 25 : (4 - value) * 25;
    const bucket = parsed.kind === 'cognitive' ? cognitiveScores : lifestyleScores;
    (bucket[parsed.key] ||= []).push(score);
  }

  // Legacy fallback: if no item ID matched our format (e.g. an old cached
  // question set), derive a single neutral score from the raw answers so the
  // user still gets a report instead of an error.
  const knownCount =
    Object.values(cognitiveScores).flat().length + Object.values(lifestyleScores).flat().length;
  let legacyScore = null;
  if (knownCount === 0 && unknownValues.length > 0) {
    const avg = unknownValues.reduce((a, b) => a + b, 0) / unknownValues.length;
    legacyScore = clamp(Math.round((4 - avg) * 25), 0, 100); // assume higher raw = more symptoms
    audit.imputation_notes.push(
      'legacy_format: item IDs did not match the current question set; scores derived from overall response pattern'
    );
  } else if (unknownValues.length > 0) {
    audit.imputation_notes.push(`${unknownValues.length} responses had unrecognized item IDs and were excluded`);
  }

  // Domain scores (impute 50 for missing domains)
  const domains = {};
  for (const domain of COGNITIVE_DOMAINS) {
    const scores = cognitiveScores[domain.key];
    if (scores && scores.length > 0) {
      domains[domain.key] = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
    } else if (legacyScore !== null) {
      domains[domain.key] = legacyScore;
    } else {
      domains[domain.key] = 50;
      audit.insufficient_sections.push(domain.key);
      audit.imputation_notes.push(`${domain.key}: no responses; neutral score imputed`);
    }
  }

  // Lifestyle factor scores
  const lifestyle = {};
  for (const factor of LIFESTYLE_FACTORS) {
    const scores = lifestyleScores[factor.key];
    if (scores && scores.length > 0) {
      lifestyle[factor.key] = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
    } else if (legacyScore !== null) {
      lifestyle[factor.key] = legacyScore;
    } else {
      lifestyle[factor.key] = 50;
      audit.insufficient_sections.push(factor.key);
    }
  }

  const cognitiveAvg =
    Object.values(domains).reduce((a, b) => a + b, 0) / COGNITIVE_DOMAINS.length;
  const lifestyleAvg =
    Object.values(lifestyle).reduce((a, b) => a + b, 0) / LIFESTYLE_FACTORS.length;

  const overallScore = clamp(Math.round(0.85 * cognitiveAvg + 0.15 * lifestyleAvg), 0, 100);
  const rating = ratingFor(overallScore);

  // Lifestyle impact levels (High = habit is hurting cognition)
  const lifestyleImpacts = {};
  for (const factor of LIFESTYLE_FACTORS) {
    lifestyleImpacts[factor.key] = impactLevelFor(lifestyle[factor.key]);
  }

  // Risk indicators: weakest domains + harmful habits (max 4)
  const riskIndicators = [];
  const sortedDomains = [...COGNITIVE_DOMAINS].sort((a, b) => domains[a.key] - domains[b.key]);
  for (const domain of sortedDomains) {
    if (domains[domain.key] < 50 && riskIndicators.length < 3) {
      riskIndicators.push(RISK_TEXT[domain.key]);
    }
  }
  for (const factor of LIFESTYLE_FACTORS) {
    if (lifestyleImpacts[factor.key] === 'High' && riskIndicators.length < 4) {
      riskIndicators.push(LIFESTYLE_RISK_TEXT[factor.key]);
    }
  }

  // Strengths: best domains >= 70 (always at least one relative strength)
  const strengths = [];
  const bestFirst = [...COGNITIVE_DOMAINS].sort((a, b) => domains[b.key] - domains[a.key]);
  for (const domain of bestFirst) {
    if (domains[domain.key] >= 70 && strengths.length < 3) {
      strengths.push(STRENGTH_TEXT[domain.key]);
    }
  }
  if (strengths.length === 0) {
    strengths.push(`Relative strength in ${bestFirst[0].label.toLowerCase()} compared to other areas`);
  }

  // Recommendations: weakest 3 domains + problematic habits + general (max 6)
  const recommendations = [];
  for (const domain of sortedDomains.slice(0, 3)) {
    if (domains[domain.key] < 80) recommendations.push(DOMAIN_RECOMMENDATIONS[domain.key]);
  }
  const worstFactors = [...LIFESTYLE_FACTORS].sort(
    (a, b) => lifestyle[a.key] - lifestyle[b.key]
  );
  for (const factor of worstFactors) {
    if (lifestyleImpacts[factor.key] !== 'Low' && recommendations.length < 5) {
      recommendations.push(LIFESTYLE_RECOMMENDATIONS[factor.key]);
    }
  }
  recommendations.push(GENERAL_RECOMMENDATION);

  // Cognitive age estimate: score 70 ≈ age-typical; each point shifts ~0.4y
  const estimatedCognitiveAge = clamp(Math.round(age + (70 - overallScore) * 0.4), 18, 95);

  return {
    assessmentId,
    generatedAt: new Date().toISOString(),
    demographics: { age, gender },
    overall: {
      score: overallScore,
      rating,
      summary: buildSummary(overallScore, rating, bestFirst[0], sortedDomains[0], domains),
    },
    domains,
    lifestyle,
    lifestyleImpacts,
    charts: {
      radarDomains: {
        labels: COGNITIVE_DOMAINS.map((d) => d.label),
        values: COGNITIVE_DOMAINS.map((d) => domains[d.key]),
      },
      barLifestyleImpacts: {
        labels: LIFESTYLE_FACTORS.map((f) => f.label),
        values: LIFESTYLE_FACTORS.map((f) => lifestyle[f.key]),
      },
    },
    riskIndicators,
    strengths,
    recommendations,
    cognitiveAge: {
      actualAge: age,
      estimatedCognitiveAge,
      disclaimer:
        'This estimate compares your self-reported cognitive performance to typical age baselines. It is a wellness indicator, not a medical measurement.',
    },
    audit,
    privacy: {
      dataCollected: ['Age', 'Gender', 'Self-reported responses'],
      storagePolicy:
        'Your responses are processed to generate this report and stored securely in your account. You can request deletion at any time.',
      hipaaNote:
        'This is a wellness self-assessment, not a clinical instrument. It does not create a medical record and is not a HIPAA-covered service.',
    },
    disclaimers: [
      'This report is for informational and wellness purposes only and does not constitute medical advice, diagnosis, or treatment.',
      'Results are based on self-reported answers and can vary with mood, sleep, and context on the day of the assessment.',
      'If you have persistent concerns about memory or thinking, please consult a qualified healthcare professional.',
    ],
  };
}

function buildSummary(score, rating, bestDomain, worstDomain, domains) {
  const best = bestDomain.label.toLowerCase();
  const worst = worstDomain.label.toLowerCase();
  const flat = domains[bestDomain.key] === domains[worstDomain.key];
  if (rating === 'Excellent') {
    return `Your overall cognitive wellness score of ${score} is excellent. Your strongest area is ${best}. Keep your current habits going — they are working.`;
  }
  if (rating === 'Good') {
    if (flat) {
      return `Your overall cognitive wellness score of ${score} is good, with a balanced profile across all cognitive areas. The recommendations below can help you push it further.`;
    }
    return `Your overall cognitive wellness score of ${score} is good. ${capitalize(best)} stands out as a strength, while ${worst} (${domains[worstDomain.key]}) has the most room to grow.`;
  }
  if (rating === 'Moderate') {
    return `Your overall cognitive wellness score of ${score} is moderate. Focused work on ${worst} and the lifestyle habits flagged below can move this meaningfully within weeks.`;
  }
  return `Your overall cognitive wellness score of ${score} suggests several areas need attention, especially ${worst}. The recommendations below are a practical starting point — consider discussing persistent concerns with a healthcare professional.`;
}

const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);
