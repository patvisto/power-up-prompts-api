const jwt = require('jsonwebtoken');

// Verifies JWT — no whitelist check, anyone with a valid token can access
async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header.' });
  }

  const token = authHeader.slice(7);

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { email: payload.email, is_admin: payload.is_admin || false };
    next();
  } catch {
    return res.status(401).json({ error: 'Token invalid or expired. Please sign in again.' });
  }
}

module.exports = { requireAuth };
