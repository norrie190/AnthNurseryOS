// @vitest-environment node
import sharp from 'sharp';
import { expect, test, vi } from 'vitest';
import { PhotoValidationError } from '../../src/lib/photos/photo-error';
import {
  processPhoto,
  processPhotoPreview,
  processPhotoThumbnail,
} from '../../src/lib/photos/photo-processing';
import { photoCropPixels, centredPhotoCrop } from '../../src/lib/photos/photo-crop';
import {
  MAX_PHOTO_BYTES,
  MAX_PHOTO_PIXELS,
  normalisePhotoFilename,
} from '../../src/lib/photos/photo-limits';
import { processPlantPhoto } from '../../src/modules/plants/plant-photo-processing';
import { photoCropPixels as plantCropPixels } from '../../src/modules/plants/plant-photo-crop';
import { PlantError } from '../../src/modules/plants/plant-errors';
import { rethrowPlantPhotoValidation } from '../../src/modules/plants/plant-photo-errors';
import { photoFixture, orientedPhotoFixture } from '../fixtures/plant-photo-images';
vi.mock('server-only', () => ({}));

test.each(['jpeg', 'png', 'webp'] as const)(
  'shared %s pipeline and Plant wrapper return identical bytes',
  async (format) => {
    const original = await photoFixture(format, 100, 200);
    const crop = { x: 0, y: 0.25, size: 1 };
    const shared = await processPhoto(original, crop);
    expect(await processPlantPhoto(original, crop)).toEqual(shared);
    expect(shared.original).toEqual(original);
    expect(await sharp(shared.display).metadata()).toMatchObject({ width: 100, height: 200 });
    expect(await sharp(shared.thumbnail).metadata()).toMatchObject({ width: 100, height: 100 });
    expect(await processPhotoThumbnail(original, crop)).toEqual(shared.thumbnail);
  },
);
test('shared preview retains oriented dimensions and display output with no metadata', async () => {
  const image = await orientedPhotoFixture();
  const preview = await processPhotoPreview(image);
  const result = await processPhoto(image);
  expect(preview).toMatchObject({ width: 200, height: 400 });
  expect(preview.image).toEqual(result.display);
  for (const variant of [result.display, result.thumbnail]) {
    const metadata = await sharp(variant).metadata();
    for (const key of ['exif', 'xmp', 'icc', 'orientation'] as const)
      expect(metadata[key]).toBeUndefined();
  }
});
test('neutral errors map to the previous Plant validation message, fields and cause', async () => {
  const invalid = Buffer.from('not an image');
  await expect(processPhoto(invalid)).rejects.toBeInstanceOf(PhotoValidationError);
  await expect(processPlantPhoto(invalid)).rejects.toBeInstanceOf(PlantError);
  const shared = (await processPhoto(invalid).catch(
    (error: unknown) => error,
  )) as PhotoValidationError;
  const domain = (await processPlantPhoto(invalid).catch((error: unknown) => error)) as PlantError;
  expect(domain.code).toBe('VALIDATION_FAILED');
  expect(domain.message).toBe(shared.message);
  expect(domain.issues).toEqual(shared.issues);
  const cause = new Error('decoder cause');
  const neutral = new PhotoValidationError('Failed', {
    cause,
    issues: [{ field: 'image', message: 'Failed' }],
  });
  try {
    rethrowPlantPhotoValidation(neutral);
  } catch (error) {
    expect(error).toMatchObject({ code: 'VALIDATION_FAILED', cause });
  }
  expect(() => rethrowPlantPhotoValidation(cause)).toThrow(cause);
});
test('neutral crop validation and Plant wrapper preserve finite/bounds behaviour', () => {
  const dimensions = { width: 4000, height: 6000 };
  expect(centredPhotoCrop(dimensions)).toEqual({ x: 0, y: 1 / 6, size: 1 });
  const crop = { x: 0.9, y: 0, size: 1 };
  expect(() => photoCropPixels(crop, dimensions)).toThrow(PhotoValidationError);
  expect(() => plantCropPixels(crop, dimensions)).toThrow(PlantError);
});
test('limits and filename sanitation remain identical', () => {
  expect(MAX_PHOTO_BYTES).toBe(10485760);
  expect(MAX_PHOTO_PIXELS).toBe(50000000);
  expect(normalisePhotoFilename('C:\\folder\\\u0000 photo.jpg ')).toBe('photo.jpg');
  expect(normalisePhotoFilename('../../photo.jpg')).toBe('photo.jpg');
});
