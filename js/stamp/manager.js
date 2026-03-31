// Stamp palette state management and per-page assignment logic.
// Interacts with S.stamps, S.pageStamps, S.pages.

import { S, pageKey, uid } from '../state.js';
import { loadImageBitmap, fileToDataUrl } from '../utils/canvas.js';
import { autoPlaceAll } from './placement.js';
import { posToRect } from './collision.js';

// ── Stamp palette ────────────────────────────────────────────────────────────

/**
 * Add a stamp from a File. Returns the new stamp object.
 * @param {File} file
 * @returns {Promise<object>}
 */
export async function addStamp(file) {
  const [imageBitmap, dataUrl] = await Promise.all([
    loadImageBitmap(file),
    fileToDataUrl(file),
  ]);
  const stamp = {
    id: uid(),
    name: file.name.replace(/\.[^.]+$/, ''),
    imageBitmap,
    dataUrl,
    defaultEnabled: true,
  };
  S.stamps.push(stamp);
  if (!S.activeStampId) S.activeStampId = stamp.id;
  return stamp;
}

/**
 * Add a stamp from a data URL (for restoring from localStorage).
 */
export async function addStampFromDataUrl(id, name, dataUrl, defaultEnabled) {
  const imageBitmap = await loadImageBitmap(dataUrl);
  S.stamps.push({ id, name, imageBitmap, dataUrl, defaultEnabled });
  if (!S.activeStampId) S.activeStampId = id;
}

/**
 * Remove a stamp by id. Also removes it from all page placements.
 */
export function removeStamp(id) {
  S.stamps = S.stamps.filter(s => s.id !== id);
  if (S.activeStampId === id) {
    S.activeStampId = S.stamps[0]?.id ?? null;
  }
  // Remove from all page placements
  for (const key of Object.keys(S.pageStamps)) {
    S.pageStamps[key] = S.pageStamps[key].filter(p => p.stampId !== id);
    if (S.pageStamps[key].length === 0) delete S.pageStamps[key];
  }
}

/**
 * Toggle defaultEnabled for a stamp.
 */
export function toggleStampDefault(id) {
  const st = S.stamps.find(s => s.id === id);
  if (st) st.defaultEnabled = !st.defaultEnabled;
}

// ── Per-page placement ───────────────────────────────────────────────────────

/**
 * Get (or compute) placements for a page.
 * If auto-place is on and placements are missing, compute them from pageBitmap.
 * @param {number} fileIdx
 * @param {number} pageNum
 * @param {ImageBitmap|null} pageBitmap  needed only for auto-place
 * @param {number} vW   visual page width
 * @param {number} vH   visual page height
 * @returns {{ stampId:string, pos:{x,y}, manual:boolean }[]}
 */
export function getOrComputePlacements(fileIdx, pageNum, pageBitmap, vW, vH) {
  const key = pageKey(fileIdx, pageNum);
  if (S.pageStamps[key]) return S.pageStamps[key];

  const enabledStamps = S.stamps.filter(s => s.defaultEnabled);
  if (enabledStamps.length === 0) {
    S.pageStamps[key] = [];
    return [];
  }

  if (S.autoPlace.enabled && pageBitmap) {
    const placements = autoPlaceAll(
      pageBitmap, vW, vH,
      enabledStamps.map(s => s.id),
      S.autoPlace,
      S.stampSize
    );
    S.pageStamps[key] = placements;
  } else {
    // Use default positions staggered slightly for multiple stamps
    S.pageStamps[key] = enabledStamps.map((st, i) => ({
      stampId: st.id,
      pos: {
        x: Math.min(0.95 - S.stampSize, S.autoPlace.defaultPos.x + i * 0.05),
        y: Math.min(0.95 - S.stampSize, S.autoPlace.defaultPos.y + i * 0.05),
      },
      manual: false,
    }));
  }
  return S.pageStamps[key];
}

/**
 * Update a placement position (user drag). Sets manual:true.
 */
export function setPlacementPos(fileIdx, pageNum, stampId, pos) {
  const key = pageKey(fileIdx, pageNum);
  if (!S.pageStamps[key]) S.pageStamps[key] = [];
  const entry = S.pageStamps[key].find(p => p.stampId === stampId);
  if (entry) {
    entry.pos = pos;
    entry.manual = true;
  }
}

/**
 * Reset a placement to auto (manual:false), clear cached pos so it re-computes.
 */
export function resetPlacement(fileIdx, pageNum, stampId) {
  const key = pageKey(fileIdx, pageNum);
  if (!S.pageStamps[key]) return;
  const idx = S.pageStamps[key].findIndex(p => p.stampId === stampId);
  if (idx !== -1) S.pageStamps[key].splice(idx, 1);
}

/**
 * Clear all computed (non-manual) placements so they re-run on next render.
 * Called when stampSize / autoPlace settings change.
 */
export function invalidateAutoplacements() {
  for (const key of Object.keys(S.pageStamps)) {
    S.pageStamps[key] = S.pageStamps[key].filter(p => p.manual);
    if (S.pageStamps[key].length === 0) delete S.pageStamps[key];
  }
}

/**
 * Return the stamp object for a given id (or null).
 */
export const getStamp = id => S.stamps.find(s => s.id === id) ?? null;

/**
 * Compute normalised stamp width and height for the current stampSize and page aspect.
 */
export function stampNormDims(vW, vH) {
  const stampW = S.stampSize;
  const stampH = (S.stampSize * vW) / (S.stamps[0]?.imageBitmap.width ?? 1)
    * (S.stamps[0]?.imageBitmap.height ?? 1) / vW;
  // More correct: use individual stamp's aspect ratio
  return { stampW };
}

/**
 * For a given stamp and page, compute visual pixel stamp dimensions.
 * @param {object} stamp  stamp object with imageBitmap
 * @param {number} vW     visual page width in display pixels
 * @returns {{ w:number, h:number }}  stamp dimensions in display pixels
 */
export function stampDisplaySize(stamp, vW) {
  const w = S.stampSize * vW;
  const h = w * (stamp.imageBitmap.height / stamp.imageBitmap.width);
  return { w, h };
}
