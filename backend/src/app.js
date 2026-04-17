import express from 'express';
import cors from 'cors';

import authRoutes from './routes/authRoutes.js';
import incidentRoutes from './routes/incidentRoutes.js';
import aiRoutes from './routes/aiRoutes.js';
import analyticsRoutes from './routes/analyticsRoutes.js';
import notificationRoutes from './routes/notificationRoutes.js';
import locationRoutes from './routes/locationRoutes.js';
import auditRoutes from './routes/auditRoutes.js';

import { notFoundHandler, errorHandler } from './middleware/errorHandler.js';

const app = express();

// ✅ CORS (fixed for Render + Vercel)
app.use(
  cors({
    origin: process.env.CLIENT_ORIGIN || '*',
    credentials: true,
  })
);

// ✅ Middleware
app.use(express.json({ limit: '1mb' }));

// ✅ Health check route (VERY IMPORTANT)
app.get('/', (req, res) => {
  res.send('CrisisSync API is running 🚀');
});

app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'CrisisSync AI API' });
});

// ✅ API routes (IMPORTANT CHANGE → /api prefix)
app.use('/api/auth', authRoutes);
app.use('/api/incident', incidentRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/location', locationRoutes);
app.use('/api/audit', auditRoutes);

// ✅ Error handlers
app.use(notFoundHandler);
app.use(errorHandler);

export default app;