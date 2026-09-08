/**
 * Backend email via SMTP (Nodemailer).
 *
 * Configured with SMTP_HOST / SMTP_USER / SMTP_PASS etc. When not configured,
 * every send is a silent no-op and register/enquiry flows keep working —
 * email is never a hard dependency.
 *
 * The welcome email follows the format specified by Limitless management:
 * subject "Welcome <Name> | Limitless World", brand story, plan, credentials,
 * first-login reset note, confidentiality warning, and company footer.
 */

import nodemailer from 'nodemailer';
import { config, features } from '../config.js';

const COMPANY = 'Limitless World';
const SUPPORT_EMAIL = 'support@limitlessworld.net';
const FEEDBACK_URL = 'https://limitlessworld.net/contact';

const BRAND_STORY_1 =
  'Limitless was born from a simple belief — everyone deserves the chance to understand their brain and improve their life.';
const BRAND_STORY_2 =
  'For too long, cognitive health was treated as an afterthought. When people experienced brain fog, memory lapses, or chronic stress, the tools to understand these changes were often expensive, clinical, and inaccessible to the general public. We knew there had to be a better way.';

const CONFIDENTIALITY =
  `Confidentiality & Security Warning: This email is confidential and intended solely for the recipient. ` +
  `Be advised that ${COMPANY} staff will never ask for your account password. ` +
  `If you are not the intended recipient, please delete this message.`;

const SOCIAL_PLATFORM_LINKS = [
  { label: 'Instagram', url: 'https://www.instagram.com/limitlessnet42026/', color: '#E1306C' },
  { label: 'YouTube', url: 'https://www.youtube.com/@limitlessworld-b2s', color: '#FF0000' },
  { label: 'X', url: 'https://x.com/home', color: '#0F172A' },
];
const APP_STORE_URL = 'https://play.google.com/store/apps/details?id=com.app.limitless.app';
// Google's own officially-hosted badge asset — meant for exactly this (linking
// out to a Play Store listing), so it's safe to embed directly rather than
// hosting a copy ourselves.
const GOOGLE_PLAY_BADGE_URL = 'https://play.google.com/intl/en_us/badges/static/images/badges/en_badge_web_generic.png';

const SOCIAL_TEXT = [
  'Stay connected:',
  ...SOCIAL_PLATFORM_LINKS.map((s) => `${s.label} — ${s.url}`),
  `Get the App — ${APP_STORE_URL}`,
].join('\n');

let transporter = null;
if (features.email) {
  transporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: { user: config.smtp.user, pass: config.smtp.pass },
  });
}

export const sendEmail = async (options) => {
  if (!transporter) {
    console.warn('[email] SMTP not configured — skipped:', options.subject);
    return { sent: false, reason: 'not_configured' };
  }
  try {
    await transporter.sendMail({
      from: `"${COMPANY}" <${config.smtp.from}>`,
      ...options,
    });
    console.log(`[email] sent "${options.subject}" to ${options.to}`);
    return { sent: true };
  } catch (err) {
    console.warn('[email] send failed (non-fatal):', err.message);
    return { sent: false, reason: err.message };
  }
};
const send = sendEmail;

const planLabel = (paymentStatus) => {
  switch (paymentStatus) {
    case 'paid':
      return 'Premium';
    case 'demo':
    case 'trial':
      return 'Demo';
    default:
      return 'Free';
  }
};

/** Shared brand header — gradient with a solid-color fallback for Outlook
 * desktop, which ignores CSS gradients entirely and just uses background-color. */
const brandHeaderHtml = (subtitle) => `
  <div style="background-color:#3B82F6;background-image:linear-gradient(135deg,#3B82F6 0%,#6366F1 100%);padding:32px 32px 28px">
    <h1 style="color:#FFFFFF;font-size:24px;letter-spacing:1px;margin:0;font-weight:800">LIMITLESS</h1>
    ${subtitle ? `<p style="color:#DBEAFE;font-size:13px;margin:6px 0 0">${subtitle}</p>` : ''}
  </div>`;

const footerHtml = `
  <hr style="border:none;border-top:1px solid #E2E8F0;margin:28px 0 20px"/>
  <p style="color:#94A3B8;font-size:12px;line-height:1.6;margin:0 0 16px">${CONFIDENTIALITY}</p>
  <p style="color:#475569;font-size:13px;line-height:1.9;margin:0 0 20px">
    <strong>Company Name:</strong> ${COMPANY}<br/>
    <strong>Support Email:</strong> <a href="mailto:${SUPPORT_EMAIL}" style="color:#3B82F6;text-decoration:none">${SUPPORT_EMAIL}</a><br/>
    <strong>Feedback:</strong> <a href="${FEEDBACK_URL}" style="color:#3B82F6;text-decoration:none">${FEEDBACK_URL}</a>
  </p>
  <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;padding:20px;text-align:center">
    <p style="color:#94A3B8;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;margin:0 0 12px">Stay Connected</p>
    <p style="margin:0 0 16px">
      ${SOCIAL_PLATFORM_LINKS.map((s) => `<a href="${s.url}" style="color:${s.color};text-decoration:none;font-size:13px;font-weight:700;margin:0 10px">${s.label}</a>`).join('<span style="color:#CBD5E1">•</span>')}
    </p>
    <a href="${APP_STORE_URL}" style="display:inline-block;line-height:0"><img src="${GOOGLE_PLAY_BADGE_URL}" alt="Get it on Google Play" height="46" style="height:46px;width:auto;border:0"/></a>
  </div>`;

/**
 * Welcome / credentials email sent right after registration.
 * Subject: "Welcome <Name> | Limitless World"
 * When tempPassword is falsy (the user chose their own password at
 * registration), the password row/notice is omitted — a user's own
 * password is never echoed back over email.
 */
export const sendCredentialsEmail = ({ name, email, tempPassword, paymentStatus = 'pending' }) => {
  const firstName = (name || '').trim().split(/\s+/)[0] || 'there';
  const plan = planLabel(paymentStatus);

  const passwordRow = tempPassword
    ? `
          <tr>
            <td style="padding:8px;color:#64748B;font-size:13px">Password</td>
            <td style="padding:8px;color:#0F172A;font-size:14px"><strong style="font-family:Consolas,monospace;letter-spacing:1px">${tempPassword}</strong></td>
          </tr>`
    : '';

  const resetNotice = tempPassword
    ? `
        <p style="color:#B45309;background:#FEF3C7;border:1px solid #FDE68A;border-radius:8px;padding:10px 14px;font-size:13px;margin:0 0 8px">
          For first time login you have to reset your password.
        </p>`
    : '';

  const html = `
  <div style="background:#F8FAFC;padding:24px 0">
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;background:#FFFFFF;border:1px solid #E2E8F0;border-radius:12px;overflow:hidden;box-shadow:0 4px 16px rgba(15,23,42,0.06)">
      ${brandHeaderHtml('Cognitive Wellness Platform')}
      <div style="padding:28px 32px">
        <h2 style="color:#0F172A;font-size:19px;margin:0 0 16px">Welcome ${firstName}!</h2>
        <p style="color:#475569;font-size:14px;line-height:1.7;margin:0 0 12px">${BRAND_STORY_1}</p>
        <p style="color:#475569;font-size:14px;line-height:1.7;margin:0 0 20px">${BRAND_STORY_2}</p>

        <table style="width:100%;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;border-collapse:separate;padding:6px 10px;margin:0 0 16px">
          <tr>
            <td style="padding:8px;color:#64748B;font-size:13px;width:120px">Your Plan</td>
            <td style="padding:8px;color:#0F172A;font-size:13px"><strong>${plan}</strong></td>
          </tr>
          <tr>
            <td style="padding:8px;color:#64748B;font-size:13px">Username</td>
            <td style="padding:8px;color:#0F172A;font-size:13px"><strong>${email}</strong></td>
          </tr>${passwordRow}
        </table>
${resetNotice}
        ${
          config.frontendUrl
            ? `<p style="margin:20px 0 8px"><a href="${config.frontendUrl}" style="display:inline-block;background:#3B82F6;color:#FFFFFF;padding:12px 28px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:bold">Log in to Limitless →</a></p>`
            : ''
        }
        ${footerHtml}
      </div>
    </div>
  </div>`;

  const text = [
    `Welcome ${firstName}!`,
    '',
    BRAND_STORY_1,
    '',
    BRAND_STORY_2,
    '',
    `Your Plan : ${plan}`,
    `Username : ${email}`,
    ...(tempPassword ? [`Password : ${tempPassword}`] : []),
    '',
    ...(tempPassword ? ['For first time login you have to reset your password.', ''] : []),
    CONFIDENTIALITY,
    '',
    `Company Name : ${COMPANY}`,
    `Support Email : ${SUPPORT_EMAIL}`,
    `Feedback : ${FEEDBACK_URL}`,
    SOCIAL_TEXT,
  ].join('\n');

  return send({
    to: email,
    subject: `Welcome ${firstName} | ${COMPANY}`,
    html,
    text,
  });
};

/** Report-ready email with the PDF download link. */
export const sendPdfEmail = ({ name, email, pdfUrl }) => {
  const firstName = (name || '').trim().split(/\s+/)[0] || 'there';
  return send({
    to: email,
    subject: `Your Cognitive Wellness Report is Ready | ${COMPANY}`,
    html: `
    <div style="background:#F8FAFC;padding:24px 0">
      <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;background:#FFFFFF;border:1px solid #E2E8F0;border-radius:12px;overflow:hidden;box-shadow:0 4px 16px rgba(15,23,42,0.06)">
        ${brandHeaderHtml()}
        <div style="padding:28px 32px">
          <h2 style="color:#0F172A;font-size:19px;margin:0 0 12px">Your report is ready, ${firstName}!</h2>
          <p style="color:#475569;font-size:14px;line-height:1.7">Your personalized cognitive wellness report has been generated and is ready to download.</p>
          <p style="margin:20px 0"><a href="${pdfUrl}" style="display:inline-block;background:#3B82F6;color:#FFFFFF;padding:12px 28px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:bold">Download your report</a></p>
          ${footerHtml}
        </div>
      </div>
    </div>`,
    text: `Your report is ready, ${firstName}!\n\nDownload: ${pdfUrl}\n\n${CONFIDENTIALITY}\n\nCompany Name : ${COMPANY}\nSupport Email : ${SUPPORT_EMAIL}\nFeedback : ${FEEDBACK_URL}\n${SOCIAL_TEXT}`,
  });
};

/** Email verification code (OTP) sent before registration. */
export const sendOtpEmail = ({ email, name, otp }) => {
  const firstName = (name || '').trim().split(/\s+/)[0] || 'there';
  return send({
    to: email,
    subject: `${otp} is your Limitless verification code`,
    html: `
    <div style="background:#F8FAFC;padding:24px 0">
      <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;background:#FFFFFF;border:1px solid #E2E8F0;border-radius:12px;overflow:hidden;box-shadow:0 4px 16px rgba(15,23,42,0.06)">
        ${brandHeaderHtml('Email Verification')}
        <div style="padding:28px 32px">
          <h2 style="color:#0F172A;font-size:19px;margin:0 0 12px">Hi ${firstName},</h2>
          <p style="color:#475569;font-size:14px;line-height:1.7;margin:0 0 20px">
            Use this code to verify your email address and start your cognitive assessment:
          </p>
          <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;padding:18px;text-align:center;margin:0 0 20px">
            <span style="font-family:Consolas,monospace;font-size:34px;font-weight:bold;letter-spacing:10px;color:#0F172A">${otp}</span>
          </div>
          <p style="color:#94A3B8;font-size:13px;margin:0 0 8px">This code expires in <strong>10 minutes</strong>.</p>
          <p style="color:#94A3B8;font-size:13px;margin:0">If you didn't request this, you can safely ignore this email.</p>
          ${footerHtml}
        </div>
      </div>
    </div>`,
    text: `Hi ${firstName},\n\nYour Limitless verification code is: ${otp}\n\nIt expires in 10 minutes. If you didn't request this, ignore this email.\n\n${CONFIDENTIALITY}\n\nCompany Name : ${COMPANY}\nSupport Email : ${SUPPORT_EMAIL}\nFeedback : ${FEEDBACK_URL}\n${SOCIAL_TEXT}`,
  });
};

/** Password-reset verification code. */
export const sendPasswordResetEmail = ({ email, name, otp }) => {
  const firstName = (name || '').trim().split(/\s+/)[0] || 'there';
  return send({
    to: email,
    subject: `${otp} is your Limitless password reset code`,
    html: `
    <div style="background:#F8FAFC;padding:24px 0">
      <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;background:#FFFFFF;border:1px solid #E2E8F0;border-radius:12px;overflow:hidden;box-shadow:0 4px 16px rgba(15,23,42,0.06)">
        ${brandHeaderHtml('Password Reset')}
        <div style="padding:28px 32px">
          <h2 style="color:#0F172A;font-size:19px;margin:0 0 12px">Hi ${firstName},</h2>
          <p style="color:#475569;font-size:14px;line-height:1.7;margin:0 0 20px">
            Use this code to reset your Limitless account password:
          </p>
          <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;padding:18px;text-align:center;margin:0 0 20px">
            <span style="font-family:Consolas,monospace;font-size:34px;font-weight:bold;letter-spacing:10px;color:#0F172A">${otp}</span>
          </div>
          <p style="color:#94A3B8;font-size:13px;margin:0 0 8px">This code expires in <strong>10 minutes</strong>.</p>
          <p style="color:#94A3B8;font-size:13px;margin:0">If you didn't request this, you can safely ignore this email — your password will not change.</p>
          ${footerHtml}
        </div>
      </div>
    </div>`,
    text: `Hi ${firstName},\n\nYour Limitless password reset code is: ${otp}\n\nIt expires in 10 minutes. If you didn't request this, ignore this email — your password will not change.\n\n${CONFIDENTIALITY}\n\nCompany Name : ${COMPANY}\nSupport Email : ${SUPPORT_EMAIL}\nFeedback : ${FEEDBACK_URL}\n${SOCIAL_TEXT}`,
  });
};

/** Internal notification to the admin inbox on new registration. */
export const sendAdminNotification = ({ name, email, age, gender }) => {
  if (!config.adminNotifyEmail) return Promise.resolve({ sent: false, reason: 'not_configured' });
  return send({
    to: config.adminNotifyEmail,
    subject: `New Registration: ${name || email} | ${COMPANY}`,
    html: `
      <div style="font-family:Arial,sans-serif">
        <h3>New user registered on Limitless</h3>
        <p><strong>Name:</strong> ${name || '—'}<br/>
        <strong>Email:</strong> ${email}<br/>
        <strong>Age:</strong> ${age ?? '—'}<br/>
        <strong>Gender:</strong> ${gender ?? '—'}</p>
      </div>`,
  });
};

/** Internal notification to the admin inbox on new enquiry/feedback. */
export const sendEnquiryNotification = ({ name, email, message }) => {
  if (!config.adminNotifyEmail) return Promise.resolve({ sent: false, reason: 'not_configured' });
  return send({
    to: config.adminNotifyEmail,
    replyTo: email,
    subject: `New Enquiry from ${name || email} | ${COMPANY}`,
    html: `
      <div style="font-family:Arial,sans-serif">
        <h3>New enquiry received</h3>
        <p><strong>Name:</strong> ${name || '—'}<br/>
        <strong>Email:</strong> ${email}</p>
        <p style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;padding:12px">${(message || '').replace(/</g, '&lt;')}</p>
      </div>`,
  });
};
