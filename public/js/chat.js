/**
 * chat.js — chat engine: sends prompts to the AI endpoint, renders bubbles,
 * simulates typing animation, handles copy/regenerate/stop.
 */
window.SylentChat = (function () {
  'use strict';

  const messagesEl = document.getElementById('messages');
  const welcomeScreen = document.getElementById('welcomeScreen');
  const chatArea = document.getElementById('chatArea');
  const sendBtn = document.getElementById('sendBtn');
  const stopBtn = document.getElementById('stopBtn');

  let isGenerating = false;
  let abortController = null;
  let lastUserPrompt = null;
  let lastAttachments = [];
  let typingTimer = null;

  const THINKING_STATUSES = [
    'Sylent AI sedang berpikir...',
    'Menganalisis pertanyaan...',
    'Menyusun jawaban...',
    'Memproses informasi...',
    'Menyiapkan respons...',
    'Hampir selesai...',
  ];

  function scrollToBottom(smooth) {
    chatArea.scrollTo({ top: chatArea.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  }

  function toggleWelcome(show) {
    welcomeScreen.style.display = show ? 'block' : 'none';
  }

  function createMsgRow(role) {
    const row = document.createElement('div');
    row.className = `msg-row ${role}`;

    const avatar = document.createElement('div');
    avatar.className = 'msg-avatar';
    avatar.textContent = role === 'user' ? 'U' : 'S';

    const wrap = document.createElement('div');
    wrap.className = 'msg-bubble-wrap';

    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble';

    wrap.appendChild(bubble);
    row.appendChild(avatar);
    row.appendChild(wrap);
    messagesEl.appendChild(row);

    return { row, bubble, wrap };
  }

  const ICON_COPY = '<svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M16 1H4a2 2 0 00-2 2v14h2V3h12zm3 4H8a2 2 0 00-2 2v14a2 2 0 002 2h11a2 2 0 002-2V7a2 2 0 00-2-2zm0 16H8V7h11z"/></svg>';
  const ICON_CHECK = '<svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>';
  const ICON_REGENERATE = '<svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M17.65 6.35A8 8 0 106.35 17.65 8 8 0 0017.65 6.35zM12 5V1L7 6l5 5V7a5 5 0 11-5 5H5a7 7 0 107-7z"/></svg>';

  function addActionBar(wrap, { onCopy, onRegenerate } = {}) {
    const bar = document.createElement('div');
    bar.className = 'msg-actions';

    const copyBtn = document.createElement('button');
    copyBtn.className = 'msg-action-btn';
    copyBtn.innerHTML = `${ICON_COPY} Copy`;
    copyBtn.addEventListener('click', () => {
      onCopy();
      copyBtn.innerHTML = `${ICON_CHECK} Disalin`;
      setTimeout(() => (copyBtn.innerHTML = `${ICON_COPY} Copy`), 1500);
    });
    bar.appendChild(copyBtn);

    if (onRegenerate) {
      const regenBtn = document.createElement('button');
      regenBtn.className = 'msg-action-btn';
      regenBtn.innerHTML = `${ICON_REGENERATE} Regenerate`;
      regenBtn.addEventListener('click', onRegenerate);
      bar.appendChild(regenBtn);
    }

    wrap.appendChild(bar);
    return bar;
  }

  const ICON_FILE_SMALL = '<svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M6 2h9l5 5v15H6zm8 1.5V8h4.5z"/></svg>';

  function renderAttachments(container, attachments) {
    if (!attachments || !attachments.length) return;
    const tray = document.createElement('div');
    tray.className = 'msg-attachments';
    attachments.forEach((att) => {
      if (att.isImage && att.dataUrl) {
        const img = document.createElement('img');
        img.className = 'msg-attachment-image';
        img.src = att.dataUrl;
        img.alt = att.name;
        img.addEventListener('click', () => window.open(att.dataUrl, '_blank'));
        tray.appendChild(img);
      } else if (att.dataUrl) {
        const chip = document.createElement('div');
        chip.className = 'msg-attachment-file';
        chip.innerHTML = `${ICON_FILE_SMALL} <a href="${att.dataUrl}" download="${SylentMarkdown.escapeHtml(att.name)}">${SylentMarkdown.escapeHtml(att.name)}</a>`;
        tray.appendChild(chip);
      } else {
        const chip = document.createElement('div');
        chip.className = 'msg-attachment-file';
        chip.innerHTML = `${ICON_FILE_SMALL} <span>${SylentMarkdown.escapeHtml(att.name)}</span>`;
        tray.appendChild(chip);
      }
    });
    container.appendChild(tray);
  }

  function renderUserMessage(text, attachments) {
    const { bubble } = createMsgRow('user');
    renderAttachments(bubble, attachments);
    if (text) {
      const textEl = document.createElement('div');
      textEl.textContent = text;
      bubble.appendChild(textEl);
    }
    scrollToBottom(true);
  }

  function attachCodeBlockHandlers(bubble) {
    bubble.querySelectorAll('[data-action="copy"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const code = SylentMarkdown.getRawCode(btn.dataset.target);
        navigator.clipboard.writeText(code).then(() => {
          const original = btn.textContent;
          btn.textContent = 'Copied!';
          setTimeout(() => (btn.textContent = original), 1500);
        });
      });
    });

    bubble.querySelectorAll('[data-action="preview"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const code = SylentMarkdown.getRawCode(btn.dataset.target);
        const block = btn.closest('.code-block');
        const lang = block ? block.dataset.lang : 'html';
        SylentPreview.open(code, lang);
      });
    });
  }

  /**
   * Shows a "Sylent AI is thinking" bubble immediately after the user sends
   * a message, so the chat area never sits idle while waiting on the API.
   * Returns a handle with `resolveToAnswer()` / `resolveToError()` so the
   * caller can morph this same bubble into the final result without any
   * flash/flicker (no bubble is removed+re-added on success).
   */
  function showThinkingBubble() {
    const row = document.createElement('div');
    row.className = 'msg-row assistant thinking';

    const avatar = document.createElement('div');
    avatar.className = 'msg-avatar';
    avatar.textContent = 'S';

    const wrap = document.createElement('div');
    wrap.className = 'msg-bubble-wrap';

    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble';
    bubble.innerHTML = `
      <div class="thinking-bubble">
        <div class="thinking-wave"><span></span><span></span><span></span><span></span></div>
        <span class="thinking-status"><span class="thinking-status-text">${THINKING_STATUSES[0]}</span></span>
      </div>
    `;

    wrap.appendChild(bubble);
    row.appendChild(avatar);
    row.appendChild(wrap);
    messagesEl.appendChild(row);
    scrollToBottom(true);

    // Cycle through status phrases with a smooth fade transition.
    let statusIndex = 0;
    const statusEl = bubble.querySelector('.thinking-status-text');
    const statusTimer = setInterval(() => {
      statusIndex = (statusIndex + 1) % THINKING_STATUSES.length;
      if (!statusEl.isConnected) return clearInterval(statusTimer);
      statusEl.style.animation = 'none';
      // eslint-disable-next-line no-unused-expressions
      statusEl.offsetHeight; // force reflow to restart the fade animation
      statusEl.textContent = THINKING_STATUSES[statusIndex];
      statusEl.style.animation = '';
    }, 2400);

    function stop() {
      clearInterval(statusTimer);
    }

    return {
      row,
      bubble,
      wrap,
      /** Morphs the thinking bubble into the final assistant answer in place. */
      resolveToAnswer(rawText, { onRegenerate } = {}) {
        stop();
        row.classList.remove('thinking');
        return renderAssistantMessageInto({ row, bubble, wrap }, rawText, { onRegenerate });
      },
      /** Morphs the thinking bubble directly into an error state, no flicker. */
      resolveToError(message, { onRegenerate } = {}) {
        stop();
        row.classList.remove('thinking');
        bubble.classList.add('error-bubble');
        bubble.innerHTML = `
          <div class="error-bubble-content">
            <svg viewBox="0 0 24 24" width="18" height="18" style="flex-shrink:0;"><path fill="currentColor" d="M12 2L1 21h22zm0 4.5L19.5 19h-15zM11 10h2v5h-2zm0 6h2v2h-2z"/></svg>
            <span>${SylentMarkdown.escapeHtml(message)}</span>
          </div>
        `;
        addActionBar(wrap, {
          onCopy: () => navigator.clipboard.writeText(message),
          onRegenerate,
        });
        scrollToBottom(false);
      },
      remove() {
        stop();
        row.classList.add('leaving');
        setTimeout(() => row.remove(), 250);
      },
    };
  }

  /** Renders assistant reply progressively (typing effect) then finalizes markdown. */
  function renderAssistantMessageInto({ row, bubble, wrap }, rawText, { instant = false, onRegenerate } = {}) {
    const fullText = SylentMarkdown.stripEmoji(rawText);
    bubble.innerHTML = '';

    return new Promise((resolve) => {
      if (instant) {
        finalize();
      } else {
        typeOut();
      }

      function typeOut() {
        let i = 0;
        const chunkSize = Math.max(2, Math.floor(fullText.length / 120));
        typingTimer = setInterval(() => {
          i += chunkSize;
          const partial = fullText.slice(0, i);
          bubble.innerHTML = SylentMarkdown.render(partial);
          scrollToBottom(false);
          if (i >= fullText.length) {
            clearInterval(typingTimer);
            finalize();
          }
        }, 14);
      }

      function finalize() {
        bubble.innerHTML = SylentMarkdown.render(fullText);
        if (window.hljs) bubble.querySelectorAll('pre code').forEach((el) => hljs.highlightElement(el));
        attachCodeBlockHandlers(bubble);
        addActionBar(wrap, {
          onCopy: () => navigator.clipboard.writeText(fullText),
          onRegenerate,
        });
        scrollToBottom(true);
        resolve();
      }
    });
  }

  /** Renders a finished assistant message directly (used when restoring chat history). */
  function renderAssistantMessage(rawText, { instant = false, onRegenerate } = {}) {
    const rowHandle = createMsgRow('assistant');
    return renderAssistantMessageInto(rowHandle, rawText, { instant, onRegenerate });
  }

  function setGenerating(state) {
    isGenerating = state;
    sendBtn.classList.toggle('is-loading', state);
    sendBtn.disabled = state;
    stopBtn.classList.toggle('hidden', !state);
  }

  async function sendPrompt(prompt, chatId, attachments = [], options = {}) {
    const { isRegenerate = false } = options;
    if (isGenerating || (!prompt.trim() && !attachments.length)) return;

    toggleWelcome(false);
    if (!isRegenerate) {
      // On a fresh send, render + persist the user's turn. On regenerate the
      // user bubble already exists (we're only replacing the AI's answer),
      // so we skip this to avoid duplicating it in history/context.
      renderUserMessage(prompt, attachments);
      SylentSidebar.addMessage(chatId, 'user', prompt, attachments);
    }
    lastUserPrompt = prompt;
    lastAttachments = attachments;

    setGenerating(true);
    abortController = new AbortController();

    // Show the thinking bubble immediately — the chat area never sits idle
    // while the request is in flight.
    const thinking = showThinkingBubble();

    try {
      const attachmentNote = attachments.length
        ? attachments.map((a) => `${a.name} (${a.isImage ? 'gambar' : 'file'})`).join(', ')
        : '';
      // `chatId` doubles as the conversationId so the backend keeps a
      // separate memory/context per chat tab — this is what lets the AI
      // understand follow-ups like "lanjut" / "itu gimana" / "contohnya".
      const qs = new URLSearchParams({ text: prompt || '(lihat lampiran)', conversationId: chatId });
      if (attachmentNote) qs.set('attachments', attachmentNote);
      if (isRegenerate) qs.set('regenerate', '1');

      const res = await fetch(`/ai/claude?${qs.toString()}`, {
        signal: abortController.signal,
      });
      const data = await res.json();

      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Gagal mendapatkan respons dari Sylent 0.1');
      }

      await thinking.resolveToAnswer(data.result, {
        onRegenerate: () => regenerate(chatId),
      });
      if (isRegenerate) {
        SylentSidebar.replaceLastMessage(chatId, 'assistant', data.result);
      } else {
        SylentSidebar.addMessage(chatId, 'assistant', data.result);
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        thinking.resolveToError('Generasi dihentikan oleh pengguna.');
      } else {
        thinking.resolveToError('Gagal mendapatkan respons. Silakan coba lagi.', {
          onRegenerate: () => regenerate(chatId),
        });
      }
    } finally {
      setGenerating(false);
      abortController = null;
    }
  }

  function regenerate(chatId) {
    if (!lastUserPrompt && !lastAttachments.length) return;
    // remove last assistant row visually
    const rows = messagesEl.querySelectorAll('.msg-row.assistant');
    if (rows.length) rows[rows.length - 1].remove();
    sendPrompt(lastUserPrompt, chatId, lastAttachments, { isRegenerate: true });
  }

  function stopGenerate() {
    if (abortController) abortController.abort();
  }

  function clearMessages() {
    messagesEl.innerHTML = '';
    toggleWelcome(true);
  }

  function loadChatHistory(chat) {
    clearMessages();
    if (!chat || !chat.messages.length) {
      toggleWelcome(true);
      return;
    }
    toggleWelcome(false);
    chat.messages.forEach((m) => {
      if (m.role === 'user') {
        renderUserMessage(m.content, m.attachments);
      } else {
        renderAssistantMessage(m.content, { instant: true, onRegenerate: () => regenerate(chat.id) });
      }
    });
    scrollToBottom(false);
  }

  stopBtn.addEventListener('click', stopGenerate);

  return { sendPrompt, regenerate, stopGenerate, loadChatHistory, clearMessages };
})();
