/**
 * admin.js — Sylent AI Admin Panel logic.
 * Authentication is entirely session/cookie based: the admin key is only
 * ever sent once (POST /atmin/api/auth/login) and never stored in
 * localStorage or the URL. All subsequent requests rely on the HttpOnly
 * session cookie automatically sent by the browser.
 */
(function () {
  'use strict';

  const loginScreen = document.getElementById('loginScreen');
  const dashboard = document.getElementById('dashboard');
  const loginForm = document.getElementById('loginForm');
  const adminKeyInput = document.getElementById('adminKeyInput');
  const loginError = document.getElementById('loginError');
  const loginBtn = document.getElementById('loginBtn');

  function api(path, options = {}) {
    return fetch(path, {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options,
    });
  }

  function showLogin(message) {
    dashboard.classList.add('hidden');
    loginScreen.classList.remove('hidden');
    if (message) {
      loginError.textContent = message;
      loginError.classList.remove('hidden');
    }
  }

  function showDashboard() {
    loginScreen.classList.add('hidden');
    dashboard.classList.remove('hidden');
  }

  function setLoginLoading(isLoading) {
    loginBtn.disabled = isLoading;
    loginBtn.querySelector('.login-btn-label').textContent = isLoading ? 'Memeriksa...' : 'Login';
    loginBtn.querySelector('.login-spinner').classList.toggle('hidden', !isLoading);
  }

  /* ---------------- Login / Logout ---------------- */
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginError.classList.add('hidden');
    setLoginLoading(true);

    try {
      const res = await api('/atmin/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ key: adminKeyInput.value }),
      });
      const data = await res.json();

      if (!res.ok || !data.ok) {
        loginError.textContent = data.error || 'Admin key salah.';
        loginError.classList.remove('hidden');
        adminKeyInput.focus();
        adminKeyInput.select();
        return;
      }

      adminKeyInput.value = '';
      showDashboard();
      bootDashboard();
    } catch (err) {
      loginError.textContent = 'Gagal terhubung ke server. Coba lagi.';
      loginError.classList.remove('hidden');
    } finally {
      setLoginLoading(false);
    }
  });

  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await api('/atmin/api/auth/logout', { method: 'POST' });
    stopPolling();
    showLogin();
  });

  async function checkSession() {
    try {
      const res = await api('/atmin/api/auth/me');
      const data = await res.json();
      return !!data.loggedIn;
    } catch (err) {
      return false;
    }
  }

  /* ---------------- Mobile sidebar ---------------- */
  const sidebar = document.querySelector('.admin-sidebar');
  const sidebarOverlay = document.getElementById('adminSidebarOverlay');
  document.getElementById('mobileNavBtn')?.addEventListener('click', () => {
    sidebar.classList.add('open');
    sidebarOverlay.classList.add('open');
  });
  sidebarOverlay?.addEventListener('click', () => {
    sidebar.classList.remove('open');
    sidebarOverlay.classList.remove('open');
  });

  /* ---------------- Tabs ---------------- */
  const tabTitles = { overview: 'Overview', users: 'Users', chats: 'Chat Logs', pages: 'Halaman Aktif' };
  document.querySelectorAll('.admin-nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.admin-nav-btn').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.admin-tab').forEach((t) => t.classList.add('hidden'));
      btn.classList.add('active');
      const tab = btn.dataset.tab;
      document.getElementById('tab-' + tab).classList.remove('hidden');
      document.getElementById('tabTitle').textContent = tabTitles[tab];
      if (tab === 'users') loadUsers();
      if (tab === 'chats') loadChats();
      if (tab === 'pages') loadStats();
      sidebar.classList.remove('open');
      sidebarOverlay.classList.remove('open');
    });
  });

  /* ---------------- Stats ---------------- */
  async function loadStats() {
    const res = await api('/atmin/api/stats');
    if (res.status === 403) return handleSessionExpired();
    if (!res.ok) return;
    const { stats, activePages } = await res.json();
    renderStats(stats);
    renderActivePages(activePages);
  }

  function renderStats(stats) {
    document.getElementById('statOnline').textContent = stats.onlineUsers ?? 0;
    document.getElementById('statVisitor').textContent = stats.totalVisitor ?? 0;
    document.getElementById('statAiRequest').textContent = stats.totalAiRequest ?? 0;
    document.getElementById('statChat').textContent = stats.totalChat ?? 0;
    document.getElementById('statUniqueIp').textContent = stats.uniqueIps ?? 0;
  }

  function renderActivePages(activePages) {
    const counts = {};
    Object.values(activePages || {}).forEach((page) => {
      counts[page] = (counts[page] || 0) + 1;
    });
    const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const containers = [document.getElementById('activePagesList'), document.getElementById('pagesDistribution')];
    containers.forEach((container) => {
      if (!container) return;
      container.innerHTML = entries.length
        ? entries.map(([page, count]) => `
            <div class="active-page-row"><span>${escapeHtml(page)}</span><span class="count">${count} user</span></div>
          `).join('')
        : '<div class="active-page-row"><span>Tidak ada aktivitas</span></div>';
    });
  }

  /* ---------------- Skeleton loading ---------------- */
  function renderTableSkeleton(tbody, cols, rows = 5) {
    tbody.innerHTML = Array.from({ length: rows })
      .map(() => `<tr class="skeleton-row">${Array.from({ length: cols }).map(() => `<td><div class="skeleton-bar"></div></td>`).join('')}</tr>`)
      .join('');
  }

  /* ---------------- Users ---------------- */
  async function loadUsers() {
    const tbody = document.getElementById('usersTableBody');
    renderTableSkeleton(tbody, 9);

    const search = document.getElementById('searchUser').value;
    const browser = document.getElementById('filterBrowser').value;
    const device = document.getElementById('filterDevice').value;
    const country = document.getElementById('filterCountry').value;
    const page = document.getElementById('filterPage').value;

    const qs = new URLSearchParams({ search, browser, device, country, page });
    const res = await api(`/atmin/api/users?${qs.toString()}`);
    if (res.status === 403) return handleSessionExpired();
    if (!res.ok) return;
    const { users } = await res.json();
    renderUsersTable(users);
  }

  function renderUsersTable(users) {
    const tbody = document.getElementById('usersTableBody');
    if (!users.length) {
      tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:var(--text-faint);">Tidak ada data user.</td></tr>';
      return;
    }
    tbody.innerHTML = users.map((u) => `
      <tr data-id="${escapeHtml(u.id)}">
        <td><span class="badge ${u.status === 'online' ? 'online' : 'offline'}"><span class="badge-dot"></span>${u.status === 'online' ? 'Online' : 'Offline'}</span></td>
        <td>${escapeHtml(u.ip)}</td>
        <td>${escapeHtml(u.browser)}</td>
        <td>${escapeHtml(u.os)}</td>
        <td>${escapeHtml(u.device)}</td>
        <td>${escapeHtml(u.country)}</td>
        <td>${escapeHtml(u.page)}</td>
        <td>${formatTime(u.lastSeen)}</td>
        <td>
          <button class="admin-btn" data-act="detail">Detail</button>
          <button class="admin-btn danger" data-act="delete">Hapus</button>
        </td>
      </tr>
    `).join('');

    tbody.querySelectorAll('[data-act="detail"]').forEach((btn) => {
      btn.addEventListener('click', (e) => showUserDetail(e.target.closest('tr').dataset.id));
    });
    tbody.querySelectorAll('[data-act="delete"]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        const id = e.target.closest('tr').dataset.id;
        if (confirm('Hapus data user ini?')) {
          await api(`/atmin/api/users/${id}`, { method: 'DELETE' });
          loadUsers();
          loadStats();
        }
      });
    });
  }

  async function showUserDetail(id) {
    const res = await api(`/atmin/api/users/${id}`);
    if (res.status === 403) return handleSessionExpired();
    if (!res.ok) return;
    const { user, chat } = await res.json();
    const body = document.getElementById('userDetailBody');
    body.innerHTML = `
      ${Object.entries(user).map(([k, v]) => `<div class="kv"><span>${escapeHtml(k)}</span><span>${escapeHtml(String(v))}</span></div>`).join('')}
      <h3 style="margin-top:16px;">Riwayat Chat (maks 2)</h3>
      ${chat.length ? chat.map((c) => `
        <div class="chat-log-exchange">
          <p class="u"><strong>User:</strong> ${escapeHtml(c.user)}</p>
          <p class="a"><strong>Sylent AI:</strong> ${escapeHtml(c.assistant)}</p>
        </div>
      `).join('') : '<p style="color:var(--text-faint);">Belum ada percakapan.</p>'}
    `;
    document.getElementById('userDetailModal').classList.add('open');
  }
  document.getElementById('closeUserDetailBtn').addEventListener('click', () => {
    document.getElementById('userDetailModal').classList.remove('open');
  });

  document.getElementById('applyFilterBtn').addEventListener('click', loadUsers);
  document.getElementById('exportJsonBtn').addEventListener('click', () => {
    window.open('/atmin/api/export/json', '_blank');
  });
  document.getElementById('exportCsvBtn').addEventListener('click', () => {
    window.open('/atmin/api/export/csv', '_blank');
  });

  document.getElementById('clearLogsBtn').addEventListener('click', async () => {
    if (!confirm('Yakin ingin menghapus SEMUA log (users, chat, statistik)?')) return;
    await api('/atmin/api/logs', { method: 'DELETE' });
    loadStats();
    loadUsers();
    loadChats();
  });

  /* ---------------- Chats ---------------- */
  async function loadChats() {
    const container = document.getElementById('chatLogsList');
    container.innerHTML = Array.from({ length: 3 })
      .map(() => `<div class="chat-log-user"><div class="skeleton-bar" style="width:40%;margin-bottom:10px;"></div><div class="skeleton-bar" style="width:80%;margin-bottom:6px;"></div><div class="skeleton-bar" style="width:60%;"></div></div>`)
      .join('');

    const res = await api('/atmin/api/chats');
    if (res.status === 403) return handleSessionExpired();
    if (!res.ok) return;
    const { chats } = await res.json();
    const entries = Object.entries(chats || {});
    if (!entries.length) {
      container.innerHTML = '<p style="color:var(--text-faint);padding:16px;">Belum ada riwayat chat.</p>';
      return;
    }
    container.innerHTML = entries.map(([userId, log]) => `
      <div class="chat-log-user">
        <h3>User: ${escapeHtml(userId)}</h3>
        ${log.map((c) => `
          <div class="chat-log-exchange">
            <p class="u"><strong>User:</strong> ${escapeHtml(c.user)}</p>
            <p class="a"><strong>Sylent AI:</strong> ${escapeHtml(c.assistant)}</p>
          </div>
        `).join('')}
      </div>
    `).join('');
  }

  /* ---------------- Helpers ---------------- */
  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function formatTime(ts) {
    if (!ts) return '-';
    return new Date(Number(ts)).toLocaleString('id-ID');
  }

  /* ---------------- Session expiry handling ---------------- */
  let sessionExpiredHandled = false;
  function handleSessionExpired() {
    if (sessionExpiredHandled) return;
    sessionExpiredHandled = true;
    stopPolling();
    showLogin('Sesi berakhir. Silakan login kembali.');
  }

  /* ---------------- Polling refresh ---------------- */
  let pollTimer = null;
  function startPolling() {
    stopPolling();
    pollTimer = setInterval(() => {
      loadStats();
      const activeTab = document.querySelector('.admin-nav-btn.active')?.dataset.tab;
      if (activeTab === 'users') loadUsers();
      if (activeTab === 'chats') loadChats();
    }, 10000);
  }
  function stopPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  }

  /* ---------------- Boot ---------------- */
  function bootDashboard() {
    sessionExpiredHandled = false;
    loadStats();
    startPolling();
  }

  (async function boot() {
    const loggedIn = await checkSession();
    if (loggedIn) {
      showDashboard();
      bootDashboard();
    } else {
      showLogin();
      adminKeyInput.focus();
    }
  })();
})();
