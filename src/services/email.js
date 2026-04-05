const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'patvisto@gmail.com',
    pass: 'ajrv kymr zjxy ruju'
  }
});

async function sendOtpEmail(to, otp) {
  await transporter.sendMail({
    from: '"Power Up Prompts" <patvisto@gmail.com>',
    to,
    subject: 'Your Password Reset Code',
    html: `
      <div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#f9fafb;border-radius:12px">
        <div style="text-align:center;margin-bottom:24px">
          <div style="display:inline-block;background:#16a34a;border-radius:50%;width:48px;height:48px;line-height:48px;font-size:24px;color:#fff">⚡</div>
          <h2 style="color:#111827;margin:12px 0 4px;font-size:20px">Password Reset</h2>
          <p style="color:#6b7280;font-size:14px;margin:0">Power Up Prompts</p>
        </div>
        <div style="background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:24px;margin-bottom:20px">
          <p style="color:#374151;font-size:14px;margin:0 0 20px">
            Use this code to reset your password. It expires in <strong>15 minutes</strong>.
          </p>
          <div style="background:#f3f4f6;border-radius:8px;padding:20px;text-align:center">
            <span style="font-size:36px;font-weight:700;letter-spacing:14px;color:#111827;font-family:'Courier New',monospace">${otp}</span>
          </div>
        </div>
        <p style="color:#9ca3af;font-size:12px;text-align:center;margin:0">
          If you didn't request a password reset, you can safely ignore this email.
        </p>
      </div>
    `
  });
}

module.exports = { sendOtpEmail };
