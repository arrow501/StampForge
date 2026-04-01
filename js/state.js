// Central application state. Mutate fields directly; call render/update
// functions from the appropriate UI module after mutations.

export const S = {
  // Loaded files
  files: [],    // [{name:string, pdfDoc:PDFDocumentProxy, pageCount:number}]
  pages: [],    // [{fileIdx:number, pageNum:number, skipped:boolean}]
  curPage: 0,   // index into pages[]

  // Stamp palette
  stamps: [],           // [{id:string, name:string, imageBitmap:ImageBitmap, dataUrl:string, defaultEnabled:boolean}]
  activeStampId: null,  // id of stamp currently selected in palette (for controls)

  // Per-page stamp placements: key -> array of placement objects
  // key = pageKey(fileIdx, pageNum)
  // placement = {stampId:string, pos:{x:number, y:number}, manual:boolean}
  //   pos is normalized top-left in visual space (0..1)
  pageStamps: {},

  // Global stamp appearance (shared across all stamps for now)
  stampSize:    0.25,  // fraction of visual page width
  stampOpacity: 1.0,

  // Auto-placement config
  autoPlace: {
    enabled:    true,
    area:       { x: 0.05, y: 0.55, w: 0.9, h: 0.4 },
    defaultPos: { x: 0.30, y: 0.70 },
  },

  // Rendered page cache
  pageCache: {},   // pageKey -> ImageBitmap

  // Active drag (managed by preview.js)
  dragState: null,

  // Export lock
  exportActive: false,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export const pageKey = (fileIdx, pageNum) => `${fileIdx}:${pageNum}`;

export const curPageObj = () => S.pages[S.curPage] ?? null;

export const curKey = () => {
  const p = curPageObj();
  return p ? pageKey(p.fileIdx, p.pageNum) : null;
};

// Return placements for the current page (never null)
export const curPlacements = () => {
  const k = curKey();
  return k ? (S.pageStamps[k] ?? []) : [];
};

// Generate a short unique id
export const uid = () => Math.random().toString(36).slice(2, 9);
