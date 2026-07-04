/**
 * Generic public API routes: page-view tracking, identity info, health check.
 */
import { Router } from 'express';
import { upsertUser, incrVisitor } from '../database/redis.js';

const router = Router();

/** Frontend calls this on every route change (SPA-style page tracking). */
router.post('/track/page', async (req, res) => {
  try {
    const { page } = req.body || {};
    if (!page || typeof page !== 'string') {
      return res.status(400).json({ error: 'page is required' });
    }

    await upsertUser(req.userId, { page });

    res.json({ ok: true });
  } catch (err) {
    console.error('[API] track/page error:', err.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

/** Static identity info consumed by the frontend (no secrets). */
router.get('/identity', (req, res) => {
  res.json({
    name: 'Sylent AI',
    model: 'Sylent 0.1',
    developer: 'pajar',
    portfolio: 'https://pixajar.my.id',
    donation: 'https://hellocloud.my.id/donasi',
    domain: 'https://ai.sylent.biz.id',
  });
});

router.get('/health', (req, res) => {
  res.json({ ok: true, status: 'healthy', uptime: process.uptime() });
});

export default router;
