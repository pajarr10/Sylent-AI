/**
 * app.js — wires up the UI: composer input, sidebar toggle, new chat,
 * suggestion cards.
 */
(function () {
  'use strict';

  const promptInput = document.getElementById('promptInput');
  const sendBtn = document.getElementById('sendBtn');
  const newChatBtn = document.getElementById('newChatBtn');
  const sidebar = document.getElementById('sidebar');
  const sidebarOverlay = document.getElementById('sidebarOverlay');
  const openSidebarBtn = document.getElementById('openSidebarBtn');
  const collapseSidebarBtn = document.getElementById('collapseSidebarBtn');

  /* ---------------- Composer ---------------- */
  function autoResize() {
    promptInput.style.height = 'auto';
    promptInput.style.height = Math.min(promptInput.scrollHeight, 200) + 'px';
  }
  promptInput.addEventListener('input', autoResize);

  function ensureActiveChat() {
    let chat = SylentSidebar.getActiveChat();
    if (!chat) chat = SylentSidebar.createChat('Percakapan baru');
    return chat;
  }

  function handleSend() {
    const text = promptInput.value.trim();
    const attachments = SylentAttachments.getPending();
    if (!text && !attachments.length) return;
    const chat = ensureActiveChat();
    promptInput.value = '';
    autoResize();
    SylentAttachments.clear();
    SylentChat.sendPrompt(text, chat.id, attachments);
  }

  sendBtn.addEventListener('click', handleSend);
  promptInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });

  /* ---------------- Suggestion cards ---------------- */
  document.querySelectorAll('.suggestion-card').forEach((card) => {
    card.addEventListener('click', () => {
      const prompt = card.dataset.prompt;
      const chat = ensureActiveChat();
      SylentChat.sendPrompt(prompt, chat.id);
    });
  });

  /* ---------------- New chat ---------------- */
  newChatBtn.addEventListener('click', () => {
    SylentSidebar.createChat('Percakapan baru');
    SylentChat.clearMessages();
    promptInput.focus();
    closeSidebarMobile();
  });

  /* ---------------- Sidebar switch ---------------- */
  SylentSidebar.onSwitch((chat) => {
    SylentChat.loadChatHistory(chat);
    closeSidebarMobile();
  });

  const activeChat = SylentSidebar.getActiveChat();
  if (activeChat && activeChat.messages.length) {
    SylentChat.loadChatHistory(activeChat);
  }

  /* ---------------- Mobile sidebar toggle ---------------- */
  function openSidebarMobile() {
    sidebar.classList.add('open');
    sidebarOverlay.classList.add('open');
  }
  function closeSidebarMobile() {
    sidebar.classList.remove('open');
    sidebarOverlay.classList.remove('open');
  }
  openSidebarBtn?.addEventListener('click', openSidebarMobile);
  collapseSidebarBtn?.addEventListener('click', closeSidebarMobile);
  sidebarOverlay?.addEventListener('click', closeSidebarMobile);
})();
