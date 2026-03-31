// Stamp palette UI: thumbnail grid, size/opacity sliders, add/remove.
// Fires: stampforge:stampschange, stampforge:settingschange

import $ from 'jquery';
import { S } from '../state.js';
import { addStamp, removeStamp, toggleStampDefault, invalidateAutoplacements } from '../stamp/manager.js';
import { drawFit } from '../utils/canvas.js';
import { saveSettings } from '../utils/storage.js';
import { toast } from './toolbar.js';

// ── Public API ───────────────────────────────────────────────────────────────

export function renderPalette() {
  const $pal = $('#stamp-palette').empty();

  S.stamps.forEach(st => {
    const $thumb = $('<div class="stamp-thumb">')
      .attr('data-id', st.id)
      .toggleClass('active', st.id === S.activeStampId)
      .toggleClass('disabled', !st.defaultEnabled)
      .attr('title', st.name);

    // Canvas preview
    const $c = $('<canvas width="56" height="56">').appendTo($thumb);
    drawFit($c[0], st.imageBitmap);

    // Action buttons (shown on hover via CSS)
    const $actions = $('<div class="stamp-actions">').appendTo($thumb);

    // Toggle default-enabled
    $('<button class="btn btn-icon" style="width:16px;height:16px;padding:0;border-radius:3px;font-size:10px;" title="Toggle auto-apply">')
      .text(st.defaultEnabled ? '●' : '○')
      .on('click', e => {
        e.stopPropagation();
        toggleStampDefault(st.id);
        invalidateAutoplacements();
        renderPalette();
        $(window).trigger('stampforge:stampschange');
        saveSettings();
      })
      .appendTo($actions);

    // Remove
    $('<button class="btn btn-icon" style="width:16px;height:16px;padding:0;border-radius:3px;" title="Remove stamp">')
      .html('<svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>')
      .on('click', e => {
        e.stopPropagation();
        removeStamp(st.id);
        renderPalette();
        $(window).trigger('stampforge:stampschange');
        saveSettings();
      })
      .appendTo($actions);

    $thumb.on('click', () => {
      S.activeStampId = st.id;
      renderPalette();
    });

    $pal.append($thumb);
  });

  // Add button
  $('<div class="stamp-add" title="Add stamp image">')
    .html('<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M9 3v12M3 9h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>')
    .on('click', () => $('#input-stamp').trigger('click'))
    .appendTo($pal);
}

export function initSliders() {
  // Sync initial UI values
  $('#slider-size').val(Math.round(S.stampSize * 100));
  $('#val-size').text(Math.round(S.stampSize * 100) + '%');
  $('#slider-opacity').val(Math.round(S.stampOpacity * 100));
  $('#val-opacity').text(Math.round(S.stampOpacity * 100) + '%');

  $('#slider-size').on('input', function () {
    const v = parseInt(this.value);
    $('#val-size').text(v + '%');
    S.stampSize = v / 100;
    invalidateAutoplacements();
    $(window).trigger('stampforge:settingschange');
    saveSettings();
  });

  $('#slider-opacity').on('input', function () {
    const v = parseInt(this.value);
    $('#val-opacity').text(v + '%');
    S.stampOpacity = v / 100;
    $(window).trigger('stampforge:settingschange');
    saveSettings();
  });
}

export function initStampInput() {
  $('#input-stamp').on('change', async function () {
    const files = Array.from(this.files ?? []);
    if (!files.length) return;
    for (const file of files) {
      try {
        await addStamp(file);
      } catch (e) {
        toast('Failed to load stamp image', 'error');
      }
    }
    this.value = '';
    renderPalette();
    invalidateAutoplacements();
    $(window).trigger('stampforge:stampschange');
    saveSettings();
  });
}

// Handle stamp image pasted from clipboard
export function initClipboardPaste() {
  $(document).on('paste', async (e) => {
    const items = Array.from(e.originalEvent.clipboardData?.items ?? []);
    const imgItem = items.find(it => it.type.startsWith('image/'));
    if (!imgItem) return;
    try {
      const file = imgItem.getAsFile();
      await addStamp(file);
      renderPalette();
      invalidateAutoplacements();
      $(window).trigger('stampforge:stampschange');
      saveSettings();
      toast('Stamp added from clipboard');
    } catch (_) {
      toast('Failed to paste stamp', 'error');
    }
  });
}
