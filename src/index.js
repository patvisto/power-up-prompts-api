require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const authRoutes    = require('./routes/auth');
const enhanceRoutes = require('./routes/enhance');
const adminRoutes   = require('./routes/admin');
const webhookRoutes = require('./routes/webhook');

const app = express();

// Render runs behind a reverse proxy — needed for rate limiting to see real IPs
app.set('trust proxy', 1);

const allowedOrigin = process.env.ALLOWED_ORIGIN || '*';
app.use(cors({
  origin: (origin, callback) => {
    // Allow: Chrome extensions, no-origin (server-to-server / webhooks), and explicit allowlist
    if (!origin) return callback(null, true);                           // webhooks, curl, etc.
    if (origin.startsWith('chrome-extension://')) return callback(null, true);  // any extension
    if (allowedOrigin === '*') return callback(null, true);
    if (origin === allowedOrigin) return callback(null, true);
    callback(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-admin-key', 'x-webhook-secret', 'paymongo-signature']
}));

// Preserve raw body for PayMongo signature verification
app.use(express.json({
  limit: '16kb',
  verify: (req, _res, buf) => { req.rawBody = buf.toString(); }
}));

app.use('/api/auth',    authRoutes);
app.use('/api/enhance', enhanceRoutes);
app.use('/api/admin',   adminRoutes);
app.use('/api/webhook', webhookRoutes);

app.get('/health', (_req, res) => res.json({ status: 'ok' }));
app.get('/privacy', (_req, res) => res.sendFile(path.join(__dirname, 'privacy.html')));

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Power Up Prompts API running on port ${PORT}`));
