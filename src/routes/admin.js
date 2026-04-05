const express = require('express');
const supabase = require('../services/supabase');

const router = express.Router();

// Simple API key auth for admin routes
function requireAdmin(req, res, next) {
  const key = req.headers['x-admin-key'];
  if (!key || key !== process.env.ADMIN_API_KEY) {
    return res.status(401).json({ error: 'Invalid admin key.' });
  }
  next();
}

// ── GET /api/admin/whitelist — list all emails ────────────────────────────────
router.get('/whitelist', requireAdmin, async (req, res) => {
  const { data, error } = await supabase
    .from('whitelisted_emails')
    .select('id, email, added_at, note')
    .order('added_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json({ users: data });
});

// ── POST /api/admin/whitelist — add an email ──────────────────────────────────
router.post('/whitelist', requireAdmin, async (req, res) => {
  const { email, note } = req.body;

  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email required.' });
  }

  const { data, error } = await supabase
    .from('whitelisted_emails')
    .insert({ email: email.trim().toLowerCase(), note: note || null })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Email already whitelisted.' });
    return res.status(500).json({ error: error.message });
  }

  res.status(201).json({ user: data });
});

// ── DELETE /api/admin/whitelist/:email — remove an email ──────────────────────
router.delete('/whitelist/:email', requireAdmin, async (req, res) => {
  const email = decodeURIComponent(req.params.email).toLowerCase();

  const { error } = await supabase
    .from('whitelisted_emails')
    .delete()
    .eq('email', email);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: `${email} removed from whitelist.` });
});

module.exports = router;
