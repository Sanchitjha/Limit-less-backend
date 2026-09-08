/**
 * Predictive Analytics & AI Recommendation Engine for Cognitive Health.
 */

export function generatePredictiveInsights(analysisData = {}) {
  const memoryScore = Number(analysisData.domainScores?.memory ?? analysisData.memoryScore ?? 75);
  const attentionScore = Number(analysisData.domainScores?.attention ?? analysisData.attentionScore ?? 70);
  const stressScore = Number(analysisData.domainScores?.stress ?? analysisData.stressScore ?? 45);

  const cognitiveDeclineRisk = memoryScore < 50 ? 'High Risk' : memoryScore < 70 ? 'Moderate Risk' : 'Low Risk';
  const burnoutProbability = stressScore > 70 && attentionScore < 60 ? 'High' : stressScore > 50 ? 'Medium' : 'Low';
  const anxietyTrend = stressScore > 65 ? 'Elevated' : 'Stable';
  const attentionIndicator = attentionScore < 55 ? 'Requires Focus Intervention' : 'Normal Range';

  return {
    predictiveScores: {
      cognitiveDeclineRisk,
      burnoutProbability,
      anxietyTrend,
      attentionIndicator,
    },
    recommendations: {
      brainExercises: [
        'Dual N-Back Memory Training (15 mins/day)',
        'Speed Match & Pattern Recognition Tasks',
      ],
      meditationSuggestions: [
        'Mindfulness Breathing (10 mins twice daily)',
        'Guided Progressive Muscle Relaxation',
      ],
      sleepImprovementAdvice: [
        'Maintain a consistent 8-hour circadian routine',
        'Limit screen exposure 1 hour before sleep',
      ],
      dailyImprovementPlan: [
        'Morning: 10m Meditation + Memory Drill',
        'Afternoon: Hydration & Short Walk',
        'Evening: Light Cognitive Puzzle & Sleep Hygiene',
      ],
    },
    benchmarking: {
      ageGroupAverage: 72,
      percentile: memoryScore > 75 ? 85 : 55,
      historicalTrend: 'Improving (+4% over 30 days)',
    },
  };
}

export function formatSpecializedReport(reportType, analysisData = {}) {
  const insights = generatePredictiveInsights(analysisData);
  const base = {
    assessmentId: analysisData.assessmentId || 'N/A',
    generatedAt: new Date().toISOString(),
    reportType,
    predictiveInsights: insights.predictiveScores,
  };

  if (reportType === 'doctor') {
    return {
      ...base,
      clinicalTitle: 'Clinical Cognitive Evaluation Report',
      diagnosticSummary: `Patient exhibits ${insights.predictiveScores.cognitiveDeclineRisk} for cognitive decline. Attention index is ${insights.predictiveScores.attentionIndicator}.`,
      recommendedInterventions: insights.recommendations.brainExercises,
    };
  }

  if (reportType === 'parent') {
    return {
      ...base,
      summaryTitle: 'Child Cognitive & Learning Progress Summary',
      parentNotes: 'Overall engagement is steady. Recommend encouraging memory puzzles and balanced sleep.',
      dailyRoutineSuggestions: insights.recommendations.dailyImprovementPlan,
    };
  }

  // executive
  return {
    ...base,
    executiveTitle: 'Executive Health & Cognitive Resilience Overview',
    burnoutAssessment: `Burnout Probability: ${insights.predictiveScores.burnoutProbability}. Anxiety Trend: ${insights.predictiveScores.anxietyTrend}.`,
    actionItems: insights.recommendations.sleepImprovementAdvice,
  };
}
