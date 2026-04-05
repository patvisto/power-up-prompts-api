const express = require('express');
const jwt = require('jsonwebtoken');
const supabase = require('../services/supabase');

const router = express.Router();

// Accepts either the admin API key OR a valid JWT with is_admin: true
function requireAdmin(req, res, next) {
  // Try JWT first (extension admin users)
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const payload = jwt.verify(authHeader.slice(7), process.env.JWT_SECRET);
      if (payload.is_admin) {
        req.adminEmail = payload.email;
        return next();
      }
    } catch {}
  }

  // Fall back to API key (admin panel / external tools)
  const key = req.headers['x-admin-key'];
  if (key && key === process.env.ADMIN_API_KEY) {
    return next();
  }

  res.status(401).json({ error: 'Admin access required.' });
}

// ── GET /api/admin/whitelist ──────────────────────────────────────────────────
router.get('/whitelist', requireAdmin, async (req, res) => {
  const { data, error } = await supabase
    .from('whitelisted_emails')
    .select('id, email, is_admin, added_at, note')
    .order('added_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json({ users: data });
});

// ── POST /api/admin/whitelist ─────────────────────────────────────────────────
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

// ── DELETE /api/admin/whitelist/:email ────────────────────────────────────────
router.delete('/whitelist/:email', requireAdmin, async (req, res) => {
  const email = decodeURIComponent(req.params.email).toLowerCase();

  // Prevent admin from removing themselves
  if (req.adminEmail && req.adminEmail === email) {
    return res.status(400).json({ error: 'You cannot remove your own account.' });
  }

  const { error } = await supabase
    .from('whitelisted_emails')
    .delete()
    .eq('email', email);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: `${email} removed.` });
});

module.exports = router;
