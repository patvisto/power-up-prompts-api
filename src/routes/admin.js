const express = require('express');
const jwt = require('jsonwebtoken');
const supabase = require('../services/supabase');

const router = express.Router();

function requireAdmin(req, res, next) {
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
  const key = req.headers['x-admin-key'];
  if (key && key === process.env.ADMIN_API_KEY) return next();
  res.status(401).json({ error: 'Admin access required.' });
}

// ── GET /api/admin/users ──────────────────────────────────────────────────────
router.get('/users', requireAdmin, async (req, res) => {
  const { data, error } = await supabase
    .from('users')
    .select('id, email, is_admin, is_subscribed, subscription_expires_at, powerups_used, added_at')
    .order('added_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json({ users: data });
});

// Keep /whitelist as alias for backward compatibility with admin panel
router.get('/whitelist', requireAdmin, async (req, res) => {
  const { data, error } = await supabase
    .from('users')
    .select('id, email, is_admin, is_subscribed, powerups_used, added_at, note')
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
    .from('users')
    .insert({ email: email.trim().toLowerCase(), note: note || null })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Email already exists.' });
    return res.status(500).json({ error: error.message });
  }
  res.status(201).json({ user: data });
});

// ── DELETE /api/admin/whitelist/:email ────────────────────────────────────────
router.delete('/whitelist/:email', requireAdmin, async (req, res) => {
  const email = decodeURIComponent(req.params.email).toLowerCase();
  if (req.adminEmail && req.adminEmail === email) {
    return res.status(400).json({ error: 'You cannot remove your own account.' });
  }
  const { error } = await supabase.from('users').delete().eq('email', email);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: `${email} removed.` });
});

// ── POST /api/admin/subscribe/:email ─────────────────────────────────────────
// Grant subscription — accepts optional { plan: 'monthly' | 'yearly' } body
router.post('/subscribe/:email', requireAdmin, async (req, res) => {
  const email = decodeURIComponent(req.params.email).toLowerCase();
  const plan = (req.body?.plan || 'yearly').toLowerCase();

  const expiresAt = new Date();
  if (plan === 'monthly') {
    expiresAt.setMonth(expiresAt.getMonth() + 1);
  } else {
    expiresAt.setFullYear(expiresAt.getFullYear() + 1);
  }

  const { error } = await supabase
    .from('users')
    .update({ is_subscribed: true, subscription_expires_at: expiresAt.toISOString() })
    .eq('email', email);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: `${plan} subscription granted to ${email} until ${expiresAt.toDateString()}.` });
});

// ── DELETE /api/admin/subscribe/:email ────────────────────────────────────────
// Revoke subscription
router.delete('/subscribe/:email', requireAdmin, async (req, res) => {
  const email = decodeURIComponent(req.params.email).toLowerCase();

  const { error } = await supabase
    .from('users')
    .update({ is_subscribed: false, subscription_expires_at: null })
    .eq('email', email);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: `Subscription revoked for ${email}.` });
});

// ── POST /api/admin/reset-powerups/:email ─────────────────────────────────────
router.post('/reset-powerups/:email', requireAdmin, async (req, res) => {
  const email = decodeURIComponent(req.params.email).toLowerCase();

  const { error } = await supabase
    .from('users')
    .update({ powerups_used: 0 })
    .eq('email', email);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: `Powerups reset for ${email}.` });
});

// ── POST /api/admin/reset-password/:email ─────────────────────────────────────
// Clears password_hash so the user is prompted to set up a new password on next login
router.post('/reset-password/:email', requireAdmin, async (req, res) => {
  const email = decodeURIComponent(req.params.email).toLowerCase();

  const { error } = await supabase
    .from('users')
    .update({ password_hash: null })
    .eq('email', email);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: `Password cleared for ${email}. User will be prompted to set a new one.` });
});

// ── POST /api/admin/reset-pin/:email ──────────────────────────────────────────
// Clears pin_hash so the user is prompted to set a new PIN on next setup
router.post('/reset-pin/:email', requireAdmin, async (req, res) => {
  const email = decodeURIComponent(req.params.email).toLowerCase();

  const { error } = await supabase
    .from('users')
    .update({ pin_hash: null })
    .eq('email', email);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: `Recovery PIN cleared for ${email}.` });
});

// ── POST /api/admin/bulk ──────────────────────────────────────────────────────
// Bulk-add emails and optionally grant subscriptions in one request.
// Body: { emails: string[], grant_subscription?: boolean, plan?: 'monthly'|'yearly' }
// Returns per-bucket results + a summary object.
router.post('/bulk', requireAdmin, async (req, res) => {
  const { emails, grant_subscription = false, plan = 'yearly' } = req.body;

  if (!Array.isArray(emails) || emails.length === 0) {
    return res.status(400).json({ error: 'emails array is required.' });
  }
  if (emails.length > 500) {
    return res.status(400).json({ error: 'Maximum 500 emails per batch.' });
  }

  const results = { added: [], already_exists: [], invalid: [], errors: [] };

  // Pre-compute subscription expiry once for the whole batch
  let expiresAt = null;
  if (grant_subscription) {
    expiresAt = new Date();
    if (plan === 'monthly') {
      expiresAt.setMonth(expiresAt.getMonth() + 1);
    } else {
      expiresAt.setFullYear(expiresAt.getFullYear() + 1);
    }
  }

  for (const raw of emails) {
    const email = String(raw || '').trim().toLowerCase();

    // Basic validation — must have an @ and a dot after it
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      results.invalid.push(String(raw).trim() || '(empty)');
      continue;
    }

    // Attempt insert
    const { error: insertError } = await supabase
      .from('users')
      .insert({
        email,
        is_subscribed: grant_subscription ? true : false,
        subscription_expires_at: expiresAt ? expiresAt.toISOString() : null
      });

    if (insertError) {
      if (insertError.code === '23505') {
        // Already in the DB — update subscription if requested
        if (grant_subscription) {
          await supabase
            .from('users')
            .update({ is_subscribed: true, subscription_expires_at: expiresAt.toISOString() })
            .eq('email', email);
        }
        results.already_exists.push(email);
      } else {
        console.error(`Bulk insert error for ${email}:`, insertError.message);
        results.errors.push(email);
      }
      continue;
    }

    results.added.push(email);
  }

  res.json({
    results,
    summary: {
      total: emails.length,
      added: results.added.length,
      already_exists: results.already_exists.length,
      invalid: results.invalid.length,
      errors: results.errors.length
    }
  });
});

module.exports = router;
