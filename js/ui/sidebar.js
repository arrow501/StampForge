// Sidebar: file list, page list, skip controls.
// Fires custom jQuery events on window for cross-module communication:
//   stampforge:pagechange  { index }
//   stampforge:fileschange
//   stampforge:skipchange

import $ from 'jquery';
import { S, pageKey } from '../state.js';
import { removeFile } from '../pdf/loader.js';
import { renderPage } from '../pdf/loader.js';

// ── Public API ───────────────────────────────────────────────────────────────

export function renderFileList() {
  const $list = $('#file-list').empty();
  if (S.files.length === 0) {
    $list.append('<div style="padding:var(--sp-2) var(--sp-3);font-size:var(--text-sm);color:var(--text-3)">No files loaded</div>');
    return;
  }
  S.files.forEach((f, idx) => {
    const $row = $('<div class="file-row">').append(
      $('<span class="file-name">').text(f.name),
      $('<span class="file-pages">').text(`${f.pageCount}pp`),
      $('<button class="btn btn-icon btn-ghost" title="Remove">').html(
        '<svg width="12" height="12" viewBox="0 0 12 12" fill="none">' +
        '<path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>'
      ).on('click', e => { e.stopPropagation(); _removeFile(idx); })
    );
    $list.append($row);
  });
}

export function renderPageList() {
  const $list = $('#page-list').empty();
  if (S.pages.length === 0) return;

  S.pages.forEach((pg, idx) => {
    const isCurrent = idx === S.curPage;
    const label = `${S.files[pg.fileIdx]?.name ?? '?'} p.${pg.pageNum}`;
    const $wrap = $('<div class="page-thumb-wrap">');
    const $canvas = $('<canvas width="24" height="34">').appendTo($wrap);

    const $row = $('<div class="page-row">')
      .toggleClass('current', isCurrent)
      .toggleClass('skipped', pg.skipped)
      .attr('data-idx', idx)
      .append(
        $('<input type="checkbox">').prop('checked', !pg.skipped)
          .on('change', function () { _setSkip(idx, !this.checked); }),
        $wrap,
        $('<span class="page-label">').text(label)
      )
      .on('click', function (e) {
        if ($(e.target).is('input')) return;
        _navigateTo(idx);
      });

    $list.append($row);

    // Render mini thumbnail asynchronously
    renderPage(pg.fileIdx, pg.pageNum, 48).then(bitmap => {
      const ctx = $canvas[0].getContext('2d');
      ctx.drawImage(bitmap, 0, 0, 24, 34);
    }).catch(() => {});
  });

  // Scroll current page row into view
  const $cur = $list.find(`[data-idx="${S.curPage}"]`);
  if ($cur.length) {
    $cur[0].scrollIntoView({ block: 'nearest' });
  }
}

export function updateCurrentPageHighlight() {
  $('#page-list .page-row').each(function () {
    const idx = parseInt($(this).attr('data-idx'));
    $(this).toggleClass('current', idx === S.curPage);
  });

  // Scroll into view
  const $cur = $(`#page-list [data-idx="${S.curPage}"]`);
  if ($cur.length) $cur[0].scrollIntoView({ block: 'nearest' });
}

export function initSkipRangeInput() {
  $('#btn-apply-skip').on('click', _applySkipRange);
  $('#skip-range-input').on('keydown', e => { if (e.key === 'Enter') _applySkipRange(); });
}

// ── Internals ────────────────────────────────────────────────────────────────

function _navigateTo(idx) {
  if (idx === S.curPage) return;
  S.curPage = idx;
  updateCurrentPageHighlight();
  $(window).trigger('stampforge:pagechange', { index: idx });
}

function _setSkip(idx, skipped) {
  S.pages[idx].skipped = skipped;
  const $row = $(`#page-list [data-idx="${idx}"]`);
  $row.toggleClass('skipped', skipped);
  $row.find('input[type=checkbox]').prop('checked', !skipped);
  $(window).trigger('stampforge:skipchange');
}

function _removeFile(fileIdx) {
  removeFile(fileIdx);
  if (S.curPage >= S.pages.length) S.curPage = Math.max(0, S.pages.length - 1);
  renderFileList();
  renderPageList();
  $(window).trigger('stampforge:fileschange');
}

function _applySkipRange() {
  const raw = $('#skip-range-input').val().trim();
  if (!raw) return;

  const included = _parseRangeString(raw, S.pages.length);
  S.pages.forEach((pg, i) => {
    // "included" means NOT skipped
    pg.skipped = !included.has(i + 1);
  });

  renderPageList();
  $(window).trigger('stampforge:skipchange');
}

/**
 * Parse a range string like "1-3, 5, 8-10" into a Set of 1-based page numbers.
 */
function _parseRangeString(str, total) {
  const result = new Set();
  const parts = str.split(',');
  for (const part of parts) {
    const m = part.trim().match(/^(\d+)(?:-(\d+))?$/);
    if (!m) continue;
    const from = parseInt(m[1]);
    const to   = m[2] ? parseInt(m[2]) : from;
    for (let n = Math.min(from, to); n <= Math.max(from, to); n++) {
      if (n >= 1 && n <= total) result.add(n);
    }
  }
  return result;
}
