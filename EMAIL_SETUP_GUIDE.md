# Limitless — Email Setup Guide (server-side, same approach as Vigil)

Goal: move Limitless email from **EmailJS (client-side)** to a **server-side transactional
service (Resend)** in the new Node/Express backend — the same pattern recommended for Vigil.

---

## 1. What Limitless sends today (2 emails)

Both are currently sent from the browser via EmailJS (`src/lib/emailService.js`):

| Email | When | Contents |
|---|---|---|
| **Credentials** | After the user finishes the questionnaire / signs up | username (email) + temp password + login link |
| **PDF report** | After the cognitive report PDF is generated | download link to the report |

**Why move off EmailJS:**
- Runs in the browser → template IDs + public key are exposed in client code
- No domain authentication → lands in spam
- Tied to the frontend; the new Node backend should own email

---

## 2. Target setup (mirror of Vigil)

- **Provider:** [Resend](https://resend.com) — free tier 3,000 emails/month, simple Node SDK, great deliverability. (Same service recommended for Vigil; `resend` is already a dependency in the Vigil backend.)
- **Where:** the new **Limitless Node backend** (during the Supabase → Node/Mongo migration)
- **Auth:** SPF + DKIM + DMARC on a domain you own

---

## 3. The domain question (decide this first)

Limitless has **no custom domain yet** — only `limitless.160-153-179-249.sslip.io`.
You **cannot** add SPF/DKIM to an `sslip.io` address (you don't own it). Pick one:

| Option | From address | Deliverability | Setup |
|---|---|---|---|
| **A. Get a Limitless domain** (e.g. `limitless.app`) | `no-reply@limitless.app` | ✅ best, fully branded | buy domain + add DNS |
| **B. Use a subdomain of an owned domain** (e.g. `vigil-1.com`) | `no-reply@limitless.vigil-1.com` | ✅ good | add DNS to existing GoDaddy panel |
| **C. Resend test domain** (dev only) | `onboarding@resend.dev` | ⚠️ works instantly, not branded, dev-only | zero setup |

**Recommendation:** **C for testing right now**, then **A or B for production.**
If you already plan to buy a Limitless domain, go A. If not, B reuses the `vigil-1.com`
GoDaddy account you're already touching for the admin/parent subdomains.

---

## 4. DNS records (once you pick a domain in Option A/B)

Resend gives you the exact values in its dashboard — you add 3 records at the domain's DNS panel:

```
SPF    TXT    send.<domain>     "v=spf1 include:amazonses.com ~all"
DKIM   TXT    resend._domainkey.<domain>   <long key Resend gives you>
DMARC  TXT    _dmarc.<domain>   "v=DMARC1; p=none;"
```

Then in Resend: **Domains → Add Domain → verify.** Takes a few minutes after DNS propagates.

---

## 5. Backend code (drop into the new Limitless Node backend)

### `.env`
```
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxx
EMAIL_FROM=Limitless <no-reply@limitless.app>   # or onboarding@resend.dev for testing
APP_URL=https://limitless.160-153-179-249.sslip.io
```

### `src/lib/email.js`
```js
const { Resend } = require('resend');

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const FROM = process.env.EMAIL_FROM || 'Limitless <onboarding@resend.dev>';

// Core sender — returns { id } on success, null on failure (never throws).
async function sendEmail({ to, subject, html, text }) {
  if (!resend) { console.warn('[Email] RESEND_API_KEY not set — email disabled.'); return null; }
  try {
    const { data, error } = await resend.emails.send({ from: FROM, to, subject, html, text });
    if (error) { console.error('[Email] send failed:', error.message || error); return null; }
    console.log('[Email] sent to', to, '| id:', data.id);
    return data;
  } catch (err) {
    console.error('[Email] send threw:', err.message);
    return null;
  }
}

// 1) Login credentials after questionnaire/signup
async function sendCredentialsEmail({ name, email, tempPassword }) {
  const loginUrl = process.env.APP_URL || '';
  const html = `
  <div style="font-family:Segoe UI,Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;">
    <h2 style="color:#0F172A;margin:0 0 8px;">Welcome to Limitless${name ? ', ' + name : ''}!</h2>
    <p style="color:#374151;font-size:14px;">Your account is ready. Use these credentials to log in and view your cognitive report.</p>
    <div style="background:#F1F5F9;border-radius:10px;padding:16px;margin:16px 0;">
      <p style="margin:0 0 8px;color:#64748B;font-size:13px;">Username</p>
      <p style="margin:0 0 14px;font-weight:700;color:#0F172A;">${email}</p>
      <p style="margin:0 0 8px;color:#64748B;font-size:13px;">Temporary Password</p>
      <p style="margin:0;font-weight:700;letter-spacing:2px;color:#6366F1;font-family:monospace;">${tempPassword}</p>
    </div>
    <a href="${loginUrl}" style="display:inline-block;background:#F59E0B;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:700;">Log in</a>
    <p style="color:#EF4444;font-size:12px;margin:16px 0 0;">You'll be asked to reset your password on first login.</p>
  </div>`;
  return sendEmail({
    to: email,
    subject: 'Your Limitless login credentials',
    text: `Welcome to Limitless! Username: ${email} · Temp password: ${tempPassword} · Login: ${loginUrl}`,
    html,
  });
}

// 2) PDF report link after report generation
async function sendPdfEmail({ name, email, pdfUrl }) {
  const html = `
  <div style="font-family:Segoe UI,Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;">
    <h2 style="color:#0F172A;margin:0 0 8px;">Your report is ready${name ? ', ' + name : ''}</h2>
    <p style="color:#374151;font-size:14px;">Your personalized cognitive wellness report has been generated.</p>
    <a href="${pdfUrl}" style="display:inline-block;background:#2563EB;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:700;margin-top:12px;">Download my report (PDF)</a>
    <p style="color:#9CA3AF;font-size:12px;margin:16px 0 0;">— Team Limitless</p>
  </div>`;
  return sendEmail({
    to: email,
    subject: 'Your Limitless cognitive report is ready',
    text: `Your Limitless report is ready. Download: ${pdfUrl}`,
    html,
  });
}

module.exports = { sendEmail, sendCredentialsEmail, sendPdfEmail };
```

### Usage in controllers
```js
const { sendCredentialsEmail, sendPdfEmail } = require('../lib/email');

// after creating the user with a temp password:
await sendCredentialsEmail({ name, email, tempPassword });

// after generating + uploading the PDF:
await sendPdfEmail({ name, email, pdfUrl });
```

---

## 6. If OTP is needed later (like Vigil)

Same `sendEmail()` core — just add:
```js
async function sendOtpEmail({ email, otp }) {
  return sendEmail({
    to: email,
    subject: `Limitless code: ${otp}`,
    text: `Your Limitless code is ${otp} (valid 15 min).`,
    html: `<div style="font-family:sans-serif;text-align:center;padding:24px;">
      <p>Your verification code:</p>
      <div style="font-size:32px;font-weight:800;letter-spacing:8px;color:#2563EB;">${otp}</div>
      <p style="color:#9CA3AF;font-size:12px;">Valid for 15 minutes.</p></div>`,
  });
}
```

---

## 7. Migration checklist

- [ ] Pick a domain (Option A/B) or use `onboarding@resend.dev` for now
- [ ] Create a Resend account → get `RESEND_API_KEY`
- [ ] (Prod) Add SPF/DKIM/DMARC DNS records + verify domain in Resend
- [ ] Add `RESEND_API_KEY`, `EMAIL_FROM`, `APP_URL` to the Node backend `.env`
- [ ] Add `src/lib/email.js` (above) to the new backend
- [ ] Call `sendCredentialsEmail` / `sendPdfEmail` from the Node controllers
- [ ] **Remove EmailJS** from the React frontend (`src/lib/emailService.js` + the `@emailjs/browser` calls) — email now happens server-side
- [ ] Test: sign up → credentials email arrives; generate report → PDF email arrives

---

**Key point:** Limitless is NOT self-hosting a mail server, and shouldn't — same as Vigil.
It's just switching the *relay* from client-side EmailJS to server-side Resend, with domain
authentication for inbox delivery. The only real prerequisite is a domain you can add DNS to.
