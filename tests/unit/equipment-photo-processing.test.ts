// @vitest-environment node
import sharp from 'sharp';
import { expect, test, vi } from 'vitest';
import {
  processEquipmentPhoto,
  processEquipmentPhotoPreview,
  processEquipmentPhotoThumbnail,
  readEquipmentPhotoDimensions,
} from '../../src/modules/equipment/equipment-photo-processing';
import { EquipmentError } from '../../src/modules/equipment/equipment-errors';
import { orientedPhotoFixture, photoFixture } from '../fixtures/plant-photo-images';

vi.mock('server-only', () => ({}));

test.each(['jpeg', 'png', 'webp'] as const)(
  'Equipment %s processing retains original and creates natural display plus square thumbnail',
  async (format) => {
    const original = await photoFixture(format, 100, 200);
    const result = await processEquipmentPhoto(original, { x: 0, y: 0.25, size: 1 });
    expect(result.original).toEqual(original);
    expect(await sharp(result.display).metadata()).toMatchObject({ width: 100, height: 200 });
    expect(await sharp(result.thumbnail).metadata()).toMatchObject({ width: 100, height: 100 });
    expect(await processEquipmentPhotoThumbnail(original, { x: 0, y: 0.25, size: 1 })).toEqual(
      result.thumbnail,
    );
  },
);

test('Equipment preview, dimensions and derivatives share EXIF orientation and strip metadata', async () => {
  const original = await orientedPhotoFixture();
  const preview = await processEquipmentPhotoPreview(original);
  const result = await processEquipmentPhoto(original);
  expect(preview).toMatchObject({ width: 200, height: 400 });
  expect(await readEquipmentPhotoDimensions(original)).toEqual({ width: 200, height: 400 });
  expect(preview.image).toEqual(result.display);
  expect(result.original).toEqual(original);
  for (const bytes of [result.display, result.thumbnail]) {
    const metadata = await sharp(bytes).metadata();
    expect(metadata.orientation).toBeUndefined();
    expect(metadata.exif).toBeUndefined();
  }
});

test('shared processing validation maps to EquipmentError without weakening messages', async () => {
  await expect(processEquipmentPhoto(Buffer.from('not an image'))).rejects.toBeInstanceOf(
    EquipmentError,
  );
  await expect(processEquipmentPhoto(Buffer.from('not an image'))).rejects.toMatchObject({
    code: 'VALIDATION_FAILED',
    issues: [{ field: 'image' }],
  });
});
