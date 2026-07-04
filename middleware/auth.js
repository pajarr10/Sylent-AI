/**
 * Admin key verification.
 * Used only by the login endpoint — the raw key is checked once here
 * against the value stored in Redis, then a session is issued. The key is
 * NEVER exposed to the frontend and never read from query parameters again.
 */
import { getAdminKey } from '../database/redis.js';

/** Returns true if the provided key matches the one stored in Redis. */
export async function verifyAdminKey(providedKey) {
  if (!providedKey || typeof providedKey !== 'string') return false;
  const realKey = await getAdminKey();
  return !!realKey && providedKey === realKey;
}
