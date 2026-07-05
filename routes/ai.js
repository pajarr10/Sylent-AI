/**
 * AI chat route — proxies prompts to the upstream Sylent 0.1 (Claude) API,
 * logs the exchange, and emits realtime stats to the admin dashboard.
 *
 * Conversation memory: the upstream API only accepts a single `text` param
 * (no native multi-turn/messages support), so we implement context/memory
 * ourselves — every turn is stored per user+conversation in Redis, and a
 * bounded window of that history (plus a rolling summary once it grows too
 * long) is stitched into the prompt we send upstream. This lets the model
 * understand follow-ups like "lanjut", "itu gimana", "contohnya", etc.
 */
import { Router } from 'express';
import { validatePrompt, sanitizeText } from '../middleware/security.js';
import {
  appendChatLog,
  incrAiRequest,
  incrChatTotal,
  appendConversationMessage,
  getConversationMessages,
  trimConversationMessages,
  trimLastConversationMessages,
  getConversationSummary,
  setConversationSummary,
  deleteConversationMemory,
} from '../database/redis.js';

const router = Router();
const AI_API_BASE = process.env.AI_API_BASE || 'https://api.synoxcloud.xyz/ai-chat/claude-opus-4.8';

// Strips emoji / pictograph characters from upstream AI replies so the UI
// (chat, admin chat logs, exports) never surfaces them.
const EMOJI_PATTERN = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{2190}-\u{21FF}\u{FE0F}\u{200D}]/gu;
function stripEmoji(text) {
  return String(text || '').replace(EMOJI_PATTERN, '').replace(/[ \t]{2,}/g, ' ').trim();
}

/* ------------------------------------------------------------------ */
/* Context window configuration                                       */
/* ------------------------------------------------------------------ */
const RAW_MESSAGE_LIMIT = 12; // trigger summarization once raw history exceeds this many turns
const KEEP_RECENT_MESSAGES = 6; // turns kept verbatim after summarizing older ones
const MAX_CONTEXT_CHARS = 6000; // hard cap on the assembled context block sent upstream
const DEFAULT_CONVERSATION_ID = 'default';

/** Validates/sanitizes the conversationId so it's safe to use as a Redis key segment. */
function resolveConversationId(raw) {
  const value = sanitizeText(raw, 100).replace(/[^a-zA-Z0-9_-]/g, '');
  return value || DEFAULT_CONVERSATION_ID;
}

/** Calls the upstream text-only AI API with a raw prompt and returns the cleaned reply text. */
async function callUpstream(prompt) {
  const upstreamUrl = `${AI_API_BASE}?pesan=${encodeURIComponent(prompt)}`;
  const upstreamRes = await fetch(upstreamUrl);

  if (!upstreamRes.ok) {
    throw new Error(`Upstream responded with ${upstreamRes.status}`);
  }

  const data = await upstreamRes.json().catch(async () => {
    const txt = await upstreamRes.text();
    return { result: txt };
  });

  return data.result || data.message || data.answer || data.response || data.data || JSON.stringify(data);
}

/**
 * Folds the oldest messages of a conversation into its rolling summary via
 * the same upstream model, then trims them out of raw storage — keeping the
 * context window bounded no matter how long a conversation runs. Falls back
 * to a plain-text summary if the upstream summarization call fails, so
 * memory never silently breaks.
 */
async function maybeSummarizeConversation(userId, conversationId) {
  const messages = await getConversationMessages(userId, conversationId);
  if (messages.length <= RAW_MESSAGE_LIMIT) return;

  const toSummarize = messages.slice(0, messages.length - KEEP_RECENT_MESSAGES);
  if (!toSummarize.length) return;

  const existingSummary = await getConversationSummary(userId, conversationId);
  const transcript = toSummarize
    .map((m) => `${m.role === 'user' ? 'User' : 'Sylent AI'}: ${m.content}`)
    .join('\n');

  let newSummary;
  try {
    const summarizePrompt =
      `Ringkas percakapan berikut menjadi poin-poin penting yang singkat dan padat ` +
      `(maksimal 150 kata). Pertahankan fakta, nama, angka, keputusan, dan konteks penting ` +
      `yang mungkin dibutuhkan untuk menjawab pertanyaan lanjutan.` +
      (existingSummary ? `\n\nRingkasan sebelumnya:\n${existingSummary}` : '') +
      `\n\nPercakapan yang perlu diringkas:\n${transcript}` +
      `\n\nTulis hanya ringkasannya saja, tanpa kalimat pembuka atau penutup.`;

    const rawSummary = await callUpstream(summarizePrompt);
    newSummary = stripEmoji(rawSummary).slice(0, 2000);
  } catch (err) {
    console.warn('[AI Route] Summarization upstream call failed, using fallback:', err.message);
    // Fallback: naive concatenation so context isn't lost even if the
    // summarization call itself fails (e.g. upstream hiccup).
    const fallback = toSummarize.map((m) => `${m.role === 'user' ? 'U' : 'A'}: ${m.content}`).join(' | ');
    newSummary = `${existingSummary ? existingSummary + ' ' : ''}${fallback}`.slice(-2000);
  }

  await setConversationSummary(userId, conversationId, newSummary);
  await trimConversationMessages(userId, conversationId, toSummarize.length);
}

/** Assembles the final prompt sent upstream: summary + recent turns + the new question. */
function buildContextualPrompt(summary, recentMessages, newPrompt) {
  const sections = [];

  if (summary) {
    sections.push(`[Ringkasan percakapan sebelumnya]\n${summary}`);
  }

  if (recentMessages.length) {
    const transcript = recentMessages
      .map((m) => `${m.role === 'user' ? 'User' : 'Sylent AI'}: ${m.content}`)
      .join('\n');
    sections.push(`[Percakapan terakhir]\n${transcript}`);
  }

  sections.push(`[Pertanyaan baru dari pengguna]\n${newPrompt}`);

  let assembled = sections.join('\n\n');

  // Hard cap: if still too long, progressively drop the oldest sections
  // (summary first, since recent turns matter more for immediate follow-ups).
  if (assembled.length > MAX_CONTEXT_CHARS && summary) {
    assembled = sections.slice(1).join('\n\n');
  }
  if (assembled.length > MAX_CONTEXT_CHARS) {
    assembled = assembled.slice(-MAX_CONTEXT_CHARS);
  }

  // No history at all — just send the plain question, unchanged from before.
  if (!summary && !recentMessages.length) {
    return newPrompt;
  }

  return (
    `Kamu adalah Sylent AI. Berikut konteks percakapan sebelumnya dengan pengguna ini. ` +
    `Gunakan konteks ini untuk memahami pertanyaan lanjutan (seperti "lanjut", "terus", ` +
    `"itu gimana", "yang tadi", "contohnya", dsb.) dan jawab HANYA pertanyaan baru di bagian ` +
    `paling akhir, secara langsung tanpa mengulang seluruh riwayat.\n\n${assembled}`
  );
}

router.get('/claude', validatePrompt, async (req, res) => {
  const prompt = sanitizeText(req.query.text, 4000);
  const conversationId = resolveConversationId(req.query.conversationId);
  const isRegenerate = req.query.regenerate === '1' || req.query.regenerate === 'true';
  // Optional attachment metadata (filename/type only — the upstream API has
  // no vision support, so we can't send image bytes, but we let the model
  // know a file was attached so its reply stays coherent).
  const attachmentNote = sanitizeText(req.query.attachments || '', 500);
  const promptForModel = attachmentNote ? `${prompt}\n\n[Lampiran: ${attachmentNote}]` : prompt;

  try {
    // On regenerate, drop the previous (user, assistant) pair for this exact
    // prompt from memory first so the stale answer doesn't leak into context
    // or get echoed back verbatim by the model.
    if (isRegenerate) {
      await trimLastConversationMessages(req.userId, conversationId, 2);
    }

    // Keep the context window bounded before building this turn's prompt.
    await maybeSummarizeConversation(req.userId, conversationId);

    const [summary, recentMessages] = await Promise.all([
      getConversationSummary(req.userId, conversationId),
      getConversationMessages(req.userId, conversationId),
    ]);

    const contextualPrompt = buildContextualPrompt(summary, recentMessages, promptForModel);
    const rawReply = await callUpstream(contextualPrompt);
    const reply = stripEmoji(rawReply);

    await incrAiRequest();
    await incrChatTotal();
    await appendChatLog(req.userId, prompt, reply);

    // Persist this turn into the conversation's working memory so future
    // requests (and follow-up questions) have it as context.
    await appendConversationMessage(req.userId, conversationId, 'user', promptForModel);
    await appendConversationMessage(req.userId, conversationId, 'assistant', reply);

    res.json({ ok: true, model: 'Sylent 0.1', result: reply, conversationId });
  } catch (err) {
    console.error('[AI Route] Error:', err.message);
    res.status(502).json({
      ok: false,
      error: 'Failed to reach Sylent 0.1 upstream service.',
      detail: err.message,
    });
  }
});

/** Clears server-side conversation memory — called when a chat is deleted client-side. */
router.delete('/memory/:conversationId', async (req, res) => {
  try {
    const conversationId = resolveConversationId(req.params.conversationId);
    await deleteConversationMemory(req.userId, conversationId);
    res.json({ ok: true });
  } catch (err) {
    console.error('[AI Route] Failed to clear conversation memory:', err.message);
    res.status(500).json({ ok: false, error: 'Internal Server Error' });
  }
});

export default router;
