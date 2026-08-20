const nodemailer = require('nodemailer');

const OTP_EMAIL_COPY = {
  register: {
    subject: 'Verify your GigLedger account',
    heading: 'Verify your account',
    intro: 'Use this code to finish creating your GigLedger account.',
    text: (code) => `Your verification code is ${code}. It expires in 5 minutes.`,
  },
  login: {
    subject: 'Your GigLedger login code',
    heading: 'Your login code',
    intro: 'Use this code to finish logging in to GigLedger.',
    text: (code) => `Your login code is ${code}. It expires in 5 minutes.`,
  },
};

/** Simple branded HTML shell so the OTP code renders as a real card, not a plain string. */
const otpEmailHtml = (heading, intro, code) => `
<!doctype html>
<html>
  <body style="margin:0;padding:0;background-color:#f4f5f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" style="max-width:480px;background:#ffffff;border-radius:8px;overflow:hidden;">
            <tr>
              <td style="background:#1a1a2e;padding:20px 32px;">
                <span style="color:#ffffff;font-size:18px;font-weight:600;">GigLedger</span>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;">
                <h1 style="margin:0 0 8px;font-size:20px;color:#111827;">${heading}</h1>
                <p style="margin:0 0 24px;font-size:14px;color:#4b5563;">${intro}</p>
                <div style="background:#f4f5f7;border-radius:6px;padding:16px;text-align:center;margin-bottom:24px;">
                  <span style="font-size:32px;font-weight:700;letter-spacing:8px;color:#1a1a2e;">${code}</span>
                </div>
                <p style="margin:0;font-size:13px;color:#6b7280;">This code expires in 5 minutes. If you didn't request it, you can safely ignore this email.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px;border-top:1px solid #e5e7eb;">
                <p style="margin:0;font-size:12px;color:#9ca3af;">GigLedger · Smart Income &amp; Tax Companion for Gig Workers</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

/**
 * Sends the raw OTP by email. Without SMTP creds configured (local dev,
 * CI, tests) this just logs the code instead of failing — the login
 * flow stays fully testable with zero real infrastructure. In
 * production that fallback is refused outright: logging a live login
 * code to stdout would be a silent auth bypass for anyone with log access.
 */
const sendOtpEmail = async (toEmail, code, purpose = 'login') => {
  const copy = OTP_EMAIL_COPY[purpose] || OTP_EMAIL_COPY.login;

  if (!process.env.SMTP_HOST) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('SMTP_HOST is not configured — refusing to send OTP in production');
    }
    console.log(`[mailer] OTP (${purpose}) for ${toEmail}: ${code}`);
    return;
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });

  await transporter.sendMail({
    from: `GigLedger <${process.env.SMTP_FROM}>`,
    to: toEmail,
    subject: copy.subject,
    text: copy.text(code),
    html: otpEmailHtml(copy.heading, copy.intro, code),
  });
};

module.exports = { sendOtpEmail };
