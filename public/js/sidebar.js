/**
 * sidebar.js — manages the chat list stored client-side (localStorage):
 * create, rename, delete, switch active chat. Conversation *content* is
 * cached in localStorage too, for a snappy UI (server keeps last 2 as log).
 */
window.SylentSidebar = (function () {
  'use strict';

  const STORAGE_KEY = 'sylent_chats_v1';
  const chatListEl = document.getElementById('chatList');

  let state = load();
  let onSwitchCallback = null;

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* ignore */ }
    return { chats: [], activeId: null };
  }

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      // Quota exceeded (base64 attachments can be heavy) — drop older
      // attachment payloads but keep the text history intact, then retry.
      state.chats.forEach((c, idx) => {
        if (idx > 0) {
          c.messages.forEach((m) => {
            if (m.attachments) m.attachments = m.attachments.map((a) => ({ ...a, dataUrl: null }));
          });
        }
      });
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch (e2) {
        console.warn('[Sidebar] Unable to persist chat history (storage full).');
      }
    }
  }

  function uid() {
    return 'c-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function createChat(title) {
    const chat = { id: uid(), title: title || 'Percakapan baru', messages: [], createdAt: Date.now() };
    state.chats.unshift(chat);
    state.activeId = chat.id;
    persist();
    render();
    return chat;
  }

  function getActiveChat() {
    return state.chats.find((c) => c.id === state.activeId) || null;
  }

  function getChat(id) {
    return state.chats.find((c) => c.id === id) || null;
  }

  function switchChat(id) {
    state.activeId = id;
    persist();
    render();
    if (onSwitchCallback) onSwitchCallback(getChat(id));
  }

  function renameChat(id, newTitle) {
    const chat = getChat(id);
    if (chat && newTitle.trim()) {
      chat.title = newTitle.trim().slice(0, 60);
      persist();
      render();
    }
  }

  function deleteChat(id) {
    state.chats = state.chats.filter((c) => c.id !== id);
    if (state.activeId === id) {
      state.activeId = state.chats.length ? state.chats[0].id : null;
    }
    persist();
    render();

    // Also clear the AI's server-side conversation memory for this chat so
    // a deleted conversation never leaks context into a future one.
    fetch(`/ai/memory/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {});

    return getActiveChat();
  }

  function addMessage(chatId, role, content, attachments) {
    const chat = getChat(chatId);
    if (!chat) return;
    chat.messages.push({ role, content, attachments: attachments || undefined, ts: Date.now() });
    if (chat.messages.length === 1 && role === 'user') {
      const label = content || (attachments && attachments[0] ? attachments[0].name : 'Percakapan baru');
      chat.title = label.slice(0, 42) + (label.length > 42 ? '…' : '');
    }
    persist();
    render();
  }

  function updateLastMessage(chatId, content) {
    const chat = getChat(chatId);
    if (!chat || !chat.messages.length) return;
    chat.messages[chat.messages.length - 1].content = content;
    persist();
  }

  /** Replaces the last message of a given role (used by Regenerate to swap the AI's answer in place). */
  function replaceLastMessage(chatId, role, content) {
    const chat = getChat(chatId);
    if (!chat || !chat.messages.length) return;
    for (let i = chat.messages.length - 1; i >= 0; i--) {
      if (chat.messages[i].role === role) {
        chat.messages[i] = { ...chat.messages[i], content, ts: Date.now() };
        persist();
        return;
      }
    }
    // No existing message of that role — fall back to appending.
    addMessage(chatId, role, content);
  }

  function render() {
    chatListEl.innerHTML = '';
    if (!state.chats.length) {
      const empty = document.createElement('div');
      empty.style.cssText = 'padding:16px 10px;color:var(--text-faint);font-size:12.5px;';
      empty.textContent = 'Belum ada percakapan.';
      chatListEl.appendChild(empty);
      return;
    }

    state.chats.forEach((chat) => {
      const item = document.createElement('div');
      item.className = 'chat-item' + (chat.id === state.activeId ? ' active' : '');
      item.dataset.id = chat.id;

      const title = document.createElement('span');
      title.className = 'chat-item-title';
      title.textContent = chat.title;

      const menuBtn = document.createElement('button');
      menuBtn.className = 'chat-item-menu-btn';
      menuBtn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14"><circle cx="5" cy="12" r="2" fill="currentColor"/><circle cx="12" cy="12" r="2" fill="currentColor"/><circle cx="19" cy="12" r="2" fill="currentColor"/></svg>';

      menuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openItemMenu(chat, item, menuBtn);
      });

      item.appendChild(title);
      item.appendChild(menuBtn);
      item.addEventListener('click', () => switchChat(chat.id));
      chatListEl.appendChild(item);
    });
  }

  function openItemMenu(chat, item, anchorBtn) {
    document.querySelectorAll('.chat-item-menu').forEach((m) => m.remove());

    const menu = document.createElement('div');
    menu.className = 'chat-item-menu';
    menu.innerHTML = `
      <button data-act="rename">
        <svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75zM20.71 7.04a1 1 0 000-1.41l-2.34-2.34a1 1 0 00-1.41 0l-1.83 1.83 3.75 3.75z"/></svg>
        Rename
      </button>
      <button data-act="delete" class="danger">
        <svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6zM19 4h-3.5l-1-1h-5l-1 1H5v2h14z"/></svg>
        Delete
      </button>
    `;
    item.appendChild(menu);

    menu.querySelector('[data-act="rename"]').addEventListener('click', (e) => {
      e.stopPropagation();
      menu.remove();
      startRename(chat, item);
    });
    menu.querySelector('[data-act="delete"]').addEventListener('click', (e) => {
      e.stopPropagation();
      menu.remove();
      const nextActive = deleteChat(chat.id);
      if (onSwitchCallback) onSwitchCallback(nextActive);
    });

    setTimeout(() => {
      document.addEventListener('click', function handler() {
        menu.remove();
        document.removeEventListener('click', handler);
      });
    });
  }

  function startRename(chat, item) {
    const titleEl = item.querySelector('.chat-item-title');
    const input = document.createElement('input');
    input.className = 'chat-item-rename-input';
    input.value = chat.title;
    titleEl.replaceWith(input);
    input.focus();
    input.select();

    function commit() {
      renameChat(chat.id, input.value || chat.title);
    }
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      if (e.key === 'Escape') render();
    });
    input.addEventListener('blur', commit);
  }

  function onSwitch(cb) { onSwitchCallback = cb; }

  render();

  return {
    createChat,
    getActiveChat,
    getChat,
    switchChat,
    renameChat,
    deleteChat,
    addMessage,
    updateLastMessage,
    replaceLastMessage,
    onSwitch,
    render,
  };
})();
