// PDF coordinate transform: visual space → raw pdf-lib space.
//
// Notation:
//   fx, fy        — normalised top-left of stamp in *visual* space (0..1)
//   vStampW/H     — stamp dimensions in visual PDF points
//   mW, mH        — raw MediaBox dimensions (what pdf-lib sees)
//   rotation      — page /Rotate value (0 | 90 | 180 | 270)
//
// The viewer applies /Rotate CCW when displaying the page.
// We pre-rotate the stamp by (360 - rotation) so it appears upright.
//
// Viewer screen→raw inverse transforms (screen y-axis is down):
//   R=0:   px = sx,      py = mH - sy
//   R=90:  px = mW - sy, py = sx
//   R=180: px = mW - sx, py = sy
//   R=270: px = sy,      py = mH - sx
//
// All formulas verified by working through the full rotation matrix algebra.
// See /root/.claude/plans/expressive-sleeping-twilight.md for derivation.

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
      // V1 had ry = (1-fx)*mH  ← was wrong; correct: fx*mH + vStampW
      return {
        rx: (1 - fy) * mW - vStampH,
        ry: fx * mH + vStampW,
        counterRot: 270,
      };
    case 180:
      return {
        rx: (1 - fx) * mW,
        ry: fy * mH + vStampH,
        counterRot: 180,
      };
    case 270:
      // V1 had ry = fx*mH  ← was wrong; correct: (1-fx)*mH - vStampW
      return {
        rx: fy * mW + vStampH,
        ry: (1 - fx) * mH - vStampW,
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
