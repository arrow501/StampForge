// PDF export: applies stamps to all non-skipped pages and downloads per file.
// Uses pdf-lib for PDF manipulation and rotation.js for coordinate transforms.

import { S, pageKey } from '../state.js';
import { renderPage, getPageInfo } from './loader.js';
import { visualToRaw } from './rotation.js';
import { getOrComputePlacements, stampDisplaySize, getStamp } from '../stamp/manager.js';
import { showProgress, setProgress, hideProgress, toast } from '../ui/toolbar.js';

const { PDFDocument, degrees } = window.PDFLib;

// Export resolution for auto-placement analysis
const EXPORT_WIDTH = 1240;

/**
 * Export all loaded files, downloading each as {name}_stamped.pdf.
 */
export async function exportAll() {
  if (S.exportActive) return;
  if (S.files.length === 0) { toast('No files to export', 'error'); return; }
  if (S.stamps.filter(s => s.defaultEnabled).length === 0 && !_hasAnyManualPlacement()) {
    toast('No stamps to apply', 'error'); return;
  }

  showProgress('Preparing…', 0);

  const totalPages = S.pages.filter(p => !p.skipped).length;
  let donePages = 0;

  try {
    for (let fi = 0; fi < S.files.length; fi++) {
      const file = S.files[fi];
      setProgress((donePages / totalPages) * 100, `Processing ${file.name}…`);

      // Load PDF bytes — re-read via PDF.js internal buffer
      const pdfBytes = await _getPdfBytes(fi);
      const pdfDoc   = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
      const pages    = pdfDoc.getPages();

      // Embed all stamp images once per document
      const stampImages = {};
      for (const st of S.stamps) {
        const resp = await fetch(st.dataUrl);
        const buf  = await resp.arrayBuffer();
        const ext  = st.dataUrl.split(';')[0].split('/')[1];
        stampImages[st.id] = ext === 'png'
          ? await pdfDoc.embedPng(buf)
          : await pdfDoc.embedJpg(buf);
      }

      // Iterate pages for this file
      const filePages = S.pages.filter(p => p.fileIdx === fi);
      for (const pg of filePages) {
        if (pg.skipped) continue;

        const pageIdx = pg.pageNum - 1;
        const pdfPage = pages[pageIdx];
        const info    = await getPageInfo(fi, pg.pageNum);

        // Render at export resolution for auto-placement
        const bitmap = await renderPage(fi, pg.pageNum, EXPORT_WIDTH, false);

        // Get placements (uses cached or auto-computes at export resolution)
        const key = pageKey(fi, pg.pageNum);
        const placements = getOrComputePlacements(fi, pg.pageNum, bitmap, info.vW, info.vH);

        for (const { stampId, pos } of placements) {
          const st  = getStamp(stampId);
          const img = stampImages[stampId];
          if (!st || !img) continue;

          // Stamp visual dimensions in PDF points
          const { w: vStampW, h: vStampH } = _stampPdfDims(st, info.vW);

          // Clamp position so stamp fits on page
          const fx = Math.max(0, Math.min(1 - vStampW / info.vW, pos.x));
          const fy = Math.max(0, Math.min(1 - vStampH / info.vH, pos.y));

          const { rx, ry, counterRot } = visualToRaw(
            fx, fy,
            vStampW, vStampH,
            info.mW, info.mH,
            info.rotation
          );

          pdfPage.drawImage(img, {
            x:       rx,
            y:       ry,
            width:   vStampW,
            height:  vStampH,
            opacity: S.stampOpacity,
            rotate:  degrees(counterRot),
          });
        }

        donePages++;
        setProgress((donePages / totalPages) * 100);
      }

      // Download this file
      const outBytes = await pdfDoc.save();
      _download(outBytes, _outputName(file.name));
    }

    toast(`Exported ${S.files.length} file${S.files.length > 1 ? 's' : ''}`);
  } catch (e) {
    console.error('Export failed', e);
    toast('Export failed: ' + e.message, 'error');
  } finally {
    hideProgress();
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function _stampPdfDims(stamp, vW) {
  const w = S.stampSize * vW;
  const h = w * (stamp.imageBitmap.height / stamp.imageBitmap.width);
  return { w, h };
}

function _outputName(name) {
  return name.replace(/\.pdf$/i, '') + '_stamped.pdf';
}

function _download(bytes, filename) {
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 2000);
}

function _hasAnyManualPlacement() {
  return Object.values(S.pageStamps).some(arr => arr.some(p => p.manual));
}

/**
 * Get raw PDF bytes for a file by re-reading the pdfjs document.
 * PDF.js stores the ArrayBuffer; we access it via the internal transport.
 */
async function _getPdfBytes(fileIdx) {
  const pdfDoc = S.files[fileIdx].pdfDoc;
  // pdf.js internal: _pdfInfo is not guaranteed — use getData() instead
  return await pdfDoc.getData();
}
