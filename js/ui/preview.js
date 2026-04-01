// Main canvas preview: renders current page + stamp handles, handles drag.
// Fires: stampforge:placementchange

import $ from 'jquery';
import { S, curPageObj, curKey } from '../state.js';
import { renderPage, getPageInfo, prefetchPage } from '../pdf/loader.js';
import { getOrComputePlacements, setPlacementPos, resetPlacement,
         stampDisplaySize, getStamp } from '../stamp/manager.js';
import { clientToCanvas } from '../utils/canvas.js';

// Stamp handle colours (one per stamp slot)
const HANDLE_COLORS = ['#3584e4', '#57e389', '#ffa348', '#ff7b63', '#c061cb'];

let _lastBitmap = null;   // cached for redraw without re-render
let _pageInfo   = null;   // {vW,vH,mW,mH,rotation} for current page
let _renderSeq  = 0;      // incremented on each navigation; guards against stale renders
let _navTimer   = null;   // debounce timer for keyboard navigation

// ── Public API ───────────────────────────────────────────────────────────────

export async function renderCurrentPage() {
  const pg = curPageObj();
  if (!pg) { _showEmpty(); return; }

  // Increment sequence number so any in-flight render for a previous page can bail out.
  const seq = ++_renderSeq;

  $('#canvas-wrap').show();
  $('#empty-state').hide();

  // Compute canvas display size (fills available space)
  const { w: areaW, h: areaH } = _previewAreaSize();
  const info = await getPageInfo(pg.fileIdx, pg.pageNum);
  if (seq !== _renderSeq) return; // user navigated away while awaiting page info
  _pageInfo = info;

  const scale = Math.min(areaW / info.vW, areaH / info.vH) * 0.98;
  const dispW = Math.round(info.vW * scale);
  const dispH = Math.round(info.vH * scale);

  // Set canvas physical and CSS size
  const $pc = $('#page-canvas');
  const $sc = $('#stamp-canvas');
  $pc.attr({ width: dispW, height: dispH }).css({ width: dispW, height: dispH });
  $sc.attr({ width: dispW, height: dispH }).css({ width: dispW, height: dispH });

  // ── Step 1: Show a low-res preview immediately for instant visual feedback ──
  const lowW = Math.max(64, Math.round(dispW / 4));
  const lowBitmap = await renderPage(pg.fileIdx, pg.pageNum, lowW);
  if (seq !== _renderSeq) return;

  const ctx = $pc[0].getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'low';
  ctx.drawImage(lowBitmap, 0, 0, dispW, dispH);
  $('#skip-badge').toggleClass('visible', pg.skipped);
  _updateCounter();

  // ── Step 2: Render at full display resolution and replace the preview ───────
  const bitmap = await renderPage(pg.fileIdx, pg.pageNum, dispW);
  if (seq !== _renderSeq) return;
  _lastBitmap = bitmap;

  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(bitmap, 0, 0, dispW, dispH);

  // Compute / fetch placements and draw stamp handles
  await _drawStampLayer(pg, info, dispW, dispH);
  if (seq !== _renderSeq) return;

  // Prefetch adjacent pages in the background so the next navigation is instant.
  _prefetchAdjacent(pg, dispW);
}

export function redrawStampLayer() {
  const pg = curPageObj();
  if (!pg || !_pageInfo) return;
  const $sc = $('#stamp-canvas');
  const dispW = parseInt($sc.attr('width'));
  const dispH = parseInt($sc.attr('height'));
  _drawStampLayer(pg, _pageInfo, dispW, dispH);
}

export function initNavigation() {
  $('#btn-prev').on('click', () => _navigate(-1));
  $('#btn-next').on('click', () => _navigate(1));

  $(document).on('keydown', e => {
    if ($(e.target).is('input, textarea')) return;
    if (e.key === 'ArrowLeft')  _navigate(-1);
    if (e.key === 'ArrowRight') _navigate(1);
    if (e.key === ' ')          _toggleSkipCurrent();
  });

  let _wheelTimer = null;
  document.getElementById('preview-area').addEventListener('wheel', e => {
    e.preventDefault();
    if (_wheelTimer) return;
    _wheelTimer = setTimeout(() => { _wheelTimer = null; }, 150);
    _navigate(e.deltaY > 0 ? 1 : -1);
  }, { passive: false });
}

export function initDrag() {
  const $sc = $('#stamp-canvas');

  $sc.on('mousedown', e => {
    if (S.exportActive) return;
    const pos = _canvasPos(e, $sc[0]);
    const hit = _hitTest(pos);
    if (!hit) return;
    e.preventDefault();

    const pg = curPageObj();
    // Convert normalised stamp position to canvas pixels for a correct pixel offset
    const dispW = $sc[0].width;
    const dispH = $sc[0].height;
    S.dragState = {
      stampId:  hit.stampId,
      fileIdx:  pg.fileIdx,
      pageNum:  pg.pageNum,
      offsetX:  pos.x - hit.pos.x * dispW,
      offsetY:  pos.y - hit.pos.y * dispH,
    };
    $sc.css('cursor', 'grabbing');
  });

  $(document).on('mousemove', e => {
    if (!S.dragState) return;
    const $sc2 = $('#stamp-canvas');
    const pos = _canvasPos(e, $sc2[0]);
    const pg  = curPageObj();
    if (!pg || pg.fileIdx !== S.dragState.fileIdx || pg.pageNum !== S.dragState.pageNum) {
      S.dragState = null;
      return;
    }

    const info = _pageInfo;
    const stamp = getStamp(S.dragState.stampId);
    if (!stamp || !info) return;

    const dispW = parseInt($sc2.attr('width'));
    const dispH = parseInt($sc2.attr('height'));
    const { w: sw, h: sh } = stampDisplaySize(stamp, dispW);

    const nx = Math.max(0, Math.min(1 - sw/dispW, (pos.x - S.dragState.offsetX) / dispW));
    const ny = Math.max(0, Math.min(1 - sh/dispH, (pos.y - S.dragState.offsetY) / dispH));

    setPlacementPos(pg.fileIdx, pg.pageNum, S.dragState.stampId, { x: nx, y: ny });
    redrawStampLayer();
  });

  $(document).on('mouseup', () => {
    if (!S.dragState) return;
    $('#stamp-canvas').css('cursor', '');
    S.dragState = null;
    $(window).trigger('stampforge:placementchange');
  });

  // Double-click: reset to auto
  $sc.on('dblclick', e => {
    const pos = _canvasPos(e, $sc[0]);
    const hit = _hitTest(pos);
    if (!hit) return;
    const pg = curPageObj();
    resetPlacement(pg.fileIdx, pg.pageNum, hit.stampId);
    $(window).trigger('stampforge:placementchange');
    renderCurrentPage();
  });

  // Hover cursor
  $sc.on('mousemove', e => {
    if (S.dragState) return;
    const pos = _canvasPos(e, $sc[0]);
    const hit = _hitTest(pos);
    $sc.css('cursor', hit ? 'grab' : '');
  });
}

// ── Internals ────────────────────────────────────────────────────────────────

function _showEmpty() {
  $('#canvas-wrap').hide();
  $('#empty-state').show();
  _updateCounter();
}

function _previewAreaSize() {
  const el = document.getElementById('preview-area');
  return { w: el.clientWidth - 32, h: el.clientHeight - 32 };
}

async function _drawStampLayer(pg, info, dispW, dispH) {
  const $sc = $('#stamp-canvas');
  const ctx = $sc[0].getContext('2d');
  ctx.clearRect(0, 0, dispW, dispH);

  if (pg.skipped || S.stamps.length === 0) return;

  // Get or compute placements
  const bitmap = _lastBitmap;
  const placements = getOrComputePlacements(pg.fileIdx, pg.pageNum, bitmap, info.vW, info.vH);

  for (let i = 0; i < placements.length; i++) {
    const { stampId, pos, manual } = placements[i];
    const stamp = getStamp(stampId);
    if (!stamp) continue;

    const { w: sw, h: sh } = stampDisplaySize(stamp, dispW);
    const px = pos.x * dispW;
    const py = pos.y * dispH;

    // Draw stamp image
    ctx.save();
    ctx.globalAlpha = S.stampOpacity;
    ctx.drawImage(stamp.imageBitmap, px, py, sw, sh);
    ctx.restore();

    // Draw handle border
    const color = HANDLE_COLORS[i % HANDLE_COLORS.length];
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = manual ? 2.5 : 1.5;
    ctx.setLineDash(manual ? [] : [4, 3]);
    ctx.globalAlpha = 0.85;
    ctx.strokeRect(px + 0.5, py + 0.5, sw - 1, sh - 1);
    ctx.restore();
  }
}

const _canvasPos = clientToCanvas;

/** Return the placement hit at canvas position, or null */
function _hitTest(pos) {
  const pg = curPageObj();
  if (!pg) return null;
  const key = curKey();
  const placements = (key && S.pageStamps[key]) ? S.pageStamps[key] : [];
  const $sc = $('#stamp-canvas');
  const dispW = parseInt($sc.attr('width'));
  const dispH = parseInt($sc.attr('height'));

  for (const placement of placements) {
    const stamp = getStamp(placement.stampId);
    if (!stamp) continue;
    const { w: sw, h: sh } = stampDisplaySize(stamp, dispW);
    const px = placement.pos.x * dispW;
    const py = placement.pos.y * dispH;
    if (pos.x >= px && pos.x <= px + sw && pos.y >= py && pos.y <= py + sh) {
      return { stampId: placement.stampId, pos: placement.pos };
    }
  }
  return null;
}

function _navigate(delta) {
  const next = S.curPage + delta;
  if (next < 0 || next >= S.pages.length) return;
  S.curPage = next;
  import('./sidebar.js').then(m => m.updateCurrentPageHighlight());
  // Update the counter immediately so the number tracks the key-hold visually.
  _updateCounter();
  // Debounce the actual render: when the user holds an arrow key we only render
  // once they pause (80 ms), skipping the intermediate pages entirely.
  if (_navTimer) clearTimeout(_navTimer);
  _navTimer = setTimeout(() => {
    _navTimer = null;
    renderCurrentPage();
  }, 80);
}

/** Prefetch N+1, N+2 and N-1 at the given display width in the background. */
function _prefetchAdjacent(pg, dispW) {
  const total = S.pages.length;
  const cur   = S.curPage;
  for (const offset of [1, 2, -1]) {
    const idx = cur + offset;
    if (idx < 0 || idx >= total) continue;
    const p = S.pages[idx];
    prefetchPage(p.fileIdx, p.pageNum, dispW);
  }
}

function _toggleSkipCurrent() {
  const pg = curPageObj();
  if (!pg) return;
  pg.skipped = !pg.skipped;
  $('#skip-badge').toggleClass('visible', pg.skipped);
  import('./sidebar.js').then(m => m.renderPageList());
  $(window).trigger('stampforge:skipchange');
}

function _updateCounter() {
  const total = S.pages.length;
  const text  = total > 0 ? `${S.curPage + 1} / ${total}` : '— / —';
  $('#page-counter').text(text);
  $('#btn-prev').prop('disabled', S.curPage <= 0);
  $('#btn-next').prop('disabled', S.curPage >= total - 1);
}
