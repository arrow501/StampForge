// Minimap widget: shows auto-place search zone and default position.
// User can drag the dot to set defaultPos or draw a rectangle to set the zone.
// The square canvas maps (0,0)-(1,1) directly to page (0,0)-(1,1) — no letterboxing.

import $ from 'jquery';
import { S } from '../state.js';
import { invalidateAutoplacements } from '../stamp/manager.js';
import { saveSettings } from '../utils/storage.js';
import { clientToCanvas } from '../utils/canvas.js';

const MM_SZ = 220;   // canvas is square (matches index.html)
const DOT_R = 5;

let _mmCanvas = null;
let _mmDrag   = null;   // 'dot' | 'zone' | 'moveZone'
let _mmStart  = null;

// ── Public API ───────────────────────────────────────────────────────────────

export function renderMinimap() {
  const canvas = _mmCanvas;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, MM_SZ, MM_SZ);

  const ap = S.autoPlace;

  // Page background — full square IS the page
  ctx.fillStyle = '#3a3a3a';
  ctx.roundRect(0, 0, MM_SZ, MM_SZ, 4);
  ctx.fill();

  // Auto-place zone (hatched)
  const zx = ap.area.x * MM_SZ, zy = ap.area.y * MM_SZ;
  const zw = ap.area.w * MM_SZ, zh = ap.area.h * MM_SZ;

  ctx.save();
  ctx.beginPath();
  ctx.rect(zx, zy, zw, zh);
  ctx.clip();
  ctx.fillStyle = 'rgba(53,132,228,0.10)';
  ctx.fillRect(zx, zy, zw, zh);
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

  // Default position dot
  const dx = ap.defaultPos.x * MM_SZ;
  const dy = ap.defaultPos.y * MM_SZ;

  // Crosshairs
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(dx, 0);    ctx.lineTo(dx, MM_SZ);
  ctx.moveTo(0, dy);    ctx.lineTo(MM_SZ, dy);
  ctx.stroke();

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
  _mmCanvas = document.getElementById('minimap');
  if (!_mmCanvas) return;
  const canvas = _mmCanvas;

  canvas.addEventListener('mousedown', e => {
    const pos = clientToCanvas(e, canvas);
    const ap  = S.autoPlace;
    const dx  = ap.defaultPos.x * MM_SZ;
    const dy  = ap.defaultPos.y * MM_SZ;

    if (Math.hypot(pos.x - dx, pos.y - dy) <= DOT_R + 3) {
      _mmDrag = 'dot';
    } else if (_inZone(pos)) {
      _mmDrag = 'moveZone';
      _mmStart = { pos, zone: { ...ap.area } };
    } else {
      _mmDrag = 'zone';
      _mmStart = { ...pos };
    }
  });

  $(document).on('mousemove', e => {
    if (!_mmDrag) return;
    const pos = clientToCanvas(e, canvas);

    if (_mmDrag === 'dot') {
      S.autoPlace.defaultPos = _clamp(pos.x / MM_SZ, pos.y / MM_SZ);
    } else if (_mmDrag === 'moveZone') {
      const dx = (pos.x - _mmStart.pos.x) / MM_SZ;
      const dy = (pos.y - _mmStart.pos.y) / MM_SZ;
      S.autoPlace.area = {
        x: Math.max(0, Math.min(1 - _mmStart.zone.w, _mmStart.zone.x + dx)),
        y: Math.max(0, Math.min(1 - _mmStart.zone.h, _mmStart.zone.y + dy)),
        w: _mmStart.zone.w,
        h: _mmStart.zone.h,
      };
    } else if (_mmDrag === 'zone') {
      const x1 = Math.min(_mmStart.x, pos.x) / MM_SZ;
      const y1 = Math.min(_mmStart.y, pos.y) / MM_SZ;
      const x2 = Math.max(_mmStart.x, pos.x) / MM_SZ;
      const y2 = Math.max(_mmStart.y, pos.y) / MM_SZ;
      const w  = x2 - x1, h = y2 - y1;
      if (w > 0.03 && h > 0.03) {
        S.autoPlace.area = { x: x1, y: y1, w, h };
        S.autoPlace.defaultPos = { x: x1 + w / 2, y: y1 + h / 2 };
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

function _inZone(pos) {
  const { x, y, w, h } = S.autoPlace.area;
  return pos.x >= x * MM_SZ && pos.x <= (x + w) * MM_SZ &&
         pos.y >= y * MM_SZ && pos.y <= (y + h) * MM_SZ;
}

function _clamp(x, y) {
  return { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
}
