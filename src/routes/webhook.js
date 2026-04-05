const express = require('express');
const supabase = require('../services/supabase');

const router = express.Router();

// ── POST /api/webhook/payment ─────────────────────────────────────────────────
// Generic payment webhook — call this from your payment gateway after a
// successful payment. Expects { email, plan } in the body.
// plan: 'monthly' or 'yearly' (defaults to 'yearly' for backward compatibility)

router.post('/payment', async (req, res) => {
  const secret = req.headers['x-webhook-secret'];
  if (process.env.WEBHOOK_SECRET && secret !== process.env.WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Invalid webhook secret.' });
  }

  const email =
    req.body?.email ||
    req.body?.data?.attributes?.billing?.email ||
    req.body?.customer?.email;

  if (!email) {
    return res.status(400).json({ error: 'Email not found in payload.' });
  }

  const plan = (req.body?.plan || 'yearly').toLowerCase();
  const normalised = email.trim().toLowerCase();
  const expiresAt = new Date();

  if (plan === 'monthly') {
    expiresAt.setMonth(expiresAt.getMonth() + 1);
  } else {
    expiresAt.setFullYear(expiresAt.getFullYear() + 1);
  }

  const { error } = await supabase
    .from('users')
    .update({
      is_subscribed: true,
      subscription_expires_at: expiresAt.toISOString()
    })
    .eq('email', normalised);

  if (error) {
    console.error('Webhook DB error:', error);
    return res.status(500).json({ error: 'Failed to update subscription.' });
  }

  console.log(`${plan} subscription granted to ${normalised} via webhook (expires ${expiresAt.toDateString()})`);
  res.json({ success: true, message: `${plan} subscription activated for ${normalised}`, expires: expiresAt.toISOString() });
});

module.exports = router;
