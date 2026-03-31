// Main canvas preview: renders current page + stamp handles, handles drag.
// Fires: stampforge:placementchange

import $ from 'jquery';
import { S, curPageObj, curKey } from '../state.js';
import { renderPage, getPageInfo } from '../pdf/loader.js';
import { getOrComputePlacements, setPlacementPos, resetPlacement,
         stampDisplaySize, getStamp } from '../stamp/manager.js';

// Stamp handle colours (one per stamp slot)
const HANDLE_COLORS = ['#3584e4', '#57e389', '#ffa348', '#ff7b63', '#c061cb'];

let _lastBitmap = null;   // cached for redraw without re-render
let _pageInfo   = null;   // {vW,vH,mW,mH,rotation} for current page

// ── Public API ───────────────────────────────────────────────────────────────

export async function renderCurrentPage() {
  const pg = curPageObj();
  if (!pg) { _showEmpty(); return; }

  $('#canvas-wrap').show();
  $('#empty-state').hide();

  // Compute canvas display size (fills available space)
  const { w: areaW, h: areaH } = _previewAreaSize();
  const info = await getPageInfo(pg.fileIdx, pg.pageNum);
  _pageInfo = info;

  const scale = Math.min(areaW / info.vW, areaH / info.vH) * 0.98;
  const dispW = Math.round(info.vW * scale);
  const dispH = Math.round(info.vH * scale);

  // Set canvas physical and CSS size
  const $pc = $('#page-canvas');
  const $sc = $('#stamp-canvas');
  $pc.attr({ width: dispW, height: dispH }).css({ width: dispW, height: dispH });
  $sc.attr({ width: dispW, height: dispH }).css({ width: dispW, height: dispH });

  // Render page at display resolution
  const bitmap = await renderPage(pg.fileIdx, pg.pageNum, dispW);
  _lastBitmap = bitmap;

  const ctx = $pc[0].getContext('2d');
  ctx.drawImage(bitmap, 0, 0, dispW, dispH);

  // Skip badge
  $('#skip-badge').toggleClass('visible', pg.skipped);

  // Compute / fetch placements and draw stamp handles
  await _drawStampLayer(pg, info, dispW, dispH);

  // Update page counter
  _updateCounter();
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
    S.dragState = {
      stampId:  hit.stampId,
      fileIdx:  pg.fileIdx,
      pageNum:  pg.pageNum,
      offsetX:  pos.x - hit.pos.x,
      offsetY:  pos.y - hit.pos.y,
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

/** Convert mouse event coordinates to canvas-pixel space */
function _canvasPos(e, canvas) {
  const r = canvas.getBoundingClientRect();
  const scaleX = canvas.width  / r.width;
  const scaleY = canvas.height / r.height;
  return {
    x: (e.clientX - r.left) * scaleX,
    y: (e.clientY - r.top)  * scaleY,
  };
}

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
  renderCurrentPage();
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
