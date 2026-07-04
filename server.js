/**
 * Sylent AI — single entrypoint for the whole app.
 * Serves the static frontend (public/), the AI proxy API, the admin API,
 * and file/image uploads — all from one process. Works both as a normal
 * Node server (npm start) and as a Vercel serverless function (server.js
 * exports the Express `app`, Vercel handles the listening part).
 *
 * Run:  npm install && npm start
 */
import 'dotenv/config';
import express from 'express';
import path from 'path';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import compression from 'compression';
import { fileURLToPath } from 'url';

import { connectRedis } from './database/redis.js';
import { helmetMiddleware, apiLimiter } from './middleware/security.js';
import { ensureUserId, trackVisit } from './middleware/logger.js';

import aiRoutes from './routes/ai.js';
import adminRoutes from './routes/admin.js';
import apiRoutes from './routes/api.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const IS_VERCEL = !!process.env.VERCEL;

const app = express();

/* ---------------------------------------------------------------- */
/* Core middleware                                                   */
/* ---------------------------------------------------------------- */
app.use(helmetMiddleware);
app.use(compression());
app.use(cors());
app.use(express.json({ limit: '8mb' }));
app.use(express.urlencoded({ extended: true, limit: '8mb' }));
app.use(cookieParser(process.env.SESSION_SECRET || 'sylent-fallback-secret-change-me'));

app.use(ensureUserId);
app.use(trackVisit);

/* ---------------------------------------------------------------- */
/* Routes                                                             */
/* ---------------------------------------------------------------- */
app.use('/ai', apiLimiter, aiRoutes);
app.use('/atmin/api', adminRoutes);
app.use('/api', apiRoutes);

// Admin panel static (separate mini frontend, served from the /atmin path).
// The panel is a single page that toggles between a login screen and the
// dashboard client-side depending on session state.
app.use('/atmin', express.static(path.join(__dirname, 'public', 'atmin')));
app.get('/atmin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'atmin', 'index.html'));
});

// Main frontend static
app.use(express.static(path.join(__dirname, 'public')));

// Friendly routes for the SPA-ish pages
app.get(['/', '/index.html'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.get('/profile', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'profile.html'));
});
app.get('/docs', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'docs.html'));
});

// 404 fallback
app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, 'public', 'index.html'));
});

/* ---------------------------------------------------------------- */
/* Boot                                                               */
/* ---------------------------------------------------------------- */
async function bootstrap() {
  try {
    await connectRedis();
    app.listen(PORT, () => {
      console.log('====================================');
      console.log('  Sylent AI server is running');
      console.log(`  Local:  http://localhost:${PORT}`);
      console.log(`  Domain: ${process.env.DOMAIN || 'https://ai.sylent.biz.id'}`);
      console.log('====================================');
    });
  } catch (err) {
    console.error('[Bootstrap] Failed to start server:', err);
    process.exit(1);
  }
}

// On Vercel the platform imports `app` directly and calls it per-request;
// we must not call app.listen() there. Locally (npm start) we boot normally.
if (!IS_VERCEL) {
  bootstrap();
} else {
  connectRedis().catch((err) => console.error('[Bootstrap] Redis connect failed:', err));
}

export default app;
