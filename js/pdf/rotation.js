// PDF coordinate transform: visual space → raw pdf-lib space.
//
// Notation:
//   fx, fy        — normalised top-left of stamp in *visual* space (0..1)
//   vStampW/H     — stamp dimensions in visual PDF points
//   mW, mH        — raw MediaBox dimensions (what pdf-lib sees)
//   rotation      — page /Rotate value (0 | 90 | 180 | 270)
//
// /Rotate N means the viewer rotates the raw page N° CW to display it.
//
// Verified viewer transforms (raw PDF → screen, screen origin top-left, y down):
//   R=0:   sx = raw_x,      sy = mH - raw_y     visual: mW×mH
//   R=90:  sx = mH - raw_y, sy = mW - raw_x     visual: mH×mW
//   R=180: sx = mW - raw_x, sy = raw_y           visual: mW×mH
//   R=270: sx = raw_y,      sy = raw_x           visual: mH×mW
//
// Formulas verified numerically against all 4 corner mappings.
// pdf-lib counterRot bounding boxes (W=vStampW, H=vStampH, pivot at rx,ry):
//   cR=0:   [rx, rx+W] × [ry, ry+H]
//   cR=270: [rx, rx+H] × [ry-W, ry]
//   cR=180: [rx-W, rx] × [ry-H, ry]
//   cR=90:  [rx-H, rx] × [ry, ry+W]

/**
 * @param {number} fx
 * @param {number} fy
 * @param {number} vStampW  visual stamp width  in PDF points
 * @param {number} vStampH  visual stamp height in PDF points
 * @param {number} mW       raw MediaBox width
 * @param {number} mH       raw MediaBox height
 * @param {number} rotation page /Rotate (0|90|180|270)
 * @returns {{ rx:number, ry:number, counterRot:number }}
 *   rx, ry — bottom-left pivot for pdf-lib drawImage
 *   counterRot — degrees CCW to pass as rotate: degrees(counterRot)
 */
export function visualToRaw(fx, fy, vStampW, vStampH, mW, mH, rotation) {
  const r = ((rotation % 360) + 360) % 360;
  switch (r) {
    case 0:
      return {
        rx: fx * mW,
        ry: (1 - fy) * mH - vStampH,
        counterRot: 0,
      };
    case 90:
      return {
        rx: (1 - fy) * mW - vStampH,
        ry: (1 - fx) * mH,
        counterRot: 270,
      };
    case 180:
      return {
        rx: (1 - fx) * mW,
        ry: fy * mH + vStampH,
        counterRot: 180,
      };
    case 270:
      return {
        rx: fy * mW + vStampH,
        ry: fx * mH,
        counterRot: 90,
      };
    default:
      // Fallback: treat as 0
      return {
        rx: fx * mW,
        ry: (1 - fy) * mH - vStampH,
        counterRot: 0,
      };
  }
}

/**
 * Return visual dimensions given raw MediaBox and /Rotate.
 * @returns {{ vW:number, vH:number }}
 */
export function visualDims(mW, mH, rotation) {
  const r = ((rotation % 360) + 360) % 360;
  return (r === 90 || r === 270)
    ? { vW: mH, vH: mW }
    : { vW: mW, vH: mH };
}
