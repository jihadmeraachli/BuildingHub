/** Pixel rect returned by react-easy-crop's onCropComplete. */
export interface CropArea { x: number; y: number; width: number; height: number }

/**
 * Crop `src` to `area` and return a square JPEG blob, downscaled to at most
 * `size` px. Avatars are displayed at 80px — storing the original 8MP photo
 * would be wasteful and slow to load.
 */
export async function cropToSquare(src: string, area: CropArea, size = 512): Promise<Blob | null> {
  const img = await loadImage(src);

  const canvas = document.createElement('canvas');
  const side = Math.min(size, Math.round(area.width));
  canvas.width = side;
  canvas.height = side;

  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // fill first: transparent PNGs would otherwise crop to black in a JPEG
  ctx.fillStyle = '#0b0f17';
  ctx.fillRect(0, 0, side, side);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, area.x, area.y, area.width, area.height, 0, 0, side, side);

  return new Promise(resolve => canvas.toBlob(b => resolve(b), 'image/jpeg', 0.9));
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.addEventListener('load', () => resolve(img));
    img.addEventListener('error', reject);
    img.src = src;
  });
}
