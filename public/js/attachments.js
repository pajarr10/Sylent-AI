/**
 * attachments.js — client-side file/image attachment handling for the composer.
 * Files are read as base64 data URLs entirely in the browser (no backend
 * storage needed, so this works unmodified on serverless hosts like Vercel).
 * Images are shown as real inline previews in the chat; other files show as
 * a file chip with name + size. Because the upstream AI API is text-only,
 * we send the AI a short note describing the attachment (filename/type)
 * so its reply stays coherent, while the actual image is shown to the user.
 */
window.SylentAttachments = (function () {
  'use strict';

  const MAX_FILE_SIZE = 6 * 1024 * 1024; // 6MB per file (base64-safe for JSON payloads)
  const MAX_FILES = 4;

  const fileInput = document.getElementById('fileInput');
  const attachBtn = document.getElementById('attachBtn');
  const tray = document.getElementById('attachmentTray');

  let pending = []; // [{ id, file, name, size, type, dataUrl, isImage }]

  function formatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function readAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function addFiles(fileList) {
    const files = Array.from(fileList).slice(0, MAX_FILES - pending.length);
    for (const file of files) {
      if (file.size > MAX_FILE_SIZE) {
        alert(`File "${file.name}" terlalu besar (maks ${formatSize(MAX_FILE_SIZE)}).`);
        continue;
      }
      const dataUrl = await readAsDataUrl(file);
      pending.push({
        id: 'att-' + Math.random().toString(36).slice(2, 9),
        name: file.name,
        size: file.size,
        type: file.type || 'application/octet-stream',
        isImage: file.type.startsWith('image/'),
        dataUrl,
      });
    }
    render();
  }

  function removeFile(id) {
    pending = pending.filter((f) => f.id !== id);
    render();
  }

  function clear() {
    pending = [];
    render();
  }

  function getPending() {
    return pending.slice();
  }

  const ICON_FILE = '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M6 2h9l5 5v15H6zm8 1.5V8h4.5z"/></svg>';
  const ICON_CLOSE = '<svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

  function render() {
    if (!pending.length) {
      tray.classList.add('hidden');
      tray.innerHTML = '';
      return;
    }
    tray.classList.remove('hidden');
    tray.innerHTML = pending
      .map((f) => `
        <div class="attachment-chip" data-id="${f.id}">
          ${f.isImage
            ? `<img src="${f.dataUrl}" alt="${SylentMarkdown.escapeHtml(f.name)}" class="attachment-thumb">`
            : `<span class="attachment-file-icon">${ICON_FILE}</span>`}
          <div class="attachment-meta">
            <span class="attachment-name">${SylentMarkdown.escapeHtml(f.name)}</span>
            <span class="attachment-size">${formatSize(f.size)}</span>
          </div>
          <button class="attachment-remove" data-remove="${f.id}" title="Hapus lampiran">${ICON_CLOSE}</button>
        </div>
      `)
      .join('');

    tray.querySelectorAll('[data-remove]').forEach((btn) => {
      btn.addEventListener('click', () => removeFile(btn.dataset.remove));
    });
  }

  attachBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length) addFiles(e.target.files);
    fileInput.value = '';
  });

  // Drag & drop support directly onto the composer.
  const composer = document.getElementById('composer');
  ['dragover', 'dragenter'].forEach((evt) =>
    composer.addEventListener(evt, (e) => {
      e.preventDefault();
      composer.classList.add('drag-over');
    })
  );
  ['dragleave', 'drop'].forEach((evt) =>
    composer.addEventListener(evt, (e) => {
      e.preventDefault();
      composer.classList.remove('drag-over');
    })
  );
  composer.addEventListener('drop', (e) => {
    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  });

  return { addFiles, removeFile, clear, getPending, formatSize };
})();
