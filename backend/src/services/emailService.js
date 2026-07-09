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

let transporter = null;
if (features.email) {
  transporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: { user: config.smtp.user, pass: config.smtp.pass },
  });
}

const send = async (options) => {
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

const footerHtml = `
  <hr style="border:none;border-top:1px solid #E2E8F0;margin:24px 0"/>
  <p style="color:#94A3B8;font-size:12px;line-height:1.6;margin:0 0 12px">${CONFIDENTIALITY}</p>
  <p style="color:#475569;font-size:13px;line-height:1.8;margin:0">
    <strong>Company Name:</strong> ${COMPANY}<br/>
    <strong>Support Email:</strong> <a href="mailto:${SUPPORT_EMAIL}" style="color:#3B82F6">${SUPPORT_EMAIL}</a><br/>
    <strong>Feedback:</strong> <a href="${FEEDBACK_URL}" style="color:#3B82F6">${FEEDBACK_URL}</a>
  </p>`;

/**
 * Welcome / credentials email sent right after registration.
 * Subject: "Welcome <Name> | Limitless World"
 */
export const sendCredentialsEmail = ({ name, email, tempPassword, paymentStatus = 'pending' }) => {
  const firstName = (name || '').trim().split(/\s+/)[0] || 'there';
  const plan = planLabel(paymentStatus);

  const html = `
  <div style="background:#F8FAFC;padding:24px 0">
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;background:#FFFFFF;border:1px solid #E2E8F0;border-radius:12px;overflow:hidden">
      <div style="background:#3B82F6;padding:28px 32px">
        <h1 style="color:#FFFFFF;font-size:22px;margin:0">LIMITLESS</h1>
        <p style="color:#DBEAFE;font-size:13px;margin:6px 0 0">Cognitive Wellness Platform</p>
      </div>
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
          </tr>
          <tr>
            <td style="padding:8px;color:#64748B;font-size:13px">Password</td>
            <td style="padding:8px;color:#0F172A;font-size:14px"><strong style="font-family:Consolas,monospace;letter-spacing:1px">${tempPassword}</strong></td>
          </tr>
        </table>

        <p style="color:#B45309;background:#FEF3C7;border:1px solid #FDE68A;border-radius:8px;padding:10px 14px;font-size:13px;margin:0 0 8px">
          For first time login you have to reset your password.
        </p>
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
    `Password : ${tempPassword}`,
    '',
    'For first time login you have to reset your password.',
    '',
    CONFIDENTIALITY,
    '',
    `Company Name : ${COMPANY}`,
    `Support Email : ${SUPPORT_EMAIL}`,
    `Feedback : ${FEEDBACK_URL}`,
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
      <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;background:#FFFFFF;border:1px solid #E2E8F0;border-radius:12px;overflow:hidden">
        <div style="background:#3B82F6;padding:28px 32px">
          <h1 style="color:#FFFFFF;font-size:22px;margin:0">LIMITLESS</h1>
        </div>
        <div style="padding:28px 32px">
          <h2 style="color:#0F172A;font-size:19px;margin:0 0 12px">Your report is ready, ${firstName}!</h2>
          <p style="color:#475569;font-size:14px;line-height:1.7">Your personalized cognitive wellness report has been generated and is ready to download.</p>
          <p style="margin:20px 0"><a href="${pdfUrl}" style="display:inline-block;background:#3B82F6;color:#FFFFFF;padding:12px 28px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:bold">Download your report</a></p>
          ${footerHtml}
        </div>
      </div>
    </div>`,
    text: `Your report is ready, ${firstName}!\n\nDownload: ${pdfUrl}\n\n${CONFIDENTIALITY}\n\nCompany Name : ${COMPANY}\nSupport Email : ${SUPPORT_EMAIL}\nFeedback : ${FEEDBACK_URL}`,
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
