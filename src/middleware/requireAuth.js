const jwt = require('jsonwebtoken');
const supabase = require('../services/supabase');

async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header.' });
  }

  const token = authHeader.slice(7);

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Token invalid or expired. Please sign in again.' });
  }

  // Re-check whitelist on every request (catches removed users immediately)
  const { data, error } = await supabase
    .from('whitelisted_emails')
    .select('email')
    .eq('email', payload.email)
    .maybeSingle();

  if (error || !data) {
    return res.status(403).json({ error: 'Access revoked. Contact the administrator.' });
  }

  req.user = { email: payload.email };
  next();
}

module.exports = { requireAuth };
