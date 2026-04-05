const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
const supabase = require('../services/supabase');

const router = express.Router();

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many attempts. Please wait 15 minutes.' }
});

// Stricter limiter for PIN verification to prevent brute force
const pinLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Too many PIN attempts. Please wait 15 minutes.' }
});

// ── POST /api/auth/check ──────────────────────────────────────────────────────
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

  const status = data?.password_hash ? 'ready' : 'setup_required';
  res.json({ status });
});

// ── POST /api/auth/setup ──────────────────────────────────────────────────────
// Open registration — create account with password + recovery PIN
router.post('/setup', limiter, async (req, res) => {
  const { email, password, pin, remember } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }
  if (!pin || !/^\d{6}$/.test(pin)) {
    return res.status(400).json({ error: 'A 6-digit recovery PIN is required.' });
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

  const passwordHash = await bcrypt.hash(password, 12);
  const pinHash = await bcrypt.hash(pin, 10);

  let userData;

  if (existing) {
    const { data, error } = await supabase
      .from('users')
      .update({ password_hash: passwordHash, pin_hash: pinHash })
      .eq('email', normalised)
      .select('is_admin, powerups_used, is_subscribed')
      .single();
    if (error) return res.status(500).json({ error: 'Failed to save password.' });
    userData = data;
  } else {
    const { data, error } = await supabase
      .from('users')
      .insert({ email: normalised, password_hash: passwordHash, pin_hash: pinHash })
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

// ── POST /api/auth/verify-pin ────────────────────────────────────────────────
// Verifies the 6-digit recovery PIN and returns a short-lived reset JWT
router.post('/verify-pin', pinLimiter, async (req, res) => {
  const { email, pin } = req.body;
  if (!email || !pin) {
    return res.status(400).json({ error: 'Email and PIN are required.' });
  }

  const normalised = email.trim().toLowerCase();

  const { data } = await supabase
    .from('users')
    .select('pin_hash')
    .eq('email', normalised)
    .maybeSingle();

  if (!data || !data.pin_hash) {
    return res.status(400).json({ error: 'No recovery PIN set for this account.' });
  }

  const match = await bcrypt.compare(pin.trim(), data.pin_hash);
  if (!match) {
    return res.status(401).json({ error: 'Incorrect PIN. Please try again.' });
  }

  // Issue short-lived reset-only JWT (15 min)
  const resetToken = jwt.sign(
    { email: normalised, purpose: 'reset' },
    process.env.JWT_SECRET,
    { expiresIn: '15m' }
  );

  res.json({ reset_token: resetToken });
});

// ── POST /api/auth/reset-password ────────────────────────────────────────────
// Sets a new password using the reset JWT from verify-pin
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

// ── GET /api/auth/status ─────────────────────────────────────────────────────
// Returns the current user status (subscription, powerups) from the database
router.get('/status', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Not authenticated.' });
  }

  let payload;
  try {
    payload = jwt.verify(authHeader.slice(7), process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Token expired.' });
  }

  const { data } = await supabase
    .from('users')
    .select('is_admin, powerups_used, is_subscribed, subscription_expires_at')
    .eq('email', payload.email)
    .maybeSingle();

  if (!data) return res.status(404).json({ error: 'User not found.' });

  const subscribed = data.is_subscribed &&
    (!data.subscription_expires_at || new Date(data.subscription_expires_at) > new Date());

  res.json({
    email: payload.email,
    is_admin: data.is_admin || false,
    powerups_used: data.powerups_used || 0,
    is_subscribed: subscribed
  });
});

function issueToken(email, remember, isAdmin = false) {
  return jwt.sign(
    { email, is_admin: isAdmin },
    process.env.JWT_SECRET,
    { expiresIn: remember ? '30d' : '8h' }
  );
}

module.exports = router;
