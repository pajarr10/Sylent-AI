/**
 * Redis client + all key-space helpers for Sylent AI.
 * Uses Upstash Redis (HTTP-based, serverless-friendly) so the whole app
 * runs cleanly on platforms like Vercel with no persistent connections.
 * Every persistence concern (users, chats, page views, admin key) lives here
 * so the rest of the app never talks to Redis directly.
 */
import { Redis } from '@upstash/redis';
import { randomUUID } from 'crypto';

const DEFAULT_ADMIN_KEY = process.env.ADMIN_KEY || 'sylent-admin-super-secret-2026';

const REST_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

if (!REST_URL || !REST_TOKEN) {
  console.warn(
    '[Redis] UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN not set. ' +
      'Set them in your environment (see .env.example) before starting the server.'
  );
}

export const redis = new Redis({ url: REST_URL, token: REST_TOKEN });

let seeded = false;

/** Verify connectivity and seed the default admin key if missing. */
export async function connectRedis() {
  if (seeded) return redis;
  await redis.ping();
  console.log('[Redis] Ready (Upstash)');

  const existingKey = await redis.get('sylent:admin_key');
  if (!existingKey) {
    await redis.set('sylent:admin_key', DEFAULT_ADMIN_KEY);
    console.log('[Redis] Seeded default ADMIN_KEY');
  }
  seeded = true;
  return redis;
}

/* ------------------------------------------------------------------ */
/* Admin key                                                           */
/* ------------------------------------------------------------------ */

export async function getAdminKey() {
  return redis.get('sylent:admin_key');
}

export async function setAdminKey(newKey) {
  await redis.set('sylent:admin_key', newKey);
  return newKey;
}

/* ------------------------------------------------------------------ */
/* Users / sessions tracking                                          */
/* ------------------------------------------------------------------ */

const USERS_SET = 'sylent:users';
const USER_KEY = (id) => `sylent:user:${id}`;
const ONLINE_SET = 'sylent:online';
const PAGE_HASH = 'sylent:active_pages'; // userId -> page

/** Create or refresh a user session record. */
export async function upsertUser(userId, info = {}) {
  const key = USER_KEY(userId);
  const now = Date.now();
  const existing = (await redis.hgetall(key)) || {};

  const data = {
    id: userId,
    ip: info.ip ?? existing.ip ?? 'unknown',
    browser: info.browser ?? existing.browser ?? 'unknown',
    os: info.os ?? existing.os ?? 'unknown',
    device: info.device ?? existing.device ?? 'unknown',
    userAgent: info.userAgent ?? existing.userAgent ?? 'unknown',
    referer: info.referer ?? existing.referer ?? '',
    country: info.country ?? existing.country ?? 'Unknown',
    page: info.page ?? existing.page ?? '/',
    firstSeen: existing.firstSeen ?? String(now),
    lastSeen: String(now),
    status: 'online',
  };

  await redis.hset(key, data);
  await redis.sadd(USERS_SET, userId);
  await redis.sadd(ONLINE_SET, userId);
  if (info.page) await redis.hset(PAGE_HASH, { [userId]: info.page });

  return data;
}

export async function markUserOffline(userId) {
  const key = USER_KEY(userId);
  const existing = await redis.hgetall(key);
  if (!existing || !Object.keys(existing).length) return;

  const lastSeen = Number(existing.lastSeen || Date.now());
  const firstSeenSession = Number(existing.firstSeen || lastSeen);
  const duration = Date.now() - firstSeenSession;

  await redis.hset(key, { status: 'offline', duration: String(duration) });
  await redis.srem(ONLINE_SET, userId);
  await redis.hdel(PAGE_HASH, userId);
}

export async function getUser(userId) {
  const data = await redis.hgetall(USER_KEY(userId));
  return data && Object.keys(data).length ? data : null;
}

export async function getAllUsers() {
  const ids = (await redis.smembers(USERS_SET)) || [];
  const users = await Promise.all(ids.map((id) => getUser(id)));
  return users.filter(Boolean).sort((a, b) => Number(b.lastSeen) - Number(a.lastSeen));
}

export async function getOnlineCount() {
  return redis.scard(ONLINE_SET);
}

export async function getOnlineUsers() {
  return (await redis.smembers(ONLINE_SET)) || [];
}

export async function getActivePages() {
  return (await redis.hgetall(PAGE_HASH)) || {};
}

export async function deleteUser(userId) {
  await redis.del(USER_KEY(userId));
  await redis.srem(USERS_SET, userId);
  await redis.srem(ONLINE_SET, userId);
  await redis.hdel(PAGE_HASH, userId);
  await redis.del(`sylent:chat:${userId}`);
  await deleteAllConversationMemory(userId);
}

export async function clearAllLogs() {
  const ids = (await redis.smembers(USERS_SET)) || [];
  await Promise.all(ids.map((id) => deleteUser(id)));
  await redis.del('sylent:stats:visitors');
  await redis.del('sylent:stats:ai_requests');
  await redis.del('sylent:stats:chat_total');
  await redis.del('sylent:unique_ips');
  return true;
}

/* ------------------------------------------------------------------ */
/* Chat logs (max 2 last conversations per user)                      */
/* ------------------------------------------------------------------ */

const CHAT_KEY = (userId) => `sylent:chat:${userId}`;
const MAX_CONVERSATIONS = 2;

/** Append a {user, assistant} exchange, keeping only the last N. */
export async function appendChatLog(userId, userMessage, assistantMessage) {
  const key = CHAT_KEY(userId);
  const entry = JSON.stringify({
    id: randomUUID(),
    user: userMessage,
    assistant: assistantMessage,
    timestamp: Date.now(),
  });

  await redis.rpush(key, entry);
  const len = await redis.llen(key);
  if (len > MAX_CONVERSATIONS) {
    await redis.ltrim(key, len - MAX_CONVERSATIONS, -1);
  }
}

export async function getChatLog(userId) {
  const raw = (await redis.lrange(CHAT_KEY(userId), 0, -1)) || [];
  return raw.map((r) => (typeof r === 'string' ? JSON.parse(r) : r));
}

export async function getAllChatLogs() {
  const ids = (await redis.smembers(USERS_SET)) || [];
  const result = {};
  for (const id of ids) {
    const log = await getChatLog(id);
    if (log.length) result[id] = log;
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* Global stats                                                       */
/* ------------------------------------------------------------------ */

export async function incrVisitor(ip) {
  await redis.incr('sylent:stats:visitors');
  await redis.sadd('sylent:unique_ips', ip);
}

export async function incrAiRequest() {
  await redis.incr('sylent:stats:ai_requests');
}

export async function incrChatTotal() {
  await redis.incr('sylent:stats:chat_total');
}

export async function getStats() {
  const [visitors, aiRequests, chatTotal, uniqueIps, onlineCount] = await Promise.all([
    redis.get('sylent:stats:visitors'),
    redis.get('sylent:stats:ai_requests'),
    redis.get('sylent:stats:chat_total'),
    redis.scard('sylent:unique_ips'),
    getOnlineCount(),
  ]);

  return {
    totalVisitor: Number(visitors || 0),
    totalAiRequest: Number(aiRequests || 0),
    totalChat: Number(chatTotal || 0),
    uniqueIps: Number(uniqueIps || 0),
    onlineUsers: Number(onlineCount || 0),
  };
}

/* ------------------------------------------------------------------ */
/* Admin sessions (server-side, cookie references an opaque token)    */
/* ------------------------------------------------------------------ */

const SESSION_KEY = (token) => `sylent:admin_session:${token}`;

/** Create a server-side session record with a TTL (seconds). */
export async function createAdminSession(token, ttlSeconds) {
  await redis.set(SESSION_KEY(token), JSON.stringify({ createdAt: Date.now() }), {
    ex: ttlSeconds,
  });
}

/** Returns true if the session token is valid and not expired. */
export async function isAdminSessionValid(token) {
  if (!token) return false;
  const data = await redis.get(SESSION_KEY(token));
  return !!data;
}

/** Sliding expiration: refresh TTL on activity so active admins stay logged in. */
export async function touchAdminSession(token, ttlSeconds) {
  if (!token) return;
  await redis.expire(SESSION_KEY(token), ttlSeconds);
}

export async function destroyAdminSession(token) {
  if (!token) return;
  await redis.del(SESSION_KEY(token));
}

/* ------------------------------------------------------------------ */
/* Conversation memory (per user + per conversation/session)          */
/* ------------------------------------------------------------------ */
/**
 * Unlike `sylent:chat:*` (an admin-facing log capped at the last 2
 * exchanges), this key-space holds the *full working memory* the AI uses
 * as context for a single conversation. It is scoped by both userId and
 * conversationId so every chat tab/session the user has keeps its own
 * independent memory. Entries never vanish on refresh — they only leave
 * the "raw" window once summarized, and the summary keeps their meaning.
 */

const CONVO_MESSAGES_KEY = (userId, conversationId) => `sylent:memory:${userId}:${conversationId}:messages`;
const CONVO_SUMMARY_KEY = (userId, conversationId) => `sylent:memory:${userId}:${conversationId}:summary`;
const CONVO_INDEX_KEY = (userId) => `sylent:memory:${userId}:conversations`;
const CONVO_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days of inactivity before Redis reclaims it

/** Appends one turn (role: 'user' | 'assistant') to a conversation's raw memory. */
export async function appendConversationMessage(userId, conversationId, role, content) {
  const key = CONVO_MESSAGES_KEY(userId, conversationId);
  const entry = JSON.stringify({ role, content, timestamp: Date.now() });

  await redis.rpush(key, entry);
  await redis.expire(key, CONVO_TTL_SECONDS);
  await redis.sadd(CONVO_INDEX_KEY(userId), conversationId);
  await redis.expire(CONVO_INDEX_KEY(userId), CONVO_TTL_SECONDS);
}

/** Raw (un-summarized) messages currently held for a conversation, oldest first. */
export async function getConversationMessages(userId, conversationId) {
  const raw = (await redis.lrange(CONVO_MESSAGES_KEY(userId, conversationId), 0, -1)) || [];
  return raw.map((r) => (typeof r === 'string' ? JSON.parse(r) : r));
}

/**
 * Drops the oldest `count` raw messages from memory — used right after
 * they've been folded into the rolling summary, so the context window
 * stays bounded no matter how long the conversation runs.
 */
export async function trimConversationMessages(userId, conversationId, count) {
  if (count <= 0) return;
  const key = CONVO_MESSAGES_KEY(userId, conversationId);
  const len = await redis.llen(key);
  if (len <= count) {
    await redis.del(key);
    return;
  }
  await redis.ltrim(key, count, -1);
}

/**
 * Drops the most recent `count` messages from memory — used on Regenerate
 * so the stale (user, assistant) pair being replaced doesn't linger in
 * context and get echoed back by the model.
 */
export async function trimLastConversationMessages(userId, conversationId, count) {
  if (count <= 0) return;
  const key = CONVO_MESSAGES_KEY(userId, conversationId);
  const len = await redis.llen(key);
  if (len <= count) {
    await redis.del(key);
    return;
  }
  await redis.ltrim(key, 0, len - count - 1);
}

/** Gets the rolling summary text for a conversation (empty string if none yet). */
export async function getConversationSummary(userId, conversationId) {
  const summary = await redis.get(CONVO_SUMMARY_KEY(userId, conversationId));
  return summary || '';
}

/** Replaces the rolling summary for a conversation. */
export async function setConversationSummary(userId, conversationId, summary) {
  const key = CONVO_SUMMARY_KEY(userId, conversationId);
  await redis.set(key, summary);
  await redis.expire(key, CONVO_TTL_SECONDS);
}

/** Deletes memory (messages + summary) for a single conversation. */
export async function deleteConversationMemory(userId, conversationId) {
  await redis.del(CONVO_MESSAGES_KEY(userId, conversationId));
  await redis.del(CONVO_SUMMARY_KEY(userId, conversationId));
  await redis.srem(CONVO_INDEX_KEY(userId), conversationId);
}

/** Deletes memory for every conversation belonging to a user (e.g. on account/user wipe). */
export async function deleteAllConversationMemory(userId) {
  const ids = (await redis.smembers(CONVO_INDEX_KEY(userId))) || [];
  await Promise.all(ids.map((id) => deleteConversationMemory(userId, id)));
  await redis.del(CONVO_INDEX_KEY(userId));
}

export default redis;
