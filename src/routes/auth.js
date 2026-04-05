const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const supabase = require('../services/supabase');
const { sendOtpEmail } = require('../services/email');

const router = express.Router();

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many attempts. Please wait 15 minutes.' }
});

// Stricter limiter for password reset to prevent abuse
const resetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  message: { error: 'Too many reset attempts. Please wait an hour.' }
});

// ── POST /api/auth/check ──────────────────────────────────────────────────────
// Anyone can check — returns 'ready' or 'setup_required' (no whitelist)
router.post('/check', limiter, async (req, res) => {
  const { email } = req.body;
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'A valid email address is required.' });
  }

  const normalised = email.trim().toLowerCase();

  const { data } = await supabase
    .from('users')
    .select('password_hash')
    .eq('email', normalised)
    .maybeSingle();

  // User exists with password → ready to login
  // User doesn't exist OR has no password → needs setup
  const status = data?.password_hash ? 'ready' : 'setup_required';
  res.json({ status });
});

// ── POST /api/auth/setup ──────────────────────────────────────────────────────
// Open registration — create account or set password, no whitelist needed
router.post('/setup', limiter, async (req, res) => {
  const { email, password, remember } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }

  const normalised = email.trim().toLowerCase();

  const { data: existing } = await supabase
    .from('users')
    .select('email, password_hash, is_admin, powerups_used, is_subscribed')
    .eq('email', normalised)
    .maybeSingle();

  if (existing?.password_hash) {
    return res.status(409).json({ error: 'Password already set. Please sign in.' });
  }

  const hash = await bcrypt.hash(password, 12);

  let userData;

  if (existing) {
    // User exists but no password yet — set it
    const { data, error } = await supabase
      .from('users')
      .update({ password_hash: hash })
      .eq('email', normalised)
      .select('is_admin, powerups_used, is_subscribed')
      .single();
    if (error) return res.status(500).json({ error: 'Failed to save password.' });
    userData = data;
  } else {
    // Brand new user — create account
    const { data, error } = await supabase
      .from('users')
      .insert({ email: normalised, password_hash: hash })
      .select('is_admin, powerups_used, is_subscribed')
      .single();
    if (error) return res.status(500).json({ error: 'Failed to create account.' });
    userData = data;
  }

  const token = issueToken(normalised, remember, userData.is_admin);
  res.json({
    token,
    email: normalised,
    is_admin: userData.is_admin || false,
    powerups_used: userData.powerups_used || 0,
    is_subscribed: userData.is_subscribed || false
  });
});

// ── POST /api/auth/login ──────────────────────────────────────────────────────
router.post('/login', limiter, async (req, res) => {
  const { email, password, remember } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const normalised = email.trim().toLowerCase();

  const { data, error } = await supabase
    .from('users')
    .select('email, password_hash, is_admin, powerups_used, is_subscribed, subscription_expires_at')
    .eq('email', normalised)
    .maybeSingle();

  if (error || !data) {
    return res.status(404).json({ error: 'No account found for this email. Please sign up first.' });
  }
  if (!data.password_hash) {
    return res.status(400).json({ error: 'No password set yet. Please create your account first.' });
  }

  const match = await bcrypt.compare(password, data.password_hash);
  if (!match) {
    return res.status(401).json({ error: 'Incorrect password. Please try again.' });
  }

  const subscribed = data.is_subscribed &&
    (!data.subscription_expires_at || new Date(data.subscription_expires_at) > new Date());

  const token = issueToken(normalised, remember, data.is_admin);
  res.json({
    token,
    email: normalised,
    is_admin: data.is_admin || false,
    powerups_used: data.powerups_used || 0,
    is_subscribed: subscribed
  });
});

// ── POST /api/auth/forgot-password ───────────────────────────────────────────
// Generates a 6-digit OTP, stores SHA-256 hash + expiry, sends email
router.post('/forgot-password', resetLimiter, async (req, res) => {
  const { email } = req.body;
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'A valid email address is required.' });
  }

  const normalised = email.trim().toLowerCase();

  const { data } = await supabase
    .from('users')
    .select('email, password_hash')
    .eq('email', normalised)
    .maybeSingle();

  // Always return success — don't reveal whether an email is registered
  if (!data || !data.password_hash) {
    return res.json({ success: true });
  }

  // Generate 6-digit OTP
  const otp = String(Math.floor(100000 + Math.random() * 900000));
  const tokenHash = crypto.createHash('sha256').update(otp).digest('hex');
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

  const { error: updateError } = await supabase
    .from('users')
    .update({ reset_token: tokenHash, reset_token_expires_at: expiresAt.toISOString() })
    .eq('email', normalised);

  if (updateError) {
    console.error('Reset token save error:', updateError);
    return res.status(500).json({ error: 'Failed to process request. Please try again.' });
  }

  try {
    await sendOtpEmail(normalised, otp);
  } catch (e) {
    console.error('Email send error:', e);
    return res.status(500).json({ error: 'Failed to send email. Please try again.' });
  }

  res.json({ success: true });
});

// ── POST /api/auth/verify-reset-otp ─────────────────────────────────────────
// Verifies OTP and returns a short-lived reset JWT
router.post('/verify-reset-otp', resetLimiter, async (req, res) => {
  const { email, otp } = req.body;
  if (!email || !otp) {
    return res.status(400).json({ error: 'Email and code are required.' });
  }

  const normalised = email.trim().toLowerCase();

  const { data } = await supabase
    .from('users')
    .select('reset_token, reset_token_expires_at')
    .eq('email', normalised)
    .maybeSingle();

  if (!data || !data.reset_token) {
    return res.status(400).json({ error: 'No reset request found. Please request a new code.' });
  }

  if (new Date(data.reset_token_expires_at) < new Date()) {
    return res.status(400).json({ error: 'Code has expired. Please request a new one.' });
  }

  const hash = crypto.createHash('sha256').update(otp.trim()).digest('hex');
  if (hash !== data.reset_token) {
    return res.status(400).json({ error: 'Incorrect code. Please check and try again.' });
  }

  // Clear the used OTP
  await supabase
    .from('users')
    .update({ reset_token: null, reset_token_expires_at: null })
    .eq('email', normalised);

  // Issue short-lived reset-only JWT (15 min)
  const resetToken = jwt.sign(
    { email: normalised, purpose: 'reset' },
    process.env.JWT_SECRET,
    { expiresIn: '15m' }
  );

  res.json({ reset_token: resetToken });
});

// ── POST /api/auth/reset-password ────────────────────────────────────────────
// Sets a new password using the reset JWT
router.post('/reset-password', async (req, res) => {
  const { reset_token, password } = req.body;
  if (!reset_token || !password) {
    return res.status(400).json({ error: 'Reset token and new password are required.' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }

  let payload;
  try {
    payload = jwt.verify(reset_token, process.env.JWT_SECRET);
  } catch {
    return res.status(400).json({ error: 'Reset session expired. Please start over.' });
  }

  if (payload.purpose !== 'reset') {
    return res.status(400).json({ error: 'Invalid reset token.' });
  }

  const hash = await bcrypt.hash(password, 12);

  const { error } = await supabase
    .from('users')
    .update({ password_hash: hash })
    .eq('email', payload.email);

  if (error) {
    return res.status(500).json({ error: 'Failed to update password. Please try again.' });
  }

  res.json({ success: true, email: payload.email });
});

function issueToken(email, remember, isAdmin = false) {
  return jwt.sign(
    { email, is_admin: isAdmin },
    process.env.JWT_SECRET,
    { expiresIn: remember ? '30d' : '8h' }
  );
}

module.exports = router;
