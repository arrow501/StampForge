// PDF loading and page rendering via PDF.js.
// Pages are rendered to OffscreenCanvas and cached as ImageBitmap.

import { S, pageKey } from '../state.js';

const pdfjs = window.pdfjsLib;
pdfjs.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// In-flight render promises: avoids duplicate concurrent renders of the same page+width.
const _inFlight = new Map();
// Maximum number of pages to keep in the bitmap cache (older ones are evicted).
const MAX_CACHE_PAGES = 20;

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Load an array of File objects as PDF documents.
 * Appends to S.files and S.pages.
 * @param {File[]} files
 * @param {function(number,number):void} [onProgress]  (loaded, total)
 */
export async function loadPDFs(files, onProgress) {
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdfDoc = await pdfjs.getDocument({ data: arrayBuffer }).promise;
      const fileIdx = S.files.length;
      S.files.push({ name: file.name, pdfDoc, pageCount: pdfDoc.numPages });
      for (let p = 1; p <= pdfDoc.numPages; p++) {
        S.pages.push({ fileIdx, pageNum: p, skipped: false });
      }
    } catch (e) {
      console.error('Failed to load PDF:', file.name, e);
    }
    onProgress?.(i + 1, files.length);
  }
}

/**
 * Remove a file by index. Clears its pages and cache entries.
 * Does NOT renumber other files' pageStamps keys — caller must reset state.
 * @param {number} fileIdx
 */
export function removeFile(fileIdx) {
  // Remove cache entries for this file's pages
  const pagesForFile = S.pages.filter(p => p.fileIdx === fileIdx);
  for (const p of pagesForFile) {
    const prefix = pageKey(p.fileIdx, p.pageNum);
    for (const k of Object.keys(S.pageCache)) {
      if (k.startsWith(prefix + ':')) { S.pageCache[k].close?.(); delete S.pageCache[k]; }
    }
    delete S.pageStamps[prefix];
  }
  S.files.splice(fileIdx, 1);
  // Remove pages and re-index fileIdx for files after the removed one
  S.pages = S.pages.filter(p => p.fileIdx !== fileIdx);
  for (const p of S.pages) {
    if (p.fileIdx > fileIdx) p.fileIdx--;
  }
  // Clamp curPage
  if (S.curPage >= S.pages.length) S.curPage = Math.max(0, S.pages.length - 1);
}

/**
 * Render a page to an ImageBitmap at the given pixel width.
 * Results are cached; pass forceRefresh=true to re-render.
 * @param {number} fileIdx
 * @param {number} pageNum  1-based
 * @param {number} targetWidth  pixels
 * @param {boolean} [forceRefresh]
 * @returns {Promise<ImageBitmap>}
 */
export async function renderPage(fileIdx, pageNum, targetWidth, forceRefresh = false) {
  const k = `${pageKey(fileIdx, pageNum)}:${targetWidth}`;
  if (!forceRefresh && S.pageCache[k]) return S.pageCache[k];
  // Return in-flight promise for the same key to avoid duplicate renders.
  if (!forceRefresh && _inFlight.has(k)) return _inFlight.get(k);

  const file = S.files[fileIdx];
  if (!file) throw new Error(`No file at index ${fileIdx}`);

  const promise = _doRender(file, fileIdx, pageNum, targetWidth, k);
  _inFlight.set(k, promise);
  try {
    return await promise;
  } finally {
    _inFlight.delete(k);
  }
}

async function _doRender(file, fileIdx, pageNum, targetWidth, k) {
  const page = await file.pdfDoc.getPage(pageNum);
  const { vW } = getVisualDims(page);
  const scale = targetWidth / vW;
  const viewport = page.getViewport({ scale });

  const canvas = new OffscreenCanvas(Math.round(viewport.width), Math.round(viewport.height));
  const ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx, viewport }).promise;

  const bitmap = await createImageBitmap(canvas);
  // Evict any previously cached widths for this page before storing the new one.
  const prefix = pageKey(fileIdx, pageNum) + ':';
  for (const ck of Object.keys(S.pageCache)) {
    if (ck.startsWith(prefix)) { S.pageCache[ck].close?.(); delete S.pageCache[ck]; }
  }
  S.pageCache[k] = bitmap;
  _evictOldPages();
  return bitmap;
}

function _evictOldPages() {
  const keys = Object.keys(S.pageCache);
  if (keys.length > MAX_CACHE_PAGES) {
    // Object key insertion order is preserved for string keys — oldest first.
    const toEvict = keys.slice(0, keys.length - MAX_CACHE_PAGES);
    for (const k of toEvict) { S.pageCache[k].close?.(); delete S.pageCache[k]; }
  }
}

/**
 * Fire-and-forget render for background prefetching.
 * No-ops if the page is already cached or being rendered.
 * @param {number} fileIdx
 * @param {number} pageNum  1-based
 * @param {number} targetWidth  pixels
 */
export function prefetchPage(fileIdx, pageNum, targetWidth) {
  if (fileIdx < 0 || fileIdx >= S.files.length) return;
  const pg = S.files[fileIdx];
  if (!pg || pageNum < 1 || pageNum > pg.pageCount) return;
  const k = `${pageKey(fileIdx, pageNum)}:${targetWidth}`;
  if (S.pageCache[k] || _inFlight.has(k)) return;
  renderPage(fileIdx, pageNum, targetWidth).catch(() => {});
}

/**
 * Return visual dimensions (post-/Rotate) for a page in PDF points.
 * @param {number} fileIdx
 * @param {number} pageNum  1-based
 * @returns {{ vW:number, vH:number, mW:number, mH:number, rotation:number }}
 */
export async function getPageInfo(fileIdx, pageNum) {
  const file = S.files[fileIdx];
  if (!file) throw new Error(`No file at index ${fileIdx}`);
  const page = await file.pdfDoc.getPage(pageNum);
  return _pageInfo(page);
}

// ── Internals ───────────────────────────────────────────────────────────────

function getVisualDims(page) {
  // PDF.js getViewport({scale:1}) respects /Rotate automatically
  const vp = page.getViewport({ scale: 1 });
  return { vW: vp.width, vH: vp.height };
}

function _pageInfo(page) {
  const rotation = page.rotate ?? 0;
  const vp = page.getViewport({ scale: 1 });
  const vW = vp.width, vH = vp.height;
  // Raw MediaBox (before /Rotate)
  const mW = (rotation === 90 || rotation === 270) ? vH : vW;
  const mH = (rotation === 90 || rotation === 270) ? vW : vH;
  return { vW, vH, mW, mH, rotation };
}
