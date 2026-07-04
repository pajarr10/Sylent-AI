/**
 * tracking.js — sends page-view pings to the backend and notifies on unload.
 * Loaded on every public page (index, profile, docs).
 */
(function () {
  'use strict';

  function sendPageView() {
    const page = window.location.pathname;
    fetch('/api/track/page', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ page }),
      keepalive: true,
    }).catch(() => {});
  }

  sendPageView();

  // Notify server on page leave using sendBeacon-friendly connection
  window.addEventListener('pagehide', () => {
    try {
      const blob = new Blob([JSON.stringify({ page: window.location.pathname, leaving: true })], {
        type: 'application/json',
      });
      navigator.sendBeacon('/api/track/page', blob);
    } catch (e) {
      /* no-op */
    }
  });
})();
