// @vitest-environment node
import sharp from 'sharp';
import { expect, test, vi } from 'vitest';
import {
  centredPhotoCrop,
  photoCropPixels,
  fitPhotoCrop,
} from '../../src/modules/plants/plant-photo-crop';
import {
  processPlantPhoto,
  processPlantPhotoThumbnail,
  processPlantPhotoPreview,
  readPlantPhotoDimensions,
} from '../../src/modules/plants/plant-photo-processing';
import {
  createPhotoKeys,
  photoVariantKey,
  assertPhotoObjectKey,
} from '../../src/modules/plants/plant-photo-keys';
import { randomUUID } from 'node:crypto';
vi.mock('server-only', () => ({}));

test.each([
  [
    { width: 4000, height: 6000 },
    { x: 0, y: 1 / 6, size: 1 },
    { left: 0, top: 1000, width: 4000, height: 4000 },
  ],
  [
    { width: 6000, height: 4000 },
    { x: 1 / 6, y: 0, size: 1 },
    { left: 1000, top: 0, width: 4000, height: 4000 },
  ],
])('centred default maps to oriented pixels (%j)', (dimensions, expected, pixels) => {
  expect(centredPhotoCrop(dimensions)).toEqual(expected);
  expect(photoCropPixels(expected, dimensions)).toEqual(pixels);
});
test.each([
  { width: 4000, height: 6000 },
  { width: 6000, height: 4000 },
])('custom square for %j', (dimensions) => {
  expect(photoCropPixels({ x: 0.25, y: 0.3, size: 0.5 }, dimensions)).toEqual({
    left: dimensions.width / 4,
    top: dimensions.height * 0.3,
    width: 2000,
    height: 2000,
  });
});
test.each([
  { x: -0.1, y: 0, size: 1 },
  { x: 0, y: 0, size: 0 },
  { x: 0.99, y: 0, size: 0.5 },
  { x: 0, y: 0.8, size: 1 },
  { x: NaN, y: 0, size: 1 },
  { x: 0, y: Infinity, size: 1 },
  { x: 0, y: 0, size: 1.001 },
  { x: 0, y: 0, size: 1, storageKey: 'bad' },
])('rejects invalid crop %j without moving it', (crop) => {
  expect(() => photoCropPixels(crop, { width: 100, height: 200 })).toThrow();
});
test('edge rounding stays inside and only the UI clamps gestures', () => {
  const dimensions = { width: 101, height: 203 };
  const crop = fitPhotoCrop({ x: 2, y: 2, size: 0.335 }, dimensions);
  const pixels = photoCropPixels(crop, dimensions);
  expect(pixels.left + pixels.width).toBe(101);
  expect(pixels.top + pixels.height).toBe(203);
  expect(() => photoCropPixels({ ...crop, x: crop.x + 0.00001 }, dimensions)).toThrow();
});

async function splitImage(orientation: number) {
  const pixels = Buffer.alloc(200 * 100 * 3);
  for (let y = 0; y < 100; y++)
    for (let x = 0; x < 200; x++) pixels[(y * 200 + x) * 3 + (x < 100 ? 0 : 2)] = 255;
  return sharp(pixels, { raw: { width: 200, height: 100, channels: 3 } })
    .withMetadata({ orientation })
    .jpeg({ quality: 100 })
    .toBuffer();
}
test.each([1, 2, 3, 4, 5, 6, 7, 8])(
  'preview and server crop share EXIF orientation %i',
  async (orientation) => {
    const original = await splitImage(orientation);
    const before = Buffer.from(original);
    const preview = await processPlantPhotoPreview(original);
    const swapped = orientation >= 5;
    expect(preview).toMatchObject({ width: swapped ? 100 : 200, height: swapped ? 200 : 100 });
    expect(await readPlantPhotoDimensions(original)).toEqual({
      width: preview.width,
      height: preview.height,
    });
    const crop = { x: 0, y: 0, size: 1 };
    const result = await processPlantPhoto(original, crop);
    expect(original).toEqual(before);
    expect(result.original).toEqual(before);
    expect(result.display).toEqual(preview.image);
    expect(await processPlantPhotoThumbnail(original, crop)).toEqual(result.thumbnail);
    const stats = await sharp(result.thumbnail).stats();
    const red = [1, 4, 5, 6].includes(orientation);
    expect(stats.channels[red ? 0 : 2].mean).toBeGreaterThan(240);
    expect(stats.channels[red ? 2 : 0].mean).toBeLessThan(10);
    const previewSelected = await sharp(
      await sharp(preview.image).extract(photoCropPixels(crop, preview)).toBuffer(),
    ).stats();
    expect(Math.abs(previewSelected.channels[0].mean - stats.channels[0].mean)).toBeLessThan(5);
    for (const bytes of [result.display, result.thumbnail, preview.image]) {
      const info = await sharp(bytes).metadata();
      expect(info.orientation).toBeUndefined();
      expect(info.exif).toBeUndefined();
    }
    expect(await sharp(result.thumbnail).metadata()).toMatchObject({ width: 100, height: 100 });
  },
);
test('changing crop changes selected pixels but never the full display', async () => {
  const original = await splitImage(6);
  const first = await processPlantPhoto(original, { x: 0, y: 0, size: 1 });
  const second = await processPlantPhoto(original, { x: 0, y: 0.5, size: 1 });
  expect(first.display).toEqual(second.display);
  expect(first.thumbnail).not.toEqual(second.thumbnail);
  expect((await sharp(second.thumbnail).stats()).channels[2].mean).toBeGreaterThan(240);
});
test('revision paths are generated safely and legacy delivery stays compatible', () => {
  const revision = randomUUID();
  const keys = createPhotoKeys(randomUUID(), 'jpg', revision);
  expect(keys.thumbnail).toMatch(new RegExp(`/thumbnails/${revision}\\.webp$`));
  expect(photoVariantKey(keys.original, 'thumbnail')).toMatch(/\/thumbnail\.webp$/);
  expect(photoVariantKey(keys.original, 'display', revision)).toBe(keys.display);
  expect(() => assertPhotoObjectKey(keys.thumbnail)).not.toThrow();
  expect(() => assertPhotoObjectKey(keys.thumbnail + '\n')).toThrow();
  expect(() => photoVariantKey(keys.original, 'thumbnail', '../display')).toThrow();
  expect(() => assertPhotoObjectKey(keys.thumbnail.replace(revision, '..'))).toThrow();
  expect(createPhotoKeys(randomUUID(), 'jpg', randomUUID()).thumbnail).not.toBe(keys.thumbnail);
});
