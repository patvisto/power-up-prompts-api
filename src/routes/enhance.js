const express = require('express');
const rateLimit = require('express-rate-limit');
const { requireAuth } = require('../middleware/requireAuth');
const { enhancePrompt } = require('../services/groq');

const router = express.Router();

// Rate limit enhance calls: max 30 per hour per user
const enhanceLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  keyGenerator: (req) => req.user?.id || req.ip,
  message: { error: 'Rate limit reached. You can enhance up to 30 prompts per hour.' },
  standardHeaders: true,
  legacyHeaders: false
});

// ── POST /api/enhance ─────────────────────────────────────────────────────────
router.post('/', requireAuth, enhanceLimiter, async (req, res) => {
  const { prompt } = req.body;

  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'A prompt string is required.' });
  }

  const trimmed = prompt.trim();

  if (trimmed.length === 0) {
    return res.status(400).json({ error: 'Prompt cannot be empty.' });
  }

  if (trimmed.length > 2000) {
    return res.status(400).json({ error: 'Prompt must be 2000 characters or fewer.' });
  }

  const enhanced = await enhancePrompt(trimmed);
  res.json({ enhanced });
});

module.exports = router;
