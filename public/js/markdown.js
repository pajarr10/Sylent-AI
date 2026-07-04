/**
 * markdown.js — Markdown rendering pipeline.
 * marked (parse) -> highlight.js (syntax highlight) -> DOMPurify (sanitize)
 * Also wraps <pre><code> blocks with a header (language label, copy, preview).
 */
window.SylentMarkdown = (function () {
  'use strict';

  const PREVIEWABLE_LANGS = new Set(['html', 'svg', 'css', 'javascript', 'js', 'xml']);

  marked.setOptions({
    breaks: true,
    gfm: true,
    highlight: function (code, lang) {
      if (lang && hljs.getLanguage(lang)) {
        try {
          return hljs.highlight(code, { language: lang }).value;
        } catch (e) {
          /* fall through */
        }
      }
      return hljs.highlightAuto(code).value;
    },
  });

  const renderer = new marked.Renderer();
  renderer.code = function (code, infostring) {
    const lang = (infostring || '').trim().split(/\s+/)[0].toLowerCase();
    let highlighted;
    try {
      highlighted = lang && hljs.getLanguage(lang)
        ? hljs.highlight(code, { language: lang }).value
        : hljs.highlightAuto(code).value;
    } catch (e) {
      highlighted = escapeHtml(code);
    }

    const id = 'code-' + Math.random().toString(36).slice(2, 10);
    const showPreview = PREVIEWABLE_LANGS.has(lang);

    return `
      <div class="code-block" data-lang="${escapeHtml(lang || 'text')}">
        <div class="code-block-header">
          <span>${escapeHtml(lang || 'text')}</span>
          <div class="code-block-actions">
            ${showPreview ? `<button class="code-block-btn preview-btn" data-action="preview" data-target="${id}"><svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M8 5v14l11-7z"/></svg> Preview</button>` : ''}
            <button class="code-block-btn" data-action="copy" data-target="${id}">Copy</button>
          </div>
        </div>
        <pre><code id="${id}" class="hljs language-${escapeHtml(lang || 'plaintext')}">${highlighted}</code></pre>
      </div>
    `;
  };

  marked.use({ renderer });

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Strips emoji / pictograph characters so the UI never shows them,
  // even if the upstream AI response happens to include some.
  const EMOJI_PATTERN = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{2190}-\u{21FF}\u{FE0F}\u{200D}]/gu;

  function stripEmoji(text) {
    return String(text || '').replace(EMOJI_PATTERN, '').replace(/[ \t]{2,}/g, ' ');
  }

  /** Convert markdown text to sanitized, render-ready HTML. */
  function render(markdownText) {
    const cleanText = stripEmoji(markdownText);
    const rawHtml = marked.parse(cleanText);
    return DOMPurify.sanitize(rawHtml, {
      ADD_TAGS: ['iframe'],
      ADD_ATTR: ['target', 'class', 'id', 'data-action', 'data-target', 'data-lang'],
    });
  }

  /** Extracts raw code text stored inside a rendered code block by id. */
  function getRawCode(id) {
    const el = document.getElementById(id);
    return el ? el.textContent : '';
  }

  return { render, getRawCode, escapeHtml, stripEmoji };
})();
