/**
 * Built-in question bank.
 *
 * Item ID convention (parsed by the analysis engine — keep in sync):
 *   Cognitive:  q_<domainKey>_<n>_<polarity>   e.g. q_memory_1_n
 *   Lifestyle:  q_ls_<factorKey>_<n>_<polarity> e.g. q_ls_sleepQuality_1_p
 *
 * polarity 'p' = answering "Always" (4) is GOOD for the score
 * polarity 'n' = answering "Always" (4) is BAD for the score
 *
 * IDs must start with "q" — the frontend counts answered questions with
 * key.startsWith('q').
 */

export const COGNITIVE_DOMAINS = [
  { key: 'memory', label: 'Memory' },
  { key: 'attention', label: 'Attention & Focus' },
  { key: 'processingSpeed', label: 'Processing Speed' },
  { key: 'executiveFunction', label: 'Executive Function' },
  { key: 'language', label: 'Language & Communication' },
  { key: 'visuospatial', label: 'Visuospatial Skills' },
];

export const LIFESTYLE_FACTORS = [
  { key: 'sleepQuality', label: 'Sleep Quality' },
  { key: 'stressLevel', label: 'Stress Management' },
  { key: 'physicalActivity', label: 'Physical Activity' },
  { key: 'screenTime', label: 'Screen Habits' },
];

export const QUESTIONS_PER_DOMAIN = 4;
export const QUESTIONS_PER_FACTOR = 2;

const BANK = {
  memory: [
    { text: 'How often do you forget the names of people you met recently?', polarity: 'n' },
    { text: 'How often do you walk into a room and forget why you went there?', polarity: 'n' },
    { text: 'How often do you remember appointments and important dates without checking reminders?', polarity: 'p' },
    { text: 'How often do you misplace everyday items like keys, phone, or glasses?', polarity: 'n' },
    { text: 'How often can you recall details of a conversation from a few days ago?', polarity: 'p' },
    { text: 'How often do you need to re-read something because you forgot what you just read?', polarity: 'n' },
  ],
  attention: [
    { text: 'How often do you lose focus during long meetings, lectures, or conversations?', polarity: 'n' },
    { text: 'How often do small distractions pull you completely away from a task?', polarity: 'n' },
    { text: 'How often can you work on a demanding task for 30 minutes or more without losing focus?', polarity: 'p' },
    { text: 'How often do you catch yourself re-reading the same line because your mind wandered?', polarity: 'n' },
    { text: 'How often can you follow a conversation clearly in a noisy environment?', polarity: 'p' },
    { text: 'How often do you jump between tasks without finishing any of them?', polarity: 'n' },
  ],
  processingSpeed: [
    { text: 'How often do you feel you need extra time to understand new instructions?', polarity: 'n' },
    { text: 'How often do you respond quickly and accurately in fast-paced conversations?', polarity: 'p' },
    { text: 'How often do others seem to finish tasks or reach conclusions faster than you?', polarity: 'n' },
    { text: 'How often do you make quick decisions confidently when under time pressure?', polarity: 'p' },
    { text: 'How often do you feel mentally slow or foggy at the start of the day?', polarity: 'n' },
    { text: 'How often can you do quick mental math, like splitting a bill, without much effort?', polarity: 'p' },
  ],
  executiveFunction: [
    { text: 'How often do you plan your day and actually stick to that plan?', polarity: 'p' },
    { text: 'How often do you start important tasks at the last minute?', polarity: 'n' },
    { text: 'How often do you break big goals into clear, manageable steps?', polarity: 'p' },
    { text: 'How often do you feel overwhelmed when juggling multiple responsibilities?', polarity: 'n' },
    { text: 'How often do you finish what you start, even when it gets difficult?', polarity: 'p' },
    { text: 'How often do you make impulsive decisions that you later regret?', polarity: 'n' },
  ],
  language: [
    { text: 'How often do you struggle to find the right word mid-sentence?', polarity: 'n' },
    { text: 'How often can you explain complex ideas so that others understand them easily?', polarity: 'p' },
    { text: 'How often do you lose your train of thought while speaking?', polarity: 'n' },
    { text: 'How often do you understand written instructions correctly on the first read?', polarity: 'p' },
    { text: 'How often do you mix up or mispronounce words that you normally know well?', polarity: 'n' },
    { text: 'How often can you accurately summarize an article or video after going through it once?', polarity: 'p' },
  ],
  visuospatial: [
    { text: 'How often can you find your way around a new place without getting lost?', polarity: 'p' },
    { text: 'How often do you have trouble judging distances, for example when parking or catching objects?', polarity: 'n' },
    { text: 'How often can you assemble things like furniture or puzzles from diagrams easily?', polarity: 'p' },
    { text: 'How often do you feel disoriented in large buildings like malls or airports?', polarity: 'n' },
    { text: 'How often can you picture how objects would look when rotated or rearranged?', polarity: 'p' },
    { text: 'How often do you bump into things or misjudge the space around you?', polarity: 'n' },
  ],
};

const LIFESTYLE_BANK = {
  sleepQuality: [
    { text: 'How often do you get 7 to 8 hours of restful sleep?', polarity: 'p' },
    { text: 'How often do you wake up feeling tired even after a full night of sleep?', polarity: 'n' },
    { text: 'How often do you fall asleep within 20 minutes of going to bed?', polarity: 'p' },
  ],
  stressLevel: [
    { text: 'How often do you feel stressed or anxious during a typical week?', polarity: 'n' },
    { text: 'How often do you manage daily pressure calmly, using breaks, exercise, or relaxation?', polarity: 'p' },
    { text: 'How often does worry keep you from focusing on what you are doing?', polarity: 'n' },
  ],
  physicalActivity: [
    { text: 'How often do you get at least 30 minutes of physical activity in a day?', polarity: 'p' },
    { text: 'How often do you spend most of your day sitting with very little movement?', polarity: 'n' },
    { text: 'How often do you choose active options like stairs or walking when available?', polarity: 'p' },
  ],
  screenTime: [
    { text: 'How often do you spend more than 6 hours a day on screens outside of essential work?', polarity: 'n' },
    { text: 'How often do you take intentional breaks from your phone and other screens?', polarity: 'p' },
    { text: 'How often do you scroll on your phone right up until you fall asleep?', polarity: 'n' },
  ],
};

const pickRandom = (arr, count) => {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, Math.min(count, copy.length));
};

export const cognitiveItemId = (domainKey, index, polarity) =>
  `q_${domainKey}_${index}_${polarity}`;

export const lifestyleItemId = (factorKey, index, polarity) =>
  `q_ls_${factorKey}_${index}_${polarity}`;

/**
 * Build assessment sections from the static bank.
 * Shape matches what the frontend stores in sessionStorage ("assessmentSections"):
 *   [{ id, title, items: [{ id, text }] }]
 */
export function buildBankSections() {
  const sections = COGNITIVE_DOMAINS.map((domain) => {
    const items = pickRandom(BANK[domain.key], QUESTIONS_PER_DOMAIN).map((q, i) => ({
      id: cognitiveItemId(domain.key, i + 1, q.polarity),
      text: q.text,
    }));
    return { id: domain.key, title: domain.label, items };
  });

  const lifestyleItems = LIFESTYLE_FACTORS.flatMap((factor) =>
    pickRandom(LIFESTYLE_BANK[factor.key], QUESTIONS_PER_FACTOR).map((q, i) => ({
      id: lifestyleItemId(factor.key, i + 1, q.polarity),
      text: q.text,
    }))
  );
  sections.push({ id: 'lifestyle', title: 'Lifestyle & Habits', items: lifestyleItems });

  return sections;
}

/**
 * Build sections from AI-generated question sets, assigning IDs server-side so
 * scoring stays deterministic regardless of how the text was produced.
 * aiQuestions shape: { <domainKey>: [{text, polarity}], lifestyle: { <factorKey>: [{text, polarity}] } }
 */
export function buildSectionsFromAI(aiQuestions) {
  const sections = COGNITIVE_DOMAINS.map((domain) => {
    const items = aiQuestions[domain.key].slice(0, QUESTIONS_PER_DOMAIN).map((q, i) => ({
      id: cognitiveItemId(domain.key, i + 1, q.polarity === 'p' ? 'p' : 'n'),
      text: q.text,
    }));
    return { id: domain.key, title: domain.label, items };
  });

  const lifestyleItems = LIFESTYLE_FACTORS.flatMap((factor) =>
    aiQuestions.lifestyle[factor.key].slice(0, QUESTIONS_PER_FACTOR).map((q, i) => ({
      id: lifestyleItemId(factor.key, i + 1, q.polarity === 'p' ? 'p' : 'n'),
      text: q.text,
    }))
  );
  sections.push({ id: 'lifestyle', title: 'Lifestyle & Habits', items: lifestyleItems });

  return sections;
}

/** Throws if AI output is missing any domain/factor or has too few items. */
export function validateAIQuestions(aiQuestions) {
  for (const domain of COGNITIVE_DOMAINS) {
    const items = aiQuestions?.[domain.key];
    if (!Array.isArray(items) || items.length < QUESTIONS_PER_DOMAIN) {
      throw new Error(`AI questions missing domain "${domain.key}"`);
    }
    for (const item of items) {
      if (typeof item?.text !== 'string' || item.text.length < 10) {
        throw new Error(`AI question text invalid in domain "${domain.key}"`);
      }
    }
  }
  for (const factor of LIFESTYLE_FACTORS) {
    const items = aiQuestions?.lifestyle?.[factor.key];
    if (!Array.isArray(items) || items.length < QUESTIONS_PER_FACTOR) {
      throw new Error(`AI questions missing lifestyle factor "${factor.key}"`);
    }
    for (const item of items) {
      if (typeof item?.text !== 'string' || item.text.length < 10) {
        throw new Error(`AI question text invalid in factor "${factor.key}"`);
      }
    }
  }
}
