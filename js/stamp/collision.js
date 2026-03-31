// Axis-aligned bounding box collision utilities for stamp placement.
// All coordinates are normalised (0..1) in visual page space.

/**
 * @typedef {{ x:number, y:number, w:number, h:number }} Rect
 */

/**
 * Test if two AABBs overlap (touching edges do NOT count as overlap).
 * @param {Rect} a
 * @param {Rect} b
 * @returns {boolean}
 */
export function overlaps(a, b) {
  return a.x < b.x + b.w &&
         a.x + a.w > b.x &&
         a.y < b.y + b.h &&
         a.y + a.h > b.y;
}

/**
 * Return true if rect overlaps any rect in the occupied array.
 * @param {Rect} rect
 * @param {Rect[]} occupied
 * @returns {boolean}
 */
export function collidesAny(rect, occupied) {
  return occupied.some(o => overlaps(rect, o));
}

/**
 * Build a normalised Rect from a stamp position and size.
 * @param {{ x:number, y:number }} pos  top-left normalised
 * @param {number} stampW  normalised width  (vStampW / vW)
 * @param {number} stampH  normalised height (vStampH / vH)
 * @returns {Rect}
 */
export function posToRect(pos, stampW, stampH) {
  return { x: pos.x, y: pos.y, w: stampW, h: stampH };
}
