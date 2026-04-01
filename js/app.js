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
import { renderCurrentPage, redrawStampLayer,
         initNavigation, initDrag } from './ui/preview.js';
import { renderMinimap, initMinimap } from './ui/minimap.js';
import { setExportEnabled, initSectionToggles, toast } from './ui/toolbar.js';

// ── Bootstrap ────────────────────────────────────────────────────────────────

$(async () => {
  // Restore settings from localStorage
  const savedStamps = loadSettings();

  // Re-hydrate stamps from saved data URLs
  if (Array.isArray(savedStamps)) {
    for (const st of savedStamps) {
      try {
        await addStampFromDataUrl(st.id, st.name, st.dataUrl, st.defaultEnabled);
      } catch (_) { /* ignore corrupt entries */ }
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

  // Render initial palette (may be empty)
  renderPalette();
  renderFileList();
  renderPageList();

  // ── Event wiring ────────────────────────────────────────────────────────

  // File inputs — triggered by their <label for> wrappers natively
  $('#input-pdfs').on('change', async function () {
    const files = Array.from(this.files ?? []);
    if (!files.length) return;
    this.value = '';
    await _loadFiles(files);
  });


  // Export
  $('#btn-export').on('click', exportAll);

  // Cross-module events
  $(window).on('stampforge:pagechange', () => {
    renderCurrentPage();
    renderMinimap();
  });

  $(window).on('stampforge:fileschange', () => {
    renderFileList();
    renderPageList();
    setExportEnabled(S.files.length > 0);
    renderCurrentPage();
  });

  $(window).on('stampforge:stampschange', () => {
    renderPalette();
    renderCurrentPage();
  });

  $(window).on('stampforge:settingschange', () => {
    renderCurrentPage();
    renderMinimap();
  });

  $(window).on('stampforge:skipchange', () => {
    renderCurrentPage();
  });

  $(window).on('stampforge:placementchange', () => {
    // Already redrawn during drag; just ensure sidebar reflects skipped state
  });

  // ── Drag-and-drop ────────────────────────────────────────────────────────

  let _dragCounter = 0;

  $(document)
    .on('dragenter', e => {
      e.preventDefault();
      _dragCounter++;
      $('#drop-overlay').addClass('active');
    })
    .on('dragleave', () => {
      _dragCounter--;
      if (_dragCounter <= 0) { _dragCounter = 0; $('#drop-overlay').removeClass('active'); }
    })
    .on('dragover', e => { e.preventDefault(); })
    .on('drop', async e => {
      e.preventDefault();
      _dragCounter = 0;
      $('#drop-overlay').removeClass('active');
      $('.drop-zone').removeClass('drag-over');
      const files = Array.from(e.originalEvent.dataTransfer.files);
      const pdfs   = files.filter(f => f.name.toLowerCase().endsWith('.pdf'));
      const images = files.filter(f => f.type.startsWith('image/'));
      if (pdfs.length)   await _loadFiles(pdfs);
      if (images.length) await _loadStampImages(images);
    });

  // Highlight specific drop zones on hover
  $('#pdf-drop-zone')
    .on('dragenter dragover', e => { e.preventDefault(); e.stopPropagation(); $(e.currentTarget).addClass('drag-over'); })
    .on('dragleave drop', e => { $(e.currentTarget).removeClass('drag-over'); });

  $('#stamp-drop-zone')
    .on('dragenter dragover', e => { e.preventDefault(); e.stopPropagation(); $(e.currentTarget).addClass('drag-over'); })
    .on('dragleave drop', e => { $(e.currentTarget).removeClass('drag-over'); });

  // ── Keyboard shortcut: Delete clears manual placement on current page ────
  $(document).on('keydown', e => {
    if ($(e.target).is('input, textarea')) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      const pg = S.pages[S.curPage];
      if (!pg) return;
      const key = `${pg.fileIdx}:${pg.pageNum}`;
      if (S.pageStamps[key]) {
        S.pageStamps[key] = S.pageStamps[key].map(p => ({ ...p, manual: false }));
        delete S.pageStamps[key];  // force recompute
        renderCurrentPage();
      }
    }
  });

  // Window resize: re-render current page at new size
  $(window).on('resize', _debounce(() => renderCurrentPage(), 120));
});

// ── File loading helpers ─────────────────────────────────────────────────────

async function _loadFiles(files) {
  let loaded = 0;
  await loadPDFs(files, (n, total) => {
    loaded = n;
  });
  if (S.pages.length > 0 && S.curPage >= S.pages.length) {
    S.curPage = 0;
  }
  renderFileList();
  renderPageList();
  setExportEnabled(S.files.length > 0);
  if (S.pages.length > 0) renderCurrentPage();
  toast(`Loaded ${files.length} PDF${files.length > 1 ? 's' : ''}`);
}

async function _loadStampImages(files) {
  const { addStamp } = await import('./stamp/manager.js');
  const { renderPalette: rp } = await import('./ui/stamp-panel.js');
  const { invalidateAutoplacements } = await import('./stamp/manager.js');

  for (const file of files) {
    try { await addStamp(file); }
    catch (_) { toast('Failed to load stamp image', 'error'); }
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
