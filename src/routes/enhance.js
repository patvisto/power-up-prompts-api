const express = require('express');
const rateLimit = require('express-rate-limit');
const { requireAuth } = require('../middleware/requireAuth');
const { enhancePrompt } = require('../services/groq');
const supabase = require('../services/supabase');

const router = express.Router();

const FREE_LIMIT    = 5;
const WINDOW_LIMIT  = 30;           // max powerups per window
const WINDOW_HOURS  = 4;            // cooldown window in hours

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
  if (prompt.trim().length > 6000) {
    return res.status(400).json({ error: 'Prompt must be 6000 characters or fewer.' });
  }

  const email = req.user.email;

  // Fetch current user status fresh from DB
  const { data: user, error } = await supabase
    .from('users')
    .select('powerups_used, is_subscribed, subscription_expires_at, is_admin, window_powerups, window_reset_at')
    .eq('email', email)
    .single();

  if (error || !user) {
    return res.status(401).json({ error: 'User not found.' });
  }

  const subscriptionValid = user.is_subscribed &&
    (!user.subscription_expires_at || new Date(user.subscription_expires_at) > new Date());

  const isUnlimited = user.is_admin;  // only admins skip ALL limits
  const isPaid = subscriptionValid;

  // ── Free user: hard cap at 5 total ──────────────────────────────────────────
  if (!isUnlimited && !isPaid && user.powerups_used >= FREE_LIMIT) {
    return res.status(402).json({
      error: 'limit_reached',
      powerups_used: user.powerups_used,
      is_subscribed: false,
      free_limit: FREE_LIMIT
    });
  }

  // ── Subscribed user: 50 per 4-hour window ──────────────────────────────────
  if (isPaid && !isUnlimited) {
    const now = new Date();
    let windowCount = user.window_powerups || 0;
    let windowReset = user.window_reset_at ? new Date(user.window_reset_at) : null;

    // If no window set or window expired → start a fresh window
    if (!windowReset || now >= windowReset) {
      windowCount = 0;
      windowReset = new Date(now.getTime() + WINDOW_HOURS * 60 * 60 * 1000);
    }

    // Check if they've hit the window limit
    if (windowCount >= WINDOW_LIMIT) {
      const msLeft = windowReset.getTime() - now.getTime();
      const minsLeft = Math.ceil(msLeft / 60000);
      const hrs = Math.floor(minsLeft / 60);
      const mins = minsLeft % 60;
      const timeStr = hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
      return res.status(429).json({
        error: 'window_limit',
        message: `You've used ${WINDOW_LIMIT} powerups. Try again in ${timeStr}.`,
        retry_after_ms: msLeft,
        window_powerups: windowCount,
        window_limit: WINDOW_LIMIT
      });
    }

    // Run the enhancement
    let enhanced;
    try {
      enhanced = await enhancePrompt(prompt.trim());
    } catch (err) {
      console.error('Groq error (subscribed):', err);
      return res.status(503).json({ error: 'Enhancement service unavailable. Please try again in a moment.' });
    }

    // Increment window counter
    windowCount += 1;
    await supabase
      .from('users')
      .update({ window_powerups: windowCount, window_reset_at: windowReset.toISOString() })
      .eq('email', email);

    return res.json({
      enhanced,
      powerups_used: null,
      is_subscribed: true,
      is_admin: user.is_admin,
      free_limit: FREE_LIMIT,
      window_powerups: windowCount,
      window_limit: WINDOW_LIMIT
    });
  }

  // ── Admin: no limits at all ─────────────────────────────────────────────────
  if (isUnlimited) {
    let enhanced;
    try {
      enhanced = await enhancePrompt(prompt.trim());
    } catch (err) {
      console.error('Groq error (admin):', err);
      return res.status(503).json({ error: 'Enhancement service unavailable. Please try again in a moment.' });
    }
    return res.json({
      enhanced,
      powerups_used: null,
      is_subscribed: true,
      is_admin: true,
      free_limit: FREE_LIMIT
    });
  }

  // ── Free user within limit ──────────────────────────────────────────────────
  let enhanced;
  try {
    enhanced = await enhancePrompt(prompt.trim());
  } catch (err) {
    console.error('Groq error (free):', err);
    return res.status(503).json({ error: 'Enhancement service unavailable. Please try again in a moment.' });
  }
  const newCount = user.powerups_used + 1;
  await supabase
    .from('users')
    .update({ powerups_used: newCount })
    .eq('email', email);

  res.json({
    enhanced,
    powerups_used: newCount,
    is_subscribed: false,
    is_admin: false,
    free_limit: FREE_LIMIT
  });
});

module.exports = router;
