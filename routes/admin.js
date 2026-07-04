/**
 * Admin API — authentication (login/logout/session) plus all dashboard
 * endpoints, every one of which requires a valid admin session.
 * Powers the /atmin dashboard: stats, user list, chat logs, filters, exports.
 */
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { verifyAdminKey } from '../middleware/auth.js';
import { adminLimiter } from '../middleware/security.js';
import {
  requireAdminSession,
  issueAdminSession,
  clearAdminSession,
  getSessionToken,
} from '../middleware/session.js';
import {
  getStats,
  getAllUsers,
  getUser,
  getActivePages,
  getAllChatLogs,
  getChatLog,
  deleteUser,
  clearAllLogs,
} from '../database/redis.js';

const router = Router();

router.use(adminLimiter);

/* ------------------------------------------------------------------ */
/* Authentication (public — not behind requireAdminSession)           */
/* ------------------------------------------------------------------ */

// Stricter limiter on the login endpoint to slow down brute-force attempts.
const loginLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Terlalu banyak percobaan login. Coba lagi beberapa menit lagi.' },
});

/** POST /atmin/api/auth/login — verifies the admin key and starts a session. */
router.post('/auth/login', loginLimiter, async (req, res) => {
  try {
    const { key } = req.body || {};
    const valid = await verifyAdminKey(key);

    if (!valid) {
      return res.status(401).json({ ok: false, error: 'Admin key salah.' });
    }

    await issueAdminSession(req, res);
    res.json({ ok: true });
  } catch (err) {
    console.error('[Admin Auth] Login error:', err.message);
    res.status(500).json({ ok: false, error: 'Internal Server Error' });
  }
});

/** POST /atmin/api/auth/logout — destroys the current session. */
router.post('/auth/logout', async (req, res) => {
  await clearAdminSession(req, res);
  res.json({ ok: true });
});

/** GET /atmin/api/auth/me — lets the frontend know if it's already logged in. */
router.get('/auth/me', async (req, res) => {
  const token = await getSessionToken(req);
  res.json({ ok: true, loggedIn: !!token });
});

/* ------------------------------------------------------------------ */
/* Protected dashboard endpoints                                      */
/* ------------------------------------------------------------------ */

router.use(requireAdminSession);

/** Aggregate dashboard stats. */
router.get('/stats', async (req, res) => {
  const stats = await getStats();
  const activePages = await getActivePages();
  res.json({ ok: true, stats, activePages });
});

/** Full user list with optional filters: browser, device, country, page, search. */
router.get('/users', async (req, res) => {
  const { search, browser, device, country, page } = req.query;
  let users = await getAllUsers();

  if (search) {
    const q = String(search).toLowerCase();
    users = users.filter(
      (u) => u.ip?.toLowerCase().includes(q) || u.id?.toLowerCase().includes(q)
    );
  }
  if (browser) users = users.filter((u) => u.browser?.toLowerCase().includes(String(browser).toLowerCase()));
  if (device) users = users.filter((u) => u.device?.toLowerCase().includes(String(device).toLowerCase()));
  if (country) users = users.filter((u) => u.country?.toLowerCase().includes(String(country).toLowerCase()));
  if (page) users = users.filter((u) => u.page?.toLowerCase().includes(String(page).toLowerCase()));

  res.json({ ok: true, count: users.length, users });
});

/** Detail of one user including their chat log. */
router.get('/users/:id', async (req, res) => {
  const user = await getUser(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const chat = await getChatLog(req.params.id);
  res.json({ ok: true, user, chat });
});

router.delete('/users/:id', async (req, res) => {
  await deleteUser(req.params.id);
  res.json({ ok: true });
});

/** All chat logs across users. */
router.get('/chats', async (req, res) => {
  const chats = await getAllChatLogs();
  res.json({ ok: true, chats });
});

/** Export as JSON. */
router.get('/export/json', async (req, res) => {
  const [users, chats, stats] = await Promise.all([getAllUsers(), getAllChatLogs(), getStats()]);
  res.setHeader('Content-Disposition', 'attachment; filename="sylent-export.json"');
  res.json({ exportedAt: new Date().toISOString(), stats, users, chats });
});

/** Export as CSV (users table). */
router.get('/export/csv', async (req, res) => {
  const users = await getAllUsers();
  const headers = ['id', 'ip', 'browser', 'os', 'device', 'country', 'page', 'firstSeen', 'lastSeen', 'status'];
  const rows = users.map((u) => headers.map((h) => `"${(u[h] ?? '').toString().replace(/"/g, '""')}"`).join(','));
  const csv = [headers.join(','), ...rows].join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="sylent-users.csv"');
  res.send(csv);
});

/** Wipe all logs (users, chats, stats). */
router.delete('/logs', async (req, res) => {
  await clearAllLogs();
  res.json({ ok: true, message: 'All logs cleared.' });
});

export default router;
