/**
 * preview.js — Live code preview (HTML/SVG/CSS/JS) rendered inside a
 * sandboxed iframe. Supports fullscreen, refresh, open-in-new-tab, download.
 * Also auto-combines index.html + style.css + script.js style outputs.
 */
window.SylentPreview = (function () {
  'use strict';

  const modal = document.getElementById('previewModal');
  const modalInner = document.getElementById('previewModalInner');
  const frame = document.getElementById('previewFrame');
  const closeBtn = document.getElementById('previewCloseBtn');
  const refreshBtn = document.getElementById('previewRefreshBtn');
  const fullscreenBtn = document.getElementById('previewFullscreenBtn');
  const openTabBtn = document.getElementById('previewOpenTabBtn');
  const downloadBtn = document.getElementById('previewDownloadBtn');

  let currentHtmlDoc = '';

  /** Builds a full HTML document from a single code block based on its language. */
  function buildDocument(code, lang) {
    lang = (lang || '').toLowerCase();

    if (lang === 'html' || lang === 'xml') {
      // If it already looks like a full document, use as-is.
      if (/<html[\s>]/i.test(code)) return code;
      return wrapFragment(`<body>${code}</body>`);
    }
    if (lang === 'svg') {
      return wrapFragment(`<body style="margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#fff;">${code}</body>`);
    }
    if (lang === 'css') {
      return wrapFragment(`<head><style>${code}</style></head><body><div style="padding:24px;font-family:sans-serif;color:#333;">Preview CSS diterapkan pada halaman ini. Tambahkan elemen HTML Anda sendiri untuk melihat efeknya.</div></body>`);
    }
    if (lang === 'javascript' || lang === 'js') {
      return wrapFragment(`<body><script>${code}<\/script></body>`);
    }
    return wrapFragment(`<body><pre>${SylentMarkdown.escapeHtml(code)}</pre></body>`);
  }

  function wrapFragment(inner) {
    return `<!DOCTYPE html><html><head><meta charset="UTF-8">${inner.includes('<head>') ? '' : ''}</head>${inner}</html>`;
  }

  /**
   * Combines separate index.html / style.css / script.js blocks (detected by
   * language + surrounding context) found within one assistant message into
   * a single runnable document.
   */
  function combineBlocks(blocks) {
    let html = blocks.html || '<div></div>';
    const css = blocks.css || '';
    const js = blocks.js || '';

    if (/<\/head>/i.test(html)) {
      html = html.replace(/<\/head>/i, `<style>${css}</style></head>`);
    } else if (/<html[\s>]/i.test(html)) {
      html = html.replace(/<html[^>]*>/i, (m) => `${m}<head><style>${css}</style></head>`);
    } else {
      html = `<head><style>${css}</style></head><body>${html}</body>`;
    }

    if (/<\/body>/i.test(html)) {
      html = html.replace(/<\/body>/i, `<script>${js}<\/script></body>`);
    } else {
      html += `<script>${js}<\/script>`;
    }

    if (!/<html[\s>]/i.test(html)) html = `<!DOCTYPE html><html>${html}</html>`;
    return html;
  }

  function open(code, lang, combined) {
    currentHtmlDoc = combined ? combineBlocks(combined) : buildDocument(code, lang);
    frame.srcdoc = currentHtmlDoc;
    modal.classList.add('open');
    modalInner.classList.remove('fullscreen');
  }

  function close() {
    modal.classList.remove('open');
    frame.srcdoc = '';
  }

  function refresh() {
    frame.srcdoc = '';
    requestAnimationFrame(() => { frame.srcdoc = currentHtmlDoc; });
  }

  function toggleFullscreen() {
    modalInner.classList.toggle('fullscreen');
  }

  function openInNewTab() {
    const blob = new Blob([currentHtmlDoc], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  function download() {
    const blob = new Blob([currentHtmlDoc], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sylent-preview.html';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  closeBtn.addEventListener('click', close);
  refreshBtn.addEventListener('click', refresh);
  fullscreenBtn.addEventListener('click', toggleFullscreen);
  openTabBtn.addEventListener('click', openInNewTab);
  downloadBtn.addEventListener('click', download);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && modal.classList.contains('open')) close(); });

  return { open, close };
})();
