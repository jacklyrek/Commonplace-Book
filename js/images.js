// Image helpers. Photos are never stored — they only pass through
// downscale → crop → OCR, then are discarded.

function loadImageEl(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not read image'));
    img.src = url;
  });
}

// Downscales to fit maxDim and re-encodes as JPEG. Modern browsers (incl. iOS
// Safari 13.4+) apply EXIF orientation during decode, so drawing to canvas is safe.
export async function downscaleImage(blob, maxDim = 2000, quality = 0.85) {
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImageEl(url);
    const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    const out = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    return out || blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}
