/**
 * Request logger + user tracking middleware.
 * Parses UA, resolves an anonymous user id (cookie-based), and stores
 * session info in Redis for the admin dashboard.
 */
import { UAParser } from 'ua-parser-js';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { upsertUser, incrVisitor } from '../database/redis.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IS_SERVERLESS = !!process.env.VERCEL;

// Vercel's filesystem is read-only except /tmp, so we only keep a local
// access.log file when running as a regular Node process.
const LOG_DIR = IS_SERVERLESS ? '/tmp' : path.join(__dirname, '..', 'logs');
const ACCESS_LOG = path.join(LOG_DIR, 'access.log');

if (!IS_SERVERLESS && !fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}

function writeAccessLog(line) {
  fs.appendFile(ACCESS_LOG, line + '\n', () => {});
}

/** Ensures every request has a `sylent_uid` cookie identifying the visitor. */
export function ensureUserId(req, res, next) {
  let uid = req.cookies?.sylent_uid;
  if (!uid) {
    uid = randomUUID();
    res.cookie('sylent_uid', uid, {
      maxAge: 1000 * 60 * 60 * 24 * 365,
      httpOnly: true,
      sameSite: 'lax',
    });
  }
  req.userId = uid;
  next();
}

/** Parses UA + records the visit into Redis + local log file. */
export async function trackVisit(req, res, next) {
  try {
    const ua = req.headers['user-agent'] || '';
    const parser = new UAParser(ua);
    const result = parser.getResult();
    const ip = getClientIp(req);

    const info = {
      ip,
      browser: `${result.browser.name || 'Unknown'} ${result.browser.version || ''}`.trim(),
      os: `${result.os.name || 'Unknown'} ${result.os.version || ''}`.trim(),
      device: result.device.type || 'desktop',
      userAgent: ua,
      referer: req.headers['referer'] || req.headers['referrer'] || 'direct',
      country: req.headers['cf-ipcountry'] || req.headers['x-country'] || 'Unknown',
      page: req.path,
    };

    const isNew = !req.cookies?.sylent_uid;
    await upsertUser(req.userId, info);
    if (isNew) await incrVisitor(ip);

    writeAccessLog(
      `[${new Date().toISOString()}] ${req.method} ${req.originalUrl} | IP:${ip} | UID:${req.userId} | UA:${ua}`
    );
  } catch (err) {
    console.error('[Logger] trackVisit error:', err.message);
  }
  next();
}
