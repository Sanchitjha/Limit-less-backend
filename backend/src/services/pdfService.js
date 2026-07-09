/**
 * PDF report builder (pdfkit).
 *
 * buildReportPdf(analysis, brand, { teaser }) -> Promise<Buffer>
 *
 * Accepts the analysis JSON produced by analysisEngine.js (the same object
 * the frontend stores in users.report_json). All fields are defensively
 * defaulted so a partial/legacy report never crashes PDF generation.
 */

import PDFDocument from 'pdfkit';

const SLATE_900 = '#0F172A';
const SLATE_600 = '#475569';
const SLATE_400 = '#94A3B8';
const SLATE_200 = '#E2E8F0';
const GREEN = '#10B981';
const AMBER = '#F59E0B';
const RED = '#EF4444';

const PAGE_W = 595.28; // A4
const MARGIN = 50;
const CONTENT_W = PAGE_W - MARGIN * 2;

const ratingColor = (rating) => {
  if (/Excellent|Good/.test(rating)) return GREEN;
  if (/Risk|Critical/.test(rating)) return RED;
  return '#6366F1';
};

const impactColor = (level) =>
  level === 'High' ? RED : level === 'Moderate' ? AMBER : GREEN;

const scoreColor = (score) => (score >= 75 ? GREEN : score >= 50 ? '#6366F1' : RED);

const prettyKey = (key) =>
  key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (c) => c.toUpperCase())
    .trim();

function normalizeAnalysis(raw) {
  const a = raw && typeof raw === 'object' ? raw : {};
  return {
    overall: {
      score: Number(a.overall?.score) || 0,
      rating: typeof a.overall?.rating === 'string' ? a.overall.rating : 'Pending',
      summary: typeof a.overall?.summary === 'string' ? a.overall.summary : '',
    },
    domains: a.domains && typeof a.domains === 'object' ? a.domains : {},
    lifestyleImpacts:
      a.lifestyleImpacts && typeof a.lifestyleImpacts === 'object' ? a.lifestyleImpacts : {},
    riskIndicators: Array.isArray(a.riskIndicators) ? a.riskIndicators : [],
    strengths: Array.isArray(a.strengths) ? a.strengths : [],
    recommendations: Array.isArray(a.recommendations) ? a.recommendations : [],
    cognitiveAge: a.cognitiveAge && typeof a.cognitiveAge === 'object' ? a.cognitiveAge : null,
    disclaimers: Array.isArray(a.disclaimers) ? a.disclaimers : [],
    privacy: a.privacy && typeof a.privacy === 'object' ? a.privacy : null,
    generatedAt: a.generatedAt || new Date().toISOString(),
  };
}

const polar = (cx, cy, r, deg) => {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
};

const arcPath = (cx, cy, r, startDeg, endDeg) => {
  const start = polar(cx, cy, r, startDeg);
  const end = polar(cx, cy, r, endDeg);
  const largeArc = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y}`;
};

export function buildReportPdf(rawAnalysis, brand = {}, { teaser = false } = {}) {
  const analysis = normalizeAnalysis(rawAnalysis);
  const primary = typeof brand?.primaryColor === 'string' ? brand.primaryColor : '#3B82F6';
  const accent = typeof brand?.accentColor === 'string' ? brand.accentColor : '#6366F1';

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      // Small bottom margin so the absolutely-positioned footer (y≈800)
      // never triggers pdfkit's auto page-break (which adds blank pages).
      margins: { top: MARGIN, bottom: 20, left: MARGIN, right: MARGIN },
      info: {
        Title: teaser ? 'Limitless Cognitive Teaser Report' : 'Limitless Cognitive Wellness Report',
        Author: 'Limitless',
      },
    });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    try {
      renderCoverPage(doc, analysis, primary, accent, teaser);
      renderScoresPage(doc, analysis, primary, accent, teaser);
      if (!teaser) {
        renderRecommendationsPage(doc, analysis, primary, accent);
      } else {
        renderUpsellPage(doc, primary, accent);
      }
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

// ── Page 1: cover + overall score ────────────────────────────────────────────

function renderCoverPage(doc, analysis, primary, accent, teaser) {
  // Header band
  doc.rect(0, 0, PAGE_W, 130).fill(primary);
  doc.fill('#FFFFFF').font('Helvetica-Bold').fontSize(24).text('LIMITLESS', MARGIN, 38);
  doc
    .font('Helvetica')
    .fontSize(13)
    .text(teaser ? 'Cognitive Wellness Report — Free Preview' : 'Cognitive Wellness Report', MARGIN, 70);
  const dateStr = new Date(analysis.generatedAt).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  doc.fontSize(10).fillOpacity(0.85).text(dateStr, MARGIN, 92).fillOpacity(1);

  // Score donut
  const cx = MARGIN + 80;
  const cy = 250;
  const r = 62;
  const score = Math.min(100, Math.max(0, analysis.overall.score));
  const col = ratingColor(analysis.overall.rating);

  doc.circle(cx, cy, r).lineWidth(13).stroke(SLATE_200);
  if (score > 0) {
    const endDeg = Math.min(359.9, (score / 100) * 360);
    doc.path(arcPath(cx, cy, r, 0, endDeg)).lineWidth(13).lineCap('round').stroke(col);
  }
  doc
    .fill(SLATE_900)
    .font('Helvetica-Bold')
    .fontSize(38)
    .text(String(score), cx - 50, cy - 24, { width: 100, align: 'center' });
  doc
    .fill(SLATE_400)
    .font('Helvetica')
    .fontSize(11)
    .text('out of 100', cx - 50, cy + 18, { width: 100, align: 'center' });

  // Rating + summary next to the donut
  const rx = cx + r + 40;
  const rw = PAGE_W - MARGIN - rx;
  doc
    .fill(SLATE_400)
    .font('Helvetica-Bold')
    .fontSize(10)
    .text('OVERALL RATING', rx, 185, { characterSpacing: 1 });
  doc.fill(col).font('Helvetica-Bold').fontSize(26).text(analysis.overall.rating, rx, 202);

  if (analysis.overall.summary) {
    doc
      .fill(SLATE_600)
      .font('Helvetica')
      .fontSize(11)
      .text(analysis.overall.summary, rx, 245, { width: rw, lineGap: 3 });
  }

  // Strengths / risks columns
  let y = 360;
  const colW = (CONTENT_W - 30) / 2;
  y = renderListBox(doc, 'KEY STRENGTHS', analysis.strengths, MARGIN, y, colW, GREEN);
  renderListBox(
    doc,
    'RISK INDICATORS',
    analysis.riskIndicators.length > 0 ? analysis.riskIndicators : ['No significant risks detected'],
    MARGIN + colW + 30,
    360,
    colW,
    analysis.riskIndicators.length > 0 ? RED : GREEN
  );

  renderFooter(doc, accent, teaser);
}

function renderListBox(doc, title, items, x, y, width, markerColor) {
  doc.fill(SLATE_400).font('Helvetica-Bold').fontSize(10).text(title, x, y, { characterSpacing: 1 });
  let cy = y + 20;
  for (const item of items.slice(0, 4)) {
    doc.circle(x + 4, cy + 5, 2.5).fill(markerColor);
    doc.fill(SLATE_600).font('Helvetica').fontSize(10);
    const h = doc.heightOfString(String(item), { width: width - 16, lineGap: 2 });
    doc.text(String(item), x + 14, cy, { width: width - 16, lineGap: 2 });
    cy += h + 10;
  }
  return cy;
}

// ── Page 2: domain scores + lifestyle + cognitive age ────────────────────────

function renderScoresPage(doc, analysis, primary, accent, teaser) {
  doc.addPage();
  sectionTitle(doc, 'Cognitive Domain Scores', MARGIN, 60);

  let y = 95;
  const entries = Object.entries(analysis.domains);
  for (const [key, value] of entries) {
    const score = Math.min(100, Math.max(0, Math.round(Number(value) || 0)));
    const col = scoreColor(score);
    doc.fill(SLATE_600).font('Helvetica-Bold').fontSize(10).text(prettyKey(key), MARGIN, y);
    doc.fill(col).font('Helvetica-Bold').fontSize(10).text(String(score), PAGE_W - MARGIN - 30, y, {
      width: 30,
      align: 'right',
    });
    // Bar
    const barY = y + 16;
    const barW = CONTENT_W;
    doc.roundedRect(MARGIN, barY, barW, 7, 3.5).fill(SLATE_200);
    if (score > 0) {
      doc.roundedRect(MARGIN, barY, Math.max(7, (score / 100) * barW), 7, 3.5).fill(col);
    }
    y += 42;
  }

  // Lifestyle
  y += 10;
  sectionTitle(doc, 'Lifestyle Assessment', MARGIN, y);
  y += 32;

  const impacts = Object.entries(analysis.lifestyleImpacts);
  if (teaser) {
    doc
      .roundedRect(MARGIN, y, CONTENT_W, 60, 8)
      .fillAndStroke('#F8FAFC', SLATE_200);
    doc
      .fill(SLATE_400)
      .font('Helvetica-Bold')
      .fontSize(11)
      .text('LOCKED — included in the full report', MARGIN, y + 24, {
        width: CONTENT_W,
        align: 'center',
        characterSpacing: 1,
      });
    y += 80;
  } else {
    for (const [key, level] of impacts) {
      const col = impactColor(level);
      doc.fill(SLATE_600).font('Helvetica').fontSize(11).text(prettyKey(key), MARGIN, y);
      const pillW = 96;
      const pillX = PAGE_W - MARGIN - pillW;
      doc.roundedRect(pillX, y - 3, pillW, 18, 9).fill(col);
      doc
        .fill('#FFFFFF')
        .font('Helvetica-Bold')
        .fontSize(8.5)
        .text(`${level} impact`.toUpperCase(), pillX, y + 2, {
          width: pillW,
          align: 'center',
          lineBreak: false,
        });
      y += 30;
    }
    y += 10;
  }

  // Cognitive age
  if (analysis.cognitiveAge && y < 640) {
    sectionTitle(doc, 'Cognitive Age Estimate', MARGIN, y);
    y += 32;
    const boxW = (CONTENT_W - 20) / 2;
    const actual = teaser ? 'XX' : String(analysis.cognitiveAge.actualAge ?? '—');
    const estimated = teaser ? 'XX' : String(analysis.cognitiveAge.estimatedCognitiveAge ?? '—');
    renderAgeBox(doc, 'ACTUAL AGE', actual, MARGIN, y, boxW, accent);
    renderAgeBox(doc, 'COGNITIVE AGE', estimated, MARGIN + boxW + 20, y, boxW, GREEN);
    y += 95;
    if (!teaser && analysis.cognitiveAge.disclaimer) {
      doc
        .fill(SLATE_400)
        .font('Helvetica-Oblique')
        .fontSize(9)
        .text(analysis.cognitiveAge.disclaimer, MARGIN, y, { width: CONTENT_W, lineGap: 2 });
    }
  }

  renderFooter(doc, accent, teaser);
}

function renderAgeBox(doc, label, value, x, y, w, color) {
  doc.roundedRect(x, y, w, 75, 10).fillAndStroke('#F8FAFC', SLATE_200);
  doc
    .fill(SLATE_400)
    .font('Helvetica-Bold')
    .fontSize(9)
    .text(label, x, y + 12, { width: w, align: 'center', characterSpacing: 1 });
  doc.fill(color).font('Helvetica-Bold').fontSize(30).text(value, x, y + 28, {
    width: w,
    align: 'center',
  });
}

// ── Page 3 (full): recommendations + privacy + disclaimers ───────────────────

function renderRecommendationsPage(doc, analysis, primary, accent) {
  doc.addPage();
  sectionTitle(doc, 'Personalized Recommendations', MARGIN, 60);

  let y = 95;
  analysis.recommendations.slice(0, 6).forEach((rec, i) => {
    doc.circle(MARGIN + 10, y + 8, 10).fill(accent);
    doc
      .fill('#FFFFFF')
      .font('Helvetica-Bold')
      .fontSize(10)
      .text(String(i + 1), MARGIN + 2, y + 3, { width: 16, align: 'center' });
    doc.fill(SLATE_600).font('Helvetica').fontSize(10.5);
    const h = doc.heightOfString(String(rec), { width: CONTENT_W - 35, lineGap: 3 });
    doc.text(String(rec), MARGIN + 32, y, { width: CONTENT_W - 35, lineGap: 3 });
    y += h + 18;
  });

  if (analysis.privacy) {
    y += 10;
    sectionTitle(doc, 'Privacy & Data', MARGIN, y);
    y += 30;
    doc.fill(SLATE_600).font('Helvetica').fontSize(9.5);
    if (Array.isArray(analysis.privacy.dataCollected)) {
      doc.text(`Data collected: ${analysis.privacy.dataCollected.join(', ')}`, MARGIN, y, {
        width: CONTENT_W,
        lineGap: 2,
      });
      y = doc.y + 8;
    }
    if (analysis.privacy.storagePolicy) {
      doc.text(analysis.privacy.storagePolicy, MARGIN, y, { width: CONTENT_W, lineGap: 2 });
      y = doc.y + 8;
    }
    if (analysis.privacy.hipaaNote) {
      doc.text(analysis.privacy.hipaaNote, MARGIN, y, { width: CONTENT_W, lineGap: 2 });
      y = doc.y + 8;
    }
  }

  if (analysis.disclaimers.length > 0) {
    y += 12;
    sectionTitle(doc, 'Disclaimers', MARGIN, y);
    y += 30;
    doc.fill(SLATE_400).font('Helvetica').fontSize(8.5);
    for (const d of analysis.disclaimers) {
      doc.text(`• ${d}`, MARGIN, y, { width: CONTENT_W, lineGap: 2 });
      y = doc.y + 5;
    }
  }

  renderFooter(doc, accent, false);
}

// ── Teaser upsell page ────────────────────────────────────────────────────────

function renderUpsellPage(doc, primary, accent) {
  doc.addPage();
  doc.roundedRect(MARGIN, 130, CONTENT_W, 355, 16).fillAndStroke('#F8FAFC', SLATE_200);

  doc
    .fill(SLATE_900)
    .font('Helvetica-Bold')
    .fontSize(22)
    .text('Unlock Your Full Report', MARGIN, 170, { width: CONTENT_W, align: 'center' });
  doc
    .fill(SLATE_600)
    .font('Helvetica')
    .fontSize(12)
    .text('Your complete cognitive wellness report includes:', MARGIN, 210, {
      width: CONTENT_W,
      align: 'center',
    });

  const perks = [
    'Personalized, science-backed recommendations',
    'Full lifestyle assessment with impact levels',
    'Your cognitive age estimate',
    'Complete audit and privacy details',
    'Downloadable and shareable PDF report',
  ];
  let y = 250;
  for (const perk of perks) {
    doc.circle(MARGIN + 130, y + 5, 3).fill(accent);
    doc.fill(SLATE_600).font('Helvetica').fontSize(11.5).text(perk, MARGIN + 145, y);
    y += 26;
  }

  doc.roundedRect(PAGE_W / 2 - 110, y + 15, 220, 40, 20).fill(primary);
  doc
    .fill('#FFFFFF')
    .font('Helvetica-Bold')
    .fontSize(13)
    .text('Upgrade for $19 — one time', PAGE_W / 2 - 110, y + 27, {
      width: 220,
      align: 'center',
    });
  doc
    .fill(SLATE_400)
    .font('Helvetica')
    .fontSize(10)
    .text('Log in to your Limitless dashboard to complete your upgrade.', MARGIN, y + 75, {
      width: CONTENT_W,
      align: 'center',
    });

  renderFooter(doc, accent, true);
}

// ── Shared helpers ────────────────────────────────────────────────────────────

function sectionTitle(doc, text, x, y) {
  doc
    .fill(SLATE_400)
    .font('Helvetica-Bold')
    .fontSize(11)
    .text(text.toUpperCase(), x, y, { characterSpacing: 1.5 });
  doc
    .moveTo(x, y + 18)
    .lineTo(PAGE_W - MARGIN, y + 18)
    .lineWidth(0.5)
    .stroke(SLATE_200);
}

function renderFooter(doc, accent, teaser) {
  const y = 800;
  doc
    .fill(SLATE_400)
    .font('Helvetica')
    .fontSize(8)
    .text(
      `Limitless Cognitive Wellness ${teaser ? '· Free Preview' : ''} · This report is for informational purposes only and is not medical advice.`,
      MARGIN,
      y,
      { width: CONTENT_W, align: 'center' }
    );
}
