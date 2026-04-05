const crypto = require('crypto');
const express = require('express');
const supabase = require('../services/supabase');

const router = express.Router();

// ── POST /api/webhook/payment ─────────────────────────────────────────────────
// Receives PayMongo webhook events when a payment link is paid.
// PayMongo payload: data.attributes.type = event name
//                   data.attributes.data.attributes = payment resource

router.post('/payment', async (req, res) => {
  const body = req.body;

  // ── Log PayMongo signature (verify later, don't block) ───────────────────
  const sigHeader = req.headers['paymongo-signature'];
  if (sigHeader && process.env.PAYMONGO_WEBHOOK_SECRET) {
    const parts = {};
    sigHeader.split(',').forEach(p => {
      const [key, ...rest] = p.split('=');
      parts[key] = rest.join('=');
    });
    const timestamp = parts.t;
    const rawBody = req.rawBody || JSON.stringify(body);
    const signedPayload = `${timestamp}.${rawBody}`;
    const computed = crypto
      .createHmac('sha256', process.env.PAYMONGO_WEBHOOK_SECRET)
      .update(signedPayload)
      .digest('hex');
    const valid = computed === parts.te || computed === parts.li;
    console.log(`Webhook signature check: ${valid ? 'VALID' : 'INVALID'}`);
  }

  // ── Parse PayMongo event ─────────────────────────────────────────────────
  const eventType = body?.data?.attributes?.type;
  if (!eventType) {
    return res.status(400).json({ error: 'Not a valid PayMongo event.' });
  }

  console.log(`PayMongo event: ${eventType}`);

  // Only process payment events
  if (!eventType.includes('payment.paid')) {
    return res.json({ success: true, message: `Ignored event: ${eventType}` });
  }

  const paymentAttrs = body.data.attributes.data?.attributes || {};

  // Extract email — billing.email is the primary location
  const email =
    paymentAttrs.billing?.email ||
    paymentAttrs.payments?.[0]?.data?.attributes?.billing?.email ||
    null;

  if (!email) {
    console.error('Webhook: no email in payment:', JSON.stringify(paymentAttrs.billing || {}).slice(0, 300));
    return res.status(400).json({ error: 'No billing email in payment.' });
  }

  // Determine plan from amount (centavos): ₱229 = 22900 (monthly), ₱1329 = 132900 (yearly)
  const amount =
    paymentAttrs.amount ||
    paymentAttrs.payments?.[0]?.data?.attributes?.amount || 0;

  const plan = (amount > 0 && amount <= 25000) ? 'monthly' : 'yearly';
  const normalised = email.trim().toLowerCase();

  console.log(`Payment: ${normalised}, amount: ${amount} centavos, plan: ${plan}`);

  // ── Activate subscription ────────────────────────────────────────────────
  const expiresAt = new Date();
  if (plan === 'monthly') {
    expiresAt.setMonth(expiresAt.getMonth() + 1);
  } else {
    expiresAt.setFullYear(expiresAt.getFullYear() + 1);
  }

  // Try updating existing user first
  const { data: updated, error } = await supabase
    .from('users')
    .update({
      is_subscribed: true,
      subscription_expires_at: expiresAt.toISOString()
    })
    .eq('email', normalised)
    .select();

  if (error) {
    console.error('Webhook DB error:', error);
    return res.status(500).json({ error: 'Failed to update subscription.' });
  }

  // If user doesn't exist, create them
  if (!updated || updated.length === 0) {
    const { error: insertErr } = await supabase
      .from('users')
      .insert({
        email: normalised,
        is_subscribed: true,
        subscription_expires_at: expiresAt.toISOString()
      });

    if (insertErr) {
      console.error('Webhook insert error:', insertErr);
      return res.status(500).json({ error: 'Failed to create user.' });
    }
    console.log(`New user ${normalised} created with ${plan} sub via PayMongo`);
  } else {
    console.log(`${plan} sub activated for ${normalised} until ${expiresAt.toDateString()}`);
  }

  res.json({ success: true });
});

module.exports = router;
