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

function issueToken(email, remember, isAdmin = false) {
  return jwt.sign(
    { email, is_admin: isAdmin },
    process.env.JWT_SECRET,
    { expiresIn: remember ? '30d' : '8h' }
  );
}

module.exports = router;
