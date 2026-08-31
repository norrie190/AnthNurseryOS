import { z } from 'zod';
import { PhotoValidationError } from './photo-error';

export const photoCropSchema = z.strictObject({
  x: z.number().finite().min(0).lt(1),
  y: z.number().finite().min(0).lt(1),
  size: z.number().finite().gt(0).max(1),
});
export type PhotoCrop = z.infer<typeof photoCropSchema>;
export type PhotoDimensions = { width: number; height: number };

export function centredPhotoCrop({ width, height }: PhotoDimensions): PhotoCrop {
  const side = Math.min(width, height);
  return { x: (width - side) / (2 * width), y: (height - side) / (2 * height), size: 1 };
}

// Shared by the selector and Sharp. Dimensions always describe oriented pixels,
// not raw JPEG headers or a rounded/resized preview bitmap.
export function photoCropPixels(input: PhotoCrop, { width, height }: PhotoDimensions) {
  const parsed = photoCropSchema.safeParse(input);
  const validDimensions = [width, height].every((n) => Number.isSafeInteger(n) && n > 0);
  if (!parsed.success || !validDimensions) throw invalidCrop();
  const { x, y, size } = parsed.data;
  const exactSide = size * Math.min(width, height);
  // Only tolerate arithmetic noise, not a pixel of genuinely invalid selection.
  const epsilon = 1e-7;
  if (x * width + exactSide > width + epsilon || y * height + exactSide > height + epsilon)
    throw invalidCrop();
  const side = Math.max(1, Math.round(exactSide));
  return {
    left: Math.min(width - side, Math.round(x * width)),
    top: Math.min(height - side, Math.round(y * height)),
    width: side,
    height: side,
  };
}

function invalidCrop() {
  return new PhotoValidationError('Keep the square crop inside the photograph.', {
    issues: [{ field: 'crop', message: 'Choose a valid square inside the photograph.' }],
  });
}

// UI movement/resize intentionally clamps a user's gesture at the image edge.
// Server validation above never silently repairs an invalid submitted rectangle.
export function fitPhotoCrop(crop: PhotoCrop, { width, height }: PhotoDimensions): PhotoCrop {
  const size = Math.max(0.01, Math.min(1, crop.size));
  const side = size * Math.min(width, height);
  return {
    x: Math.max(0, Math.min(1 - side / width, crop.x)),
    y: Math.max(0, Math.min(1 - side / height, crop.y)),
    size,
  };
}
