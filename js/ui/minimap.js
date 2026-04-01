// Minimap widget: shows auto-place search zone and default position.
// User can drag the dot to set defaultPos or draw a rectangle to set the zone.
// The canvas is square; the current page is drawn inside with correct aspect ratio.

import $ from 'jquery';
import { S } from '../state.js';
import { getCurPageInfo } from './preview.js';
import { invalidateAutoplacements } from '../stamp/manager.js';
import { saveSettings } from '../utils/storage.js';

const MM_SZ  = 220;   // canvas is square (matches index.html)
const PAD    = 10;    // padding around page rect within canvas
const DOT_R  = 5;

let _mmDrag  = null;   // 'dot' | 'zone' | 'moveZone'
let _mmStart = null;

// ── Public API ───────────────────────────────────────────────────────────────

export function renderMinimap() {
  const canvas = document.getElementById('minimap');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, MM_SZ, MM_SZ);

  const ap   = S.autoPlace;
  const rect = _pageRect();

  // Page background (the letterboxed page area)
  ctx.fillStyle = '#3a3a3a';
  ctx.roundRect(rect.x, rect.y, rect.w, rect.h, 4);
  ctx.fill();

  // Auto-place zone (hatched), mapped through page rect
  const zx = rect.x + ap.area.x * rect.w;
  const zy = rect.y + ap.area.y * rect.h;
  const zw = ap.area.w * rect.w;
  const zh = ap.area.h * rect.h;

  ctx.save();
  ctx.beginPath();
  ctx.rect(zx, zy, zw, zh);
  ctx.clip();
  ctx.fillStyle = 'rgba(53,132,228,0.10)';
  ctx.fillRect(zx, zy, zw, zh);
  // Hatch lines
  ctx.strokeStyle = 'rgba(53,132,228,0.25)';
  ctx.lineWidth = 1;
  for (let d = -zh; d < zw + zh; d += 8) {
    ctx.beginPath();
    ctx.moveTo(zx + d, zy);
    ctx.lineTo(zx + d + zh, zy + zh);
    ctx.stroke();
  }
  ctx.restore();

  // Zone border
  ctx.strokeStyle = 'rgba(53,132,228,0.55)';
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 2]);
  ctx.strokeRect(zx + 0.5, zy + 0.5, zw - 1, zh - 1);
  ctx.setLineDash([]);

  // Default position dot, mapped through page rect
  const dx = rect.x + ap.defaultPos.x * rect.w;
  const dy = rect.y + ap.defaultPos.y * rect.h;

  // Crosshairs (clipped to page rect)
  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.w, rect.h);
  ctx.clip();
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(dx, rect.y); ctx.lineTo(dx, rect.y + rect.h);
  ctx.moveTo(rect.x, dy); ctx.lineTo(rect.x + rect.w, dy);
  ctx.stroke();
  ctx.restore();

  // Dot
  ctx.beginPath();
  ctx.arc(dx, dy, DOT_R, 0, Math.PI * 2);
  ctx.fillStyle = '#3584e4';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.8)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

export function initMinimap() {
  const canvas = document.getElementById('minimap');
  if (!canvas) return;

  canvas.addEventListener('mousedown', e => {
    const pos  = _mmPos(e, canvas);
    const rect = _pageRect();
    const ap   = S.autoPlace;
    const dx   = rect.x + ap.defaultPos.x * rect.w;
    const dy   = rect.y + ap.defaultPos.y * rect.h;

    // Hit test: dot
    if (Math.hypot(pos.x - dx, pos.y - dy) <= DOT_R + 3) {
      _mmDrag = 'dot';
    } else if (_inZone(pos, rect)) {
      _mmDrag = 'moveZone';
      _mmStart = { pos, zone: { ...ap.area } };
    } else {
      _mmDrag = 'zone';
      _mmStart = { ...pos };
    }
  });

  $(document).on('mousemove', e => {
    if (!_mmDrag) return;
    const canvas2 = document.getElementById('minimap');
    const pos  = _mmPos(e, canvas2);
    const rect = _pageRect();

    if (_mmDrag === 'dot') {
      S.autoPlace.defaultPos = _toNorm(pos.x, pos.y, rect);
    } else if (_mmDrag === 'moveZone') {
      const dx = (pos.x - _mmStart.pos.x) / rect.w;
      const dy = (pos.y - _mmStart.pos.y) / rect.h;
      S.autoPlace.area = {
        x: Math.max(0, Math.min(1 - _mmStart.zone.w, _mmStart.zone.x + dx)),
        y: Math.max(0, Math.min(1 - _mmStart.zone.h, _mmStart.zone.y + dy)),
        w: _mmStart.zone.w,
        h: _mmStart.zone.h,
      };
    } else if (_mmDrag === 'zone') {
      const n1 = _toNorm(Math.min(_mmStart.x, pos.x), Math.min(_mmStart.y, pos.y), rect);
      const n2 = _toNorm(Math.max(_mmStart.x, pos.x), Math.max(_mmStart.y, pos.y), rect);
      const w  = n2.x - n1.x, h = n2.y - n1.y;
      if (w > 0.03 && h > 0.03) {
        S.autoPlace.area = { x: n1.x, y: n1.y, w, h };
        S.autoPlace.defaultPos = { x: n1.x + w / 2, y: n1.y + h / 2 };
      }
    }

    renderMinimap();
  });

  $(document).on('mouseup', () => {
    if (!_mmDrag) return;
    _mmDrag = null;
    _mmStart = null;
    invalidateAutoplacements();
    saveSettings();
    $(window).trigger('stampforge:settingschange');
  });

  $('#chk-autoplace').on('change', function () {
    S.autoPlace.enabled = this.checked;
    invalidateAutoplacements();
    saveSettings();
    $(window).trigger('stampforge:settingschange');
  });

  renderMinimap();
}

// ── Internals ────────────────────────────────────────────────────────────────

/**
 * Compute the letterboxed page rectangle within the square canvas.
 * Falls back to A4 portrait aspect if no page is loaded yet.
 */
function _pageRect() {
  const info   = getCurPageInfo();
  const aspect = info ? (info.vW / info.vH) : (1 / Math.SQRT2); // A4 portrait fallback
  const inner  = MM_SZ - PAD * 2;
  const pw     = aspect >= 1 ? inner : inner * aspect;
  const ph     = aspect >= 1 ? inner / aspect : inner;
  return {
    x: Math.round((MM_SZ - pw) / 2),
    y: Math.round((MM_SZ - ph) / 2),
    w: Math.round(pw),
    h: Math.round(ph),
  };
}

/** Convert canvas-pixel position to page-normalised [0,1] coordinates, clamped. */
function _toNorm(cx, cy, rect) {
  return {
    x: Math.max(0, Math.min(1, (cx - rect.x) / rect.w)),
    y: Math.max(0, Math.min(1, (cy - rect.y) / rect.h)),
  };
}

function _mmPos(e, canvas) {
  const r = canvas.getBoundingClientRect();
  const sx = canvas.width  / r.width;
  const sy = canvas.height / r.height;
  return { x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sy };
}

function _inZone(pos, rect) {
  const { x, y, w, h } = S.autoPlace.area;
  const zx = rect.x + x * rect.w, zy = rect.y + y * rect.h;
  return pos.x >= zx && pos.x <= zx + w * rect.w &&
         pos.y >= zy && pos.y <= zy + h * rect.h;
}
