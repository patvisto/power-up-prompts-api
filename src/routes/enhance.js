const express = require('express');
const rateLimit = require('express-rate-limit');
const { requireAuth } = require('../middleware/requireAuth');
const { enhancePrompt } = require('../services/groq');
const supabase = require('../services/supabase');

const router = express.Router();

const FREE_LIMIT = 5;

const enhanceLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 60,
  keyGenerator: (req) => req.user?.email || req.ip,
  message: { error: 'Rate limit reached. Please try again later.' }
});

// ── POST /api/enhance ─────────────────────────────────────────────────────────
router.post('/', requireAuth, enhanceLimiter, async (req, res) => {
  const { prompt } = req.body;

  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    return res.status(400).json({ error: 'A prompt string is required.' });
  }
  if (prompt.trim().length > 2000) {
    return res.status(400).json({ error: 'Prompt must be 2000 characters or fewer.' });
  }

  const email = req.user.email;

  // Fetch current user status fresh from DB
  const { data: user, error } = await supabase
    .from('users')
    .select('powerups_used, is_subscribed, subscription_expires_at, is_admin')
    .eq('email', email)
    .single();

  if (error || !user) {
    return res.status(401).json({ error: 'User not found.' });
  }

  const subscriptionValid = user.is_subscribed &&
    (!user.subscription_expires_at || new Date(user.subscription_expires_at) > new Date());

  const isUnlimited = user.is_admin || subscriptionValid;

  // Enforce free limit
  if (!isUnlimited && user.powerups_used >= FREE_LIMIT) {
    return res.status(402).json({
      error: 'limit_reached',
      powerups_used: user.powerups_used,
      is_subscribed: false,
      free_limit: FREE_LIMIT
    });
  }

  // Run the enhancement
  const enhanced = await enhancePrompt(prompt.trim());

  // Increment powerup count for free users
  const newCount = user.powerups_used + 1;
  if (!isUnlimited) {
    await supabase
      .from('users')
      .update({ powerups_used: newCount })
      .eq('email', email);
  }

  res.json({
    enhanced,
    powerups_used: isUnlimited ? null : newCount,
    is_subscribed: subscriptionValid,
    is_admin: user.is_admin,
    free_limit: FREE_LIMIT
  });
});

module.exports = router;
