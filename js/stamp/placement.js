// Auto-placement algorithm.
// Finds the lowest-content area for a stamp using edge detection,
// brightness scoring, and an outward ring search.
// Supports collision avoidance for multiple stamps.

import { collidesAny, posToRect } from './collision.js';

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Auto-place all enabled stamps on a page, returning updated placement list.
 * Placed stamps are never overlapping.
 *
 * @param {ImageBitmap} pageBitmap   rendered page at analysis resolution
 * @param {number} vW   visual page width  (PDF points)
 * @param {number} vH   visual page height (PDF points)
 * @param {string[]} stampIds   ordered list of stamp ids to place
 * @param {{ enabled:boolean, area:{x,y,w,h}, defaultPos:{x,y} }} autoPlace
 * @param {number} stampSize    fraction of vW for stamp width
 * @returns {{ stampId:string, pos:{x,y}, manual:false }[]}
 */
export function autoPlaceAll(pageBitmap, vW, vH, stampIds, autoPlace, stampSize) {
  const aspect = pageBitmap.width / pageBitmap.height;
  const scoreMap = _buildScoreMap(pageBitmap);

  const stampW = stampSize;                   // normalised
  const stampH = stampSize / aspect;          // normalised (keeps pixel aspect)

  const placed = [];    // {stampId, pos, rect} — internal
  const occupied = [];  // Rect[]

  for (const stampId of stampIds) {
    // Search origin: center of last placed stamp, else defaultPos
    const origin = placed.length > 0
      ? { x: placed.at(-1).pos.x + stampW / 2,
          y: placed.at(-1).pos.y + stampH / 2 }
      : autoPlace.defaultPos;

    const pos = _findBestPosition(
      scoreMap, pageBitmap.width, pageBitmap.height,
      stampW, stampH,
      autoPlace.area,
      origin,
      occupied
    );

    placed.push({ stampId, pos, manual: false });
    occupied.push(posToRect(pos, stampW, stampH));
  }

  return placed.map(({ stampId, pos, manual }) => ({ stampId, pos, manual }));
}

/**
 * Single-stamp placement (convenience wrapper).
 */
export function autoPlaceOne(pageBitmap, vW, vH, stampId, autoPlace, stampSize, occupied = []) {
  const aspect = pageBitmap.width / pageBitmap.height;
  const scoreMap = _buildScoreMap(pageBitmap);
  const stampW = stampSize;
  const stampH = stampSize / aspect;
  const pos = _findBestPosition(
    scoreMap, pageBitmap.width, pageBitmap.height,
    stampW, stampH,
    autoPlace.area,
    autoPlace.defaultPos,
    occupied
  );
  return { stampId, pos, manual: false };
}

// ── Score map construction ───────────────────────────────────────────────────

function _buildScoreMap(bitmap) {
  const w = bitmap.width, h = bitmap.height;
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0);
  const { data } = ctx.getImageData(0, 0, w, h);

  // Grayscale + edge detection (Sobel)
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    gray[i] = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  }

  const edge = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const gx =
        -gray[(y-1)*w+(x-1)] + gray[(y-1)*w+(x+1)]
        -2*gray[y*w+(x-1)]   + 2*gray[y*w+(x+1)]
        -gray[(y+1)*w+(x-1)] + gray[(y+1)*w+(x+1)];
      const gy =
        -gray[(y-1)*w+(x-1)] - 2*gray[(y-1)*w+x] - gray[(y-1)*w+(x+1)]
        +gray[(y+1)*w+(x-1)] + 2*gray[(y+1)*w+x] + gray[(y+1)*w+(x+1)];
      edge[y*w+x] = Math.sqrt(gx*gx + gy*gy);
    }
  }

  // Light Gaussian blur on edge map to spread influence
  const blurred = _gaussBlur(edge, w, h, 3);

  // Score = brightness² × (1 - edge_density)⁴
  // High score = bright whitespace with no edges
  const score = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    score[i] = gray[i] * gray[i] * Math.pow(Math.max(0, 1 - blurred[i] * 8), 4);
  }

  return { score, w, h };
}

function _gaussBlur(src, w, h, radius) {
  const out = new Float32Array(w * h);
  const tmp = new Float32Array(w * h);
  const k = radius;
  const norm = (2 * k + 1);
  // Horizontal pass
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0, cnt = 0;
      for (let dx = -k; dx <= k; dx++) {
        const nx = x + dx;
        if (nx >= 0 && nx < w) { sum += src[y*w+nx]; cnt++; }
      }
      tmp[y*w+x] = sum / cnt;
    }
  }
  // Vertical pass
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let sum = 0, cnt = 0;
      for (let dy = -k; dy <= k; dy++) {
        const ny = y + dy;
        if (ny >= 0 && ny < h) { sum += tmp[ny*w+x]; cnt++; }
      }
      out[y*w+x] = sum / cnt;
    }
  }
  return out;
}

// ── Integral image (summed area table) for O(1) window sums ─────────────────

function _buildIntegral(score, w, h) {
  const ii = new Float64Array((w + 1) * (h + 1));
  for (let y = 1; y <= h; y++) {
    for (let x = 1; x <= w; x++) {
      ii[y*(w+1)+x] = score[(y-1)*w+(x-1)]
        + ii[(y-1)*(w+1)+x]
        + ii[y*(w+1)+(x-1)]
        - ii[(y-1)*(w+1)+(x-1)];
    }
  }
  return ii;
}

function _windowSum(ii, W, x1, y1, x2, y2) {
  // inclusive [x1,y1] to [x2,y2] (0-indexed pixels)
  x2++; y2++;
  return ii[y2*(W+1)+x2] - ii[y1*(W+1)+x2] - ii[y2*(W+1)+x1] + ii[y1*(W+1)+x1];
}

// ── Ring-expanding search ────────────────────────────────────────────────────

function _findBestPosition(scoreMap, bmpW, bmpH, stampW, stampH, area, origin, occupied) {
  const { score, w, h } = scoreMap;

  // Stamp size in pixels
  const sw = Math.round(stampW * bmpW);
  const sh = Math.round(stampH * bmpH);
  if (sw <= 0 || sh <= 0) return { x: area.x, y: area.y };

  // Search area in pixels
  const ax = Math.round(area.x * bmpW);
  const ay = Math.round(area.y * bmpH);
  const aw = Math.round(area.w * bmpW);
  const ah = Math.round(area.h * bmpH);

  const ii = _buildIntegral(score, w, h);
  const step = Math.max(2, Math.round(Math.min(sw, sh) / 4));

  // Grid of candidate top-left positions (stamp must fit entirely in search area)
  const maxX = ax + aw - sw;
  const maxY = ay + ah - sh;
  if (maxX < ax || maxY < ay) {
    // Stamp doesn't fit in area — return clamped origin
    return {
      x: Math.max(0, Math.min(1 - stampW, origin.x - stampW / 2)),
      y: Math.max(0, Math.min(1 - stampH, origin.y - stampH / 2)),
    };
  }

  // Origin in pixel grid
  const ox = Math.round(Math.max(ax, Math.min(maxX, origin.x * bmpW - sw / 2)));
  const oy = Math.round(Math.max(ay, Math.min(maxY, origin.y * bmpH - sh / 2)));

  let bestScore = -Infinity;
  let bestX = ox, bestY = oy;
  let emptyRings = 0;

  for (let ring = 0; emptyRings < 3; ring++) {
    const ringBest = ring === 0 ? -Infinity : bestScore;
    const d = ring * step;
    const candidates = ring === 0
      ? [[ox, oy]]
      : _ringCandidates(ox, oy, d, step, ax, ay, maxX, maxY);

    for (const [cx, cy] of candidates) {
      // Normalised position for collision check
      const nx = cx / bmpW;
      const ny = cy / bmpH;
      const rect = posToRect({ x: nx, y: ny }, stampW, stampH);
      if (collidesAny(rect, occupied)) continue;

      // Clamp to bitmap bounds for integral image query
      const x1 = Math.max(0, cx), y1 = Math.max(0, cy);
      const x2 = Math.min(w - 1, cx + sw - 1), y2 = Math.min(h - 1, cy + sh - 1);
      if (x2 < x1 || y2 < y1) continue;

      const s = _windowSum(ii, w, x1, y1, x2, y2) / ((x2-x1+1) * (y2-y1+1));
      if (s > bestScore) { bestScore = s; bestX = cx; bestY = cy; }
    }

    if (bestScore <= ringBest) emptyRings++;
    else emptyRings = 0;
  }

  return {
    x: Math.max(0, Math.min(1 - stampW, bestX / bmpW)),
    y: Math.max(0, Math.min(1 - stampH, bestY / bmpH)),
  };
}

function _ringCandidates(ox, oy, d, step, minX, minY, maxX, maxY) {
  const pts = [];
  const inBounds = (x, y) => x >= minX && x <= maxX && y >= minY && y <= maxY;
  // Top and bottom rows
  for (let dx = -d; dx <= d; dx += step) {
    if (inBounds(ox+dx, oy-d)) pts.push([ox+dx, oy-d]);
    if (inBounds(ox+dx, oy+d)) pts.push([ox+dx, oy+d]);
  }
  // Left and right columns (skip corners)
  for (let dy = -d + step; dy < d; dy += step) {
    if (inBounds(ox-d, oy+dy)) pts.push([ox-d, oy+dy]);
    if (inBounds(ox+d, oy+dy)) pts.push([ox+d, oy+dy]);
  }
  return pts;
}
