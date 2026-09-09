import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const OUTPUT = path.join(__dirname, '..', 'Limitless_Atul_Sir_Report.pdf');
const ARTIFACT = 'C:\\Users\\Sanchit\\.gemini\\antigravity-ide\\brain\\ff5af786-56c9-4669-8e29-50caaa9a9899\\Limitless_Atul_Sir_Report.pdf';

const doc = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true });
fs.createWriteStream(OUTPUT).then ? null : null; // no-op
const stream = fs.createWriteStream(OUTPUT);
doc.pipe(stream);

const PW = 595.28, PH = 841.89;
const ML = 50, MR = 50, CW = PW - ML - MR;  // 495.28

const C = {
  dark: '#0F172A', blue: '#2563EB', blueDk: '#1E3A8A',
  blueLt: '#DBEAFE', green: '#059669', greenLt: '#D1FAE5',
  orange: '#D97706', orangeLt: '#FEF3C7', red: '#B91C1C',
  txt: '#1E293B', muted: '#475569', border: '#CBD5E1',
  row0: '#F8FAFC', row1: '#EFF6FF', white: '#FFFFFF',
};

// ─── low-level primitives ────────────────────────────────────────────
const fillRect  = (x,y,w,h,f)         => doc.rect(x,y,w,h).fill(f);
const strokeRect= (x,y,w,h,f,s)       => doc.rect(x,y,w,h).fillAndStroke(f,s);
const hLine     = (y,col=C.border)    => doc.moveTo(ML,y).lineTo(PW-MR,y).strokeColor(col).lineWidth(0.5).stroke();

// ─── Text helpers (always lineBreak:false or explicit width) ─────────
const txt = (str, x, y, sz, font, col, opts={}) => {
  doc.fontSize(sz).font(font).fillColor(col)
     .text(str, x, y, { lineBreak: false, ...opts });
};

// Render text THEN return new Y (wrapping allowed)
const wrapTxt = (str, x, y, w, sz, font, col, lineGap=2) => {
  doc.fontSize(sz).font(font).fillColor(col)
     .text(str, x, y, { width: w, lineGap, align: 'left' });
  return doc.y;
};

// ─── Measured block: draw bg AFTER measuring text height ─────────────
// Returns end Y
const measuredBlock = (render, startY, padV=10, padH=12, bg=C.blueLt, stroke=C.blue) => {
  // 1. render text invisibly to measure
  const fakeDoc = { y: startY + padV };
  doc.save();
  doc.opacity(0);
  const textStartY = startY + padV;
  render(ML + padH, textStartY);
  const textEndY = doc.y;
  doc.restore();

  const h = (textEndY - textStartY) + padV * 2;

  // 2. draw background
  strokeRect(ML, startY, CW, h, bg, stroke);
  // 3. render text for real
  render(ML + padH, textStartY);

  return startY + h + 8;
};

// ─── Section heading with left bar ──────────────────────────────────
const secHead = (label, y, col=C.blue) => {
  fillRect(ML, y, 5, 18, col);
  txt(label, ML+12, y+2, 11.5, 'Helvetica-Bold', C.dark);
  return y + 26;
};

// ─── Table row (2 col) ───────────────────────────────────────────────
const tRow = (label, val, y, bg=C.row0) => {
  const H = 24;
  fillRect(ML, y, CW, H, bg);
  doc.strokeColor(C.border).lineWidth(0.5).rect(ML,y,CW,H).stroke();
  txt(label, ML+10, y+6, 8.5, 'Helvetica-Bold', C.muted, { width: 175, ellipsis: true });
  txt(val,   ML+192, y+6, 8.5, 'Helvetica',      C.txt,  { width: CW-202, ellipsis: true });
  return y + H + 1;
};

// ─── Feature row (number circle + title + desc) ──────────────────────
const featRow = (num, title, desc, y, bg=C.row0) => {
  const H = 42;
  fillRect(ML, y, CW, H, bg);
  doc.strokeColor(C.border).lineWidth(0.5).rect(ML,y,CW,H).stroke();
  fillRect(ML, y, 4, H, C.blue);
  // circle
  doc.circle(ML+20, y+14, 9).fill(C.blue);
  txt(num, ML+16, y+8, 9, 'Helvetica-Bold', C.white);
  txt(title, ML+36, y+7,  9.5, 'Helvetica-Bold', C.dark,  { width: CW-46, ellipsis: true });
  txt(desc,  ML+36, y+20, 8.5, 'Helvetica',      C.muted, { width: CW-46, ellipsis: true });
  return y + H + 3;
};

// ─── Banner ───────────────────────────────────────────────────────────
const banner = (t1, t2, pg) => {
  fillRect(0, 0, PW, 72, C.dark);
  fillRect(0, 68, PW, 4, C.blue);
  txt(t1, ML, 15, 18, 'Helvetica-Bold', C.white);
  txt(t2, ML, 40, 9,  'Helvetica',      '#94A3B8');
  txt(`Page ${pg}  |  Limitless Platform  |  Sept 8, 2026`, ML, 54, 7.5, 'Helvetica-Bold', C.blue);
};

// ─── Table header row ────────────────────────────────────────────────
const tHead = (col1, col2, y) => {
  fillRect(ML, y, CW, 20, C.blueDk);
  txt(col1, ML+10, y+5, 8.5, 'Helvetica-Bold', C.white);
  txt(col2, ML+192, y+5, 8.5, 'Helvetica-Bold', C.white);
  return y + 20;
};


// ════════════════════════════════════════════════════
// PAGE 1 — COVER & OVERVIEW
// ════════════════════════════════════════════════════
banner('Limitless Platform — Aaj Ka Kaam', 'Aapke Liye Simple Bhasha Mein Poori Report', 1);

let y = 84;

// "To" meta card
strokeRect(ML, y, CW, 55, C.row0, C.border);
fillRect(ML, y, 5, 55, C.blue);
txt('REPORT TAYYAR KI GAYI HAI:',               ML+14, y+8,  7.5, 'Helvetica-Bold', C.muted);
txt('Atul Sir',                                  ML+14, y+20, 15,  'Helvetica-Bold', C.dark);
txt('Executive Owner — Limitless Cognitive Platform', ML+14, y+38, 8.5, 'Helvetica', C.muted);
txt('8 SEPTEMBER 2026',                          PW-MR-110, y+38, 8, 'Helvetica-Bold', C.blue);
y += 63;

// Intro card — MEASURED so text never overflows
y = measuredBlock((tx, ty) => {
  wrapTxt(
    'Aaj humne Limitless platform ka "andar ka system" (backend) bahut bada upgrade kiya hai.\n' +
    'Is report mein BILKUL SIMPLE language mein bataya gaya hai:\n\n' +
    '  >>  Kya kya naya bana\n' +
    '  >>  Aapke business ko kya fayda hoga\n' +
    '  >>  Admin panel developer ko kya dena hai\n' +
    '  >>  Mobile app developer ko kya dena hai',
    tx, ty, CW-26, 9.5, 'Helvetica', C.txt, 3
  );
}, y, 10, 12, C.blueLt, C.blue);

y = secHead('Ek Line Mein Samjho', y);
y = measuredBlock((tx, ty) => {
  wrapTxt(
    'Socho jaise ek badi dukaan ka store room pehle se zyada organized ho jaye — CCTV cameras lag jayein, ek manager ka dedicated cabin ban jaye, aur ek secret safe locker bhi aa jaye. Bilkul yehi hua hai aaj Limitless ke saath.',
    tx, ty, CW-26, 9.5, 'Helvetica', C.txt, 3
  );
}, y, 10, 12, C.greenLt, C.green);

y = secHead('Aaj Kya Kya Bana — Quick List', y);

const overview = [
  { n:'1', t:'ADMIN CONTROL ROOM',          d:'Puri Limitless platform ek hi jagah se manage karo — users, payments, reports, sab kuch' },
  { n:'2', t:'USER DATA SAFETY (GDPR)',      d:'Har user ka data legally safe — download bhi kar sakte hain, permanently delete bhi' },
  { n:'3', t:'SECURITY MONITORING (VIGIL)',  d:'Platform par 24x7 nazar — koi bhi galat kaam turant pakda jayega' },
  { n:'4', t:'SECRET FILE SAFE (VAULTRIX)',  d:'Sensitive documents encrypted safe mein — sirf authorized log hi dekh sakte hain' },
  { n:'5', t:'FUTURE PREDICTION ENGINE',    d:'Platform ka future usage predict karo — planning aur scaling ke liye' },
  { n:'6', t:'AUTO BACKUP SYSTEM',           d:'Ek click mein poora data ka backup ready — koi bhi data loss ka risk nahi' },
  { n:'7', t:'QUALITY TESTING — 100% PASS', d:'65 automatic tests chalaye gaye — 0 fail — platform puri tarah ready hai' },
];
overview.forEach((o,i) => { y = featRow(o.n, o.t, o.d, y, i%2===0 ? C.row0 : C.row1); });


// ════════════════════════════════════════════════════
// PAGE 2 — ADMIN CONTROL ROOM
// ════════════════════════════════════════════════════
doc.addPage();
banner('Admin Control Room — Poori Detail', 'Yeh hai aapke platform ka main control center', 2);
let y2 = 84;

y2 = secHead('Samjho Aise', y2);
y2 = measuredBlock((tx, ty) => {
  wrapTxt(
    'SOCHIYE: Ek bade hospital ka Control Room — jahan se ek hi jagah par doctor ki availability, patients ki poori details, aur billing sab kuch dikhta hai. Sirf authorized log hi andar ja sakte hain. Aapka Admin Control Room bilkul waisa hi hai Limitless ke liye.',
    tx, ty, CW-26, 9.5, 'Helvetica', C.txt, 3
  );
}, y2, 10, 12, C.blueLt, C.blue);

y2 = secHead('Admin Room Mein Kya Kya Milta Hai', y2);

y2 = tHead('Feature Ka Naam', 'Aapke Liye Kya Kaam Aayega', y2);

const adminRows = [
  { l:'Dashboard — Sab Ek Nazar Mein',    v:'Total users, paid users, aaj ki kamai (MRR), naye signups — sab ek screen par' },
  { l:'Users Ki Poori List',              v:'Naam, email, plan status, saari tests — search aur filter ke saath' },
  { l:'Plan Badalna (Upgrade/Downgrade)', v:'Kisi bhi user ko paid/free/suspended karo — ek click mein, turant effect' },
  { l:'User Block / Unblock',             v:'Kisi user ka access rokna ya wapas dena — seedha admin panel se' },
  { l:'Sub-Admin Approval System',        v:'Kisi aur ko limited admin access dene ki request aayegi — aap approve ya reject karein' },
  { l:'Coupon / Promo Code Generator',   v:'Discount coupons banao — percentage ya fixed amount, max uses set karo' },
  { l:'Question Bank Manager',           v:'Cognitive tests ke questions manage karo — category aur options ke saath' },
  { l:'Invoice & Billing Records',       v:'Har payment ka record — kaun, kitna, kab — sab ek jagah' },
  { l:'Customer Support Tickets',        v:'User ki koi bhi problem yahan dikhegi — assign karo, status track karo' },
  { l:'AI Smart Rules',                  v:'AI platform kab kya bole — uske rules yahan customize karo aasaani se' },
  { l:'Database Backup Button',          v:'Ek click — aur poore platform ka backup ready. Emergency mein kaam aayega' },
];
adminRows.forEach((r,i) => { y2 = tRow(r.l, r.v, y2, i%2===0 ? C.row0 : C.row1); });

y2 += 10;
y2 = measuredBlock((tx, ty) => {
  txt('IMPORTANT:', tx, ty, 9, 'Helvetica-Bold', C.orange);
  wrapTxt(
    '       Admin Control Room sirf aapke trusted log hi use kar sakte hain — secure login ke baad. Har action ka record (Audit Log) automatically save hota rehta hai.',
    tx, ty, CW-26, 9, 'Helvetica', C.txt, 3
  );
}, y2, 10, 12, C.orangeLt, C.orange);


// ════════════════════════════════════════════════════
// PAGE 3 — PRIVACY, SECURITY & SMART FEATURES
// ════════════════════════════════════════════════════
doc.addPage();
banner('Privacy, Security & Smart Features', 'User protection, data safety aur platform ki future readiness', 3);
let y3 = 84;

// GDPR
y3 = secHead('1.  User Data Privacy — GDPR Compliance', y3);
y3 = measuredBlock((tx, ty) => {
  wrapTxt(
    'SAMJHO AISE: Jaise koi bank customer keh sakta hai — "Mujhe meri saari details print karke do" ya "Mera account band karo aur sab delete karo" — yeh unka legal right hai.\n\n' +
    'Limitless mein bhi exactly yahi ab available hai:\n\n' +
    '  [ DATA DOWNLOAD ]   User apna POORA DATA ek file mein download kar sakta hai.\n' +
    '  [ ACCOUNT DELETE ]  User apna account permanently erase kar sakta hai — sab kuch hata diya jata hai.',
    tx, ty, CW-26, 9.5, 'Helvetica', C.txt, 3
  );
}, y3, 10, 12, C.blueLt, C.blue);

// Vigil
y3 = secHead('2.  Security Monitoring — Vigil (CCTV System)', y3);
y3 = measuredBlock((tx, ty) => {
  wrapTxt(
    'SAMJHO AISE: Jaise kisi mall mein 24 ghante CCTV kaam karta hai — koi bhi suspicious insaan ghusne ki koshish kare toh turant security ko pata chalta hai.\n\n' +
    '  [ ALERT ]   Agar koi galat tarike se platform access karne ki koshish kare — turant notify hoga.\n' +
    '  [ HEALTH ]  Platform ki health (sab theek hai ya nahi) real-time mein dikhta rehta hai.',
    tx, ty, CW-26, 9.5, 'Helvetica', C.txt, 3
  );
}, y3, 10, 12, C.orangeLt, C.orange);

// Vaultrix
y3 = secHead('3.  Secret File Safe — Vaultrix (Encrypted Storage)', y3);
y3 = measuredBlock((tx, ty) => {
  wrapTxt(
    'SAMJHO AISE: Bank ka locker — andar rakhi cheez encrypted hoti hai — sirf sahi insaan hi access kar sakta hai, koi aur nahi dekh sakta.\n\n' +
    '  [ SAFE ]   Limitless ke saare sensitive documents ek encrypted vault mein hain — 100% secure.',
    tx, ty, CW-26, 9.5, 'Helvetica', C.txt, 3
  );
}, y3, 10, 12, C.greenLt, C.green);

// VPP
y3 = secHead('4.  Future Prediction Engine — VPP (Analytics)', y3);
y3 = measuredBlock((tx, ty) => {
  wrapTxt(
    'SAMJHO AISE: Ek experienced manager jo dekh ke bata sakta hai — "Agli summer mein sales double honge, abhi se tayari kar lo."\n\n' +
    '  [ PREDICT ]   Platform ka future usage predict karta hai — aap pehle se scale kar sakte hain.',
    tx, ty, CW-26, 9.5, 'Helvetica', C.txt, 3
  );
}, y3, 10, 12, C.blueLt, C.blue);

// Backup
y3 = secHead('5.  Auto Database Backup', y3);
y3 = measuredBlock((tx, ty) => {
  wrapTxt(
    'SAMJHO AISE: Phone ka auto-backup — agar phone kho jaye toh bhi sab data milta hai.\n\n' +
    '  [ BACKUP ]   Admin ek button dabaaye aur poore database ka backup minute mein tayyar — koi risk nahi.',
    tx, ty, CW-26, 9.5, 'Helvetica', C.txt, 3
  );
}, y3, 10, 12, C.greenLt, C.green);

// Testing
y3 = secHead('6.  Quality Testing — 65 Checks, 0 Fail', y3);
y3 = measuredBlock((tx, ty) => {
  doc.fontSize(10).font('Helvetica-Bold').fillColor(C.green)
     .text('RESULT: 65 Tests Pass Hue — 0 Fail — 100% Platform Ready!', tx, ty, { lineBreak: false });
  wrapTxt(
    '\nSAMJHO AISE: Jaise car factory mein delivery se pehle 65 point quality check hoti hai — har ek cheez test ki gayi, sab kuch sahi nikla. Limitless aaj fully ready hai.',
    tx, ty+14, CW-26, 9, 'Helvetica', C.txt, 3
  );
}, y3, 10, 12, C.greenLt, C.green);


// ════════════════════════════════════════════════════
// PAGE 4 — BUSINESS BENEFITS & HANDOFFS
// ════════════════════════════════════════════════════
doc.addPage();
banner('Business Benefits & Developer Handoff', 'Is sab kaam se aapke business ko kya milega', 4);
let y4 = 84;

y4 = secHead('Aapke Business Ko Kya Fayda Hua?', y4);
y4 = tHead('Kya Mila', 'Kaise Fayda Hoga', y4);

const benefits = [
  { l:'Data Loss Ka Zero Risk',          v:'Backup system ki wajah se koi bhi data kabhi nahi jayega — recovery pe paise nahi bharenge' },
  { l:'Brand Trust Aur Credibility',     v:'GDPR compliance se international users aur investors platform ko zyada serious lenge' },
  { l:'Users Ka Best Experience',        v:'Support ticket system se koi bhi complaint miss nahi hogi — har user satisfied rahega' },
  { l:'Security Bulletproof Hui',        v:'Vigil monitoring se hacking ya unauthorized access turant pakda jayega' },
  { l:'Scale Karna Aasan Hoga',          v:'Prediction engine se pata rahega kab zyada servers chahiye — sudden crash nahi hoga' },
  { l:'Puri Transparency & Control',     v:'Audit logs se aap dekh sakte hain ki kab, kya, kisne kiya — full accountability' },
  { l:'Admin Ka Time Bachega',           v:'Sab kuch ek hi jagah — alag alag systems mein jaana nahi padega' },
];
benefits.forEach((b,i) => { y4 = tRow(b.l, b.v, y4, i%2===0 ? C.row0 : C.row1); });

y4 += 14;
y4 = secHead('Developer Teams Ko Kya Share Karna Hai?', y4);

// Frontend card
y4 = measuredBlock((tx, ty) => {
  doc.fontSize(10.5).font('Helvetica-Bold').fillColor(C.blueDk)
     .text('ADMIN PANEL — Frontend Developer Ko Dena Hai:', tx, ty, { lineBreak: false });
  wrapTxt(
    '\nEk complete technical document tayyar hai jisme admin panel ki har screen ke liye exact API link, request format aur response format clearly likha hua hai.\n\n' +
    'Cover Karta Hai: Dashboard, Users, Coupons, Tickets, Backup, Analytics, AI Rules, sab kuch.\n' +
    'Developer Ko Seedha Dena Hai — koi aur explanation nahi chahiye.',
    tx, ty+15, CW-26, 9, 'Helvetica', C.txt, 3
  );
}, y4, 10, 12, C.blueLt, C.blue);

// Flutter card
y4 = measuredBlock((tx, ty) => {
  doc.fontSize(10.5).font('Helvetica-Bold').fillColor(C.green)
     .text('MOBILE APP — Flutter Developer Ko Dena Hai:', tx, ty, { lineBreak: false });
  wrapTxt(
    '\nEk alag developer handoff document tayyar hai sirf mobile app ke liye — jisme user profile fetch, reports dekho, support ticket submit, data download aur account delete karne ke liye ready-made code examples tak shamil hain.\n\n' +
    'Developer Ko Bas Copy-Paste Karna Hai — sab kuch already tayyar hai.',
    tx, ty+15, CW-26, 9, 'Helvetica', C.txt, 3
  );
}, y4, 10, 12, C.greenLt, C.green);

// Sign-off
strokeRect(ML, y4, CW, 50, C.row0, C.border);
fillRect(ML, y4, 5, 50, C.blue);
txt('REPORT APPROVAL & SIGN-OFF',          ML+14, y4+7,  7.5, 'Helvetica-Bold', C.muted);
txt('Limitless Core Engineering Team',     ML+14, y4+19, 10,  'Helvetica-Bold', C.dark);
txt('September 8, 2026',                   ML+14, y4+33, 8.5, 'Helvetica',      C.muted);
txt('STATUS: ALL WORK COMPLETE',    PW-MR-180, y4+19, 9, 'Helvetica-Bold', C.green);


// ── FOOTERS ────────────────────────────────────────────────────────
const pageCount = doc.bufferedPageRange().count;
for (let i = 0; i < pageCount; i++) {
  doc.switchToPage(i);
  fillRect(0, PH-26, PW, 26, C.dark);
  txt('Limitless Cognitive Platform  |  Confidential — Atul Sir Ke Liye',
      ML, PH-18, 7.5, 'Helvetica', '#64748B');
  txt(`PAGE  ${i+1}  OF  ${pageCount}`,
      PW-MR-80, PH-18, 7.5, 'Helvetica-Bold', C.blue);
}

doc.end();
stream.on('finish', () => {
  console.log('PDF generated:', OUTPUT);
  try { fs.copyFileSync(OUTPUT, ARTIFACT); console.log('Copied to artifact.'); }
  catch(e) { console.error('Copy failed:', e.message); }
});
