const express = require('express');
const supabase = require('../services/supabase');

const router = express.Router();

// ── POST /api/webhook/payment ─────────────────────────────────────────────────
// Generic payment webhook — call this from your payment gateway after a
// successful payment. Expects { email } in the body.
//
// Secure it with the WEBHOOK_SECRET env var — set the same value as the
// "webhook secret" in your payment gateway dashboard.
//
// PayMongo example: add this URL to your PayMongo webhook settings and
// extract the customer email from the payload before forwarding here.

router.post('/payment', async (req, res) => {
  const secret = req.headers['x-webhook-secret'];
  if (process.env.WEBHOOK_SECRET && secret !== process.env.WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Invalid webhook secret.' });
  }

  // Accept email directly or nested in common payment gateway formats
  const email =
    req.body?.email ||
    req.body?.data?.attributes?.billing?.email ||
    req.body?.customer?.email;

  if (!email) {
    return res.status(400).json({ error: 'Email not found in payload.' });
  }

  const normalised = email.trim().toLowerCase();
  const expiresAt = new Date();
  expiresAt.setFullYear(expiresAt.getFullYear() + 1);

  const { error } = await supabase
    .from('users')
    .update({ is_subscribed: true, subscription_expires_at: expiresAt.toISOString() })
    .eq('email', normalised);

  if (error) {
    console.error('Webhook DB error:', error);
    return res.status(500).json({ error: 'Failed to update subscription.' });
  }

  console.log(`Subscription granted to ${normalised} via webhook`);
  res.json({ success: true, message: `Subscription activated for ${normalised}` });
});

module.exports = router;
