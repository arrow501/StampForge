// Canvas and image utilities.

// Load a File or data-URL into an ImageBitmap.
// Applies browser EXIF auto-correction by routing through an <img> element.
export async function loadImageBitmap(source) {
  const url = source instanceof File
    ? URL.createObjectURL(source)
    : source;  // data URL or object URL

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = async () => {
      // Draw through canvas so EXIF rotation is baked in
      const canvas = new OffscreenCanvas(img.naturalWidth, img.naturalHeight);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      if (source instanceof File) URL.revokeObjectURL(url);
      try {
        resolve(await createImageBitmap(canvas));
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = () => {
      if (source instanceof File) URL.revokeObjectURL(url);
      reject(new Error('Failed to load image'));
    };
    img.src = url;
  });
}

// Convert a File to a data URL (for persistence)
export function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target.result);
    reader.onerror = () => reject(new Error('FileReader failed'));
    reader.readAsDataURL(file);
  });
}

// Draw imageBitmap centred + letterboxed into a canvas element
export function drawFit(canvas, bitmap) {
  const ctx = canvas.getContext('2d');
  const scale = Math.min(canvas.width / bitmap.width, canvas.height / bitmap.height);
  const w = bitmap.width * scale;
  const h = bitmap.height * scale;
  const x = (canvas.width  - w) / 2;
  const y = (canvas.height - h) / 2;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, x, y, w, h);
}

// Measure the display size of a canvas element in CSS pixels
export function cssSize(el) {
  const r = el.getBoundingClientRect();
  return { w: r.width, h: r.height };
}
