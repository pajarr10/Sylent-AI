/**
 * Admin session management.
 * Sessions are opaque random tokens stored server-side in Redis (with TTL)
 * and referenced by a signed, HttpOnly cookie. The admin key itself is
 * never stored in the cookie/session — only checked once at login time.
 */
import { randomBytes } from 'crypto';
import {
  createAdminSession,
  isAdminSessionValid,
  touchAdminSession,
  destroyAdminSession,
} from '../database/redis.js';

export const ADMIN_COOKIE_NAME = 'sylent_admin_session';

/** Parses durations like "7d", "12h", "30m", "45s" into seconds. */
export function parseDuration(input, fallbackSeconds = 7 * 24 * 60 * 60) {
  if (!input) return fallbackSeconds;
  const match = String(input).trim().match(/^(\d+)\s*([smhdw])?$/i);
  if (!match) return fallbackSeconds;
  const value = Number(match[1]);
  const unit = (match[2] || 's').toLowerCase();
  const multipliers = { s: 1, m: 60, h: 3600, d: 86400, w: 604800 };
  return value * (multipliers[unit] || 1);
}

const SESSION_TTL_SECONDS = parseDuration(process.env.SESSION_EXPIRES, 7 * 24 * 60 * 60);

/** Determines whether the current request is effectively over HTTPS. */
function isRequestSecure(req) {
  return req.secure || req.headers['x-forwarded-proto'] === 'https';
}

/** Issues a new admin session: creates the Redis record and sets the cookie. */
export async function issueAdminSession(req, res) {
  const token = randomBytes(32).toString('hex');
  await createAdminSession(token, SESSION_TTL_SECONDS);

  res.cookie(ADMIN_COOKIE_NAME, token, {
    httpOnly: true,
    signed: true,
    sameSite: 'lax',
    secure: isRequestSecure(req),
    maxAge: SESSION_TTL_SECONDS * 1000,
    path: '/',
  });

  return token;
}

/** Reads + validates the session cookie against the Redis session store. */
export async function getSessionToken(req) {
  const token = req.signedCookies?.[ADMIN_COOKIE_NAME];
  if (!token) return null;
  const valid = await isAdminSessionValid(token);
  return valid ? token : null;
}

/** Middleware guarding admin API routes — requires a valid session. */
export async function requireAdminSession(req, res, next) {
  try {
    const token = await getSessionToken(req);
    if (!token) {
      return res.status(403).json({ error: 'Forbidden', message: '403 Unauthorized' });
    }
    // Sliding expiration: keep active admins logged in.
    await touchAdminSession(token, SESSION_TTL_SECONDS);
    req.adminSessionToken = token;
    next();
  } catch (err) {
    console.error('[Session] Error validating admin session:', err.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}

/** Destroys the session server-side and clears the cookie. */
export async function clearAdminSession(req, res) {
  const token = req.signedCookies?.[ADMIN_COOKIE_NAME];
  if (token) await destroyAdminSession(token);
  res.clearCookie(ADMIN_COOKIE_NAME, { path: '/' });
}

export { SESSION_TTL_SECONDS };
