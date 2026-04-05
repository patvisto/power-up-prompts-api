require('dotenv').config();
const express = require('express');
const cors = require('cors');
const authRoutes    = require('./routes/auth');
const enhanceRoutes = require('./routes/enhance');
const adminRoutes   = require('./routes/admin');
const webhookRoutes = require('./routes/webhook');

const app = express();

const allowedOrigin = process.env.ALLOWED_ORIGIN || '*';
app.use(cors({
  origin: (origin, callback) => {
    if (allowedOrigin === '*') return callback(null, true);
    if (!origin || origin === allowedOrigin) return callback(null, true);
    callback(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-admin-key', 'x-webhook-secret']
}));

app.use(express.json({ limit: '16kb' }));

app.use('/api/auth',    authRoutes);
app.use('/api/enhance', enhanceRoutes);
app.use('/api/admin',   adminRoutes);
app.use('/api/webhook', webhookRoutes);

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Power Up Prompts API running on port ${PORT}`));
