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
// Step 1: check if email is whitelisted and whether a password has been set.
// Returns status: 'no_access' | 'setup_required' | 'ready'
router.post('/check', limiter, async (req, res) => {
  const { email } = req.body;
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'A valid email address is required.' });
  }

  const normalised = email.trim().toLowerCase();

  const { data, error } = await supabase
    .from('whitelisted_emails')
    .select('email, password_hash')
    .eq('email', normalised)
    .maybeSingle();

  if (error) {
    console.error(error);
    return res.status(500).json({ error: 'Internal error. Please try again.' });
  }

  if (!data) {
    return res.status(403).json({ error: 'This email is not authorised. Contact the administrator to request access.' });
  }

  const status = data.password_hash ? 'ready' : 'setup_required';
  res.json({ status });
});

// ── POST /api/auth/setup ──────────────────────────────────────────────────────
// First-time password creation. Only works if no password is set yet.
router.post('/setup', limiter, async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }

  const normalised = email.trim().toLowerCase();

  const { data, error } = await supabase
    .from('whitelisted_emails')
    .select('email, password_hash')
    .eq('email', normalised)
    .maybeSingle();

  if (error || !data) {
    return res.status(403).json({ error: 'Email not authorised.' });
  }
  if (data.password_hash) {
    return res.status(409).json({ error: 'Password already set. Please sign in.' });
  }

  const hash = await bcrypt.hash(password, 12);

  const { error: updateErr } = await supabase
    .from('whitelisted_emails')
    .update({ password_hash: hash })
    .eq('email', normalised);

  if (updateErr) {
    console.error(updateErr);
    return res.status(500).json({ error: 'Failed to save password. Please try again.' });
  }

  const token = issueToken(normalised, req.body.remember);
  res.json({ token, email: normalised });
});

// ── POST /api/auth/login ──────────────────────────────────────────────────────
router.post('/login', limiter, async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const normalised = email.trim().toLowerCase();

  const { data, error } = await supabase
    .from('whitelisted_emails')
    .select('email, password_hash')
    .eq('email', normalised)
    .maybeSingle();

  if (error || !data) {
    return res.status(403).json({ error: 'Email not authorised.' });
  }
  if (!data.password_hash) {
    return res.status(400).json({ error: 'No password set yet. Please set up your account first.' });
  }

  const match = await bcrypt.compare(password, data.password_hash);
  if (!match) {
    return res.status(401).json({ error: 'Incorrect password. Please try again.' });
  }

  const token = issueToken(normalised, req.body.remember);
  res.json({ token, email: normalised });
});

function issueToken(email, remember) {
  // remember=true → 30 days, remember=false/undefined → 8 hours
  const expiresIn = remember ? '30d' : '8h';
  return jwt.sign({ email }, process.env.JWT_SECRET, { expiresIn });
}

module.exports = router;
