// StampForge v2 — main entry point.
// Initialises all modules and wires cross-module events.

import $ from 'jquery';
import { S } from './state.js';
import { loadSettings, saveSettings } from './utils/storage.js';
import { addStampFromDataUrl } from './stamp/manager.js';
import { loadPDFs } from './pdf/loader.js';
import { exportAll } from './pdf/exporter.js';
import { renderFileList, renderPageList, updateCurrentPageHighlight,
         initSkipRangeInput } from './ui/sidebar.js';
import { renderPalette, initSliders, initStampInput,
         initClipboardPaste } from './ui/stamp-panel.js';
import { renderCurrentPage, initNavigation, initDrag } from './ui/preview.js';
import { renderMinimap, initMinimap } from './ui/minimap.js';
import { setExportEnabled, initSectionToggles, toast } from './ui/toolbar.js';

// ── Bootstrap ────────────────────────────────────────────────────────────────

$(async () => {
  // Restore settings from localStorage
  const savedStamps = loadSettings();
  if (Array.isArray(savedStamps)) {
    for (const st of savedStamps) {
      try { await addStampFromDataUrl(st.id, st.name, st.dataUrl, st.defaultEnabled); }
      catch (_) { /* ignore corrupt entries */ }
    }
  }

  // Sync slider UI to restored settings
  $('#slider-size').val(Math.round(S.stampSize * 100));
  $('#val-size').text(Math.round(S.stampSize * 100) + '%');
  $('#slider-opacity').val(Math.round(S.stampOpacity * 100));
  $('#val-opacity').text(Math.round(S.stampOpacity * 100) + '%');
  $('#chk-autoplace').prop('checked', S.autoPlace.enabled);

  // Init UI modules
  initSectionToggles();
  initSliders();
  initStampInput();
  initClipboardPaste();
  initNavigation();
  initDrag();
  initSkipRangeInput();
  initMinimap();

  // Render initial state
  renderPalette();
  renderFileList();
  renderPageList();

  // ── File inputs (label-driven, no trigger() needed) ──────────────────────

  // Drop zone click → open file picker
  document.getElementById('pdf-drop-zone').addEventListener('click', () => document.getElementById('input-pdfs').click());
  document.getElementById('stamp-drop-zone').addEventListener('click', () => document.getElementById('input-stamp').click());

  document.getElementById('input-pdfs').addEventListener('change', async function () {
    const files = Array.from(this.files ?? []);
    this.value = '';
    if (files.length) await _loadFiles(files);
  });

  // ── Export ────────────────────────────────────────────────────────────────

  document.getElementById('btn-export').addEventListener('click', exportAll);

  // ── Cross-module events ───────────────────────────────────────────────────

  $(window)
    .on('stampforge:pagechange',   () => { renderCurrentPage(); renderMinimap(); })
    .on('stampforge:fileschange',  () => { renderFileList(); renderPageList(); setExportEnabled(S.files.length > 0); renderCurrentPage(); })
    .on('stampforge:stampschange', () => { renderPalette(); renderCurrentPage(); })
    .on('stampforge:settingschange', () => { renderCurrentPage(); renderMinimap(); })
    .on('stampforge:skipchange',   () => renderCurrentPage());

  // ── Drag-and-drop (native events — jQuery 4 dropped originalEvent) ────────

  _initDropZone(
    document.getElementById('pdf-drop-zone'),
    files => _loadFiles(files.filter(f => f.name.toLowerCase().endsWith('.pdf')))
  );

  _initDropZone(
    document.getElementById('stamp-drop-zone'),
    files => _loadStampImages(files.filter(f => f.type.startsWith('image/')))
  );

  // Global drop fallback — catches drops on the canvas / empty area
  _initGlobalDrop();

  // ── Keyboard: Delete clears manual placements on current page ────────────

  document.addEventListener('keydown', e => {
    if (e.target.matches('input, textarea')) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      const pg = S.pages[S.curPage];
      if (!pg) return;
      const key = `${pg.fileIdx}:${pg.pageNum}`;
      if (S.pageStamps[key]) { delete S.pageStamps[key]; renderCurrentPage(); }
    }
  });

  // ── Resize ────────────────────────────────────────────────────────────────

  window.addEventListener('resize', _debounce(() => renderCurrentPage(), 120));
});

// ── Drop zone helper ─────────────────────────────────────────────────────────

/**
 * Wire a single drop-zone element to receive file drops.
 * Also handles drag-over visual feedback.
 * @param {HTMLElement} el
 * @param {function(File[]):void} onFiles
 */
function _initDropZone(el, onFiles) {
  if (!el) return;

  el.addEventListener('dragenter', e => {
    e.preventDefault();
    e.stopPropagation();
    el.classList.add('drag-over');
  });

  el.addEventListener('dragover', e => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    el.classList.add('drag-over');
  });

  el.addEventListener('dragleave', e => {
    // Only remove class when leaving the zone itself, not a child
    if (!el.contains(e.relatedTarget)) el.classList.remove('drag-over');
  });

  el.addEventListener('drop', e => {
    e.preventDefault();
    e.stopPropagation();
    el.classList.remove('drag-over');
    const files = Array.from(e.dataTransfer.files);
    if (files.length) onFiles(files);
  });
}

// ── Global drop (canvas area) ────────────────────────────────────────────────

function _initGlobalDrop() {
  const overlay = document.getElementById('drop-overlay');
  let counter = 0;

  document.addEventListener('dragenter', e => {
    e.preventDefault();
    counter++;
    overlay.classList.add('active');
  });

  document.addEventListener('dragleave', e => {
    // relatedTarget is null when leaving the browser window
    if (e.relatedTarget === null) { counter = 0; overlay.classList.remove('active'); return; }
    counter--;
    if (counter <= 0) { counter = 0; overlay.classList.remove('active'); }
  });

  document.addEventListener('dragover', e => e.preventDefault());

  document.addEventListener('drop', e => {
    e.preventDefault();
    counter = 0;
    overlay.classList.remove('active');
    // Drop zones handle their own files via stopPropagation; this catches the rest
    const files = Array.from(e.dataTransfer.files);
    const pdfs   = files.filter(f => f.name.toLowerCase().endsWith('.pdf'));
    const images = files.filter(f => f.type.startsWith('image/'));
    if (pdfs.length)   _loadFiles(pdfs);
    if (images.length) _loadStampImages(images);
  });
}

// ── File loading helpers ──────────────────────────────────────────────────────

async function _loadFiles(files) {
  if (!files.length) return;
  await loadPDFs(files);
  if (S.curPage >= S.pages.length) S.curPage = 0;
  renderFileList();
  renderPageList();
  setExportEnabled(S.files.length > 0);
  if (S.pages.length > 0) renderCurrentPage();
  toast(`Loaded ${files.length} PDF${files.length > 1 ? 's' : ''}`);
}

async function _loadStampImages(files) {
  if (!files.length) return;
  const { addStamp } = await import('./stamp/manager.js');
  const { invalidateAutoplacements } = await import('./stamp/manager.js');
  for (const file of files) {
    try { await addStamp(file); }
    catch (_) { toast('Failed to load stamp', 'error'); }
  }
  renderPalette();
  invalidateAutoplacements();
  $(window).trigger('stampforge:stampschange');
  saveSettings();
}

function _debounce(fn, delay) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), delay); };
}
