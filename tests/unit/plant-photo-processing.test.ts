// @vitest-environment node
import { expect, test, vi } from 'vitest';
import sharp from 'sharp';
import { processPlantPhoto } from '../../src/modules/plants/plant-photo-processing';
import { MAX_PHOTO_BYTES } from '../../src/modules/plants/plant-photo-input';
import {
  animatedPhotoFixture,
  orientedPhotoFixture,
  photoFixture,
} from '../fixtures/plant-photo-images';

vi.mock('server-only', () => ({}));

test.each(['jpeg', 'png', 'webp'] as const)(
  'fully decodes %s and retains exactly the original bytes',
  async (format) => {
    const image = await photoFixture(format);
    const result = await processPlantPhoto(image);
    expect(result.original).toEqual(image);
    expect(result.extension).toBe(format === 'jpeg' ? 'jpg' : format);
    for (const variant of ['display', 'thumbnail'] as const) {
      expect(await sharp(result[variant]).metadata()).toMatchObject({
        format: 'webp',
        width: variant === 'display' ? 16 : 12,
        height: 12,
      });
    }
  },
);

test('keeps full display and square thumbnail without enlarging', async () => {
  const large = await processPlantPhoto(await photoFixture('jpeg', 3000, 1500));
  expect(await sharp(large.display).metadata()).toMatchObject({ width: 2560, height: 1280 });
  expect(await sharp(large.thumbnail).metadata()).toMatchObject({ width: 320, height: 320 });
  const portrait = await processPlantPhoto(await photoFixture('png', 100, 500));
  expect(await sharp(portrait.display).metadata()).toMatchObject({ width: 100, height: 500 });
  expect(await sharp(portrait.thumbnail).metadata()).toMatchObject({ width: 100, height: 100 });
});

test('applies orientation and removes EXIF, GPS, XMP and ICC from both served copies', async () => {
  const original = await orientedPhotoFixture();
  const metadata = await sharp(original).metadata();
  expect(metadata.orientation).toBe(6);
  expect(metadata.exif).toBeDefined();
  expect(metadata.xmp).toBeDefined();
  const result = await processPlantPhoto(original);
  expect(await sharp(result.display).metadata()).toMatchObject({ width: 200, height: 400 });
  expect(await sharp(result.thumbnail).metadata()).toMatchObject({ width: 200, height: 200 });
  for (const bytes of [result.display, result.thumbnail]) {
    const served = await sharp(bytes).metadata();
    for (const key of ['exif', 'xmp', 'icc', 'orientation'] as const)
      expect(served[key]).toBeUndefined();
    expect(bytes.includes(Buffer.from('PRIVATE'))).toBe(false);
  }
});

test.each(['gif', 'tiff'] as const)(
  'rejects %s before treating it as an accepted format',
  async (format) => {
    await expect(processPlantPhoto(await photoFixture(format))).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  },
);
test.each([
  Buffer.from('not an image'),
  Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
  Buffer.from('0000ftypheic'),
  Buffer.from('RAW'),
  Buffer.alloc(0),
])('rejects malformed/unsupported content', async (image) => {
  await expect(processPlantPhoto(image)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
});
test('rejects a truncated JPEG even when its signature and metadata are valid', async () => {
  const image = await photoFixture('jpeg', 640, 480);
  await expect(processPlantPhoto(image.subarray(0, image.length - 30))).rejects.toMatchObject({
    code: 'VALIDATION_FAILED',
  });
});
test('rejects an oversized actual buffer', async () => {
  await expect(processPlantPhoto(Buffer.alloc(MAX_PHOTO_BYTES + 1))).rejects.toMatchObject({
    code: 'VALIDATION_FAILED',
  });
});
test('rejects excessive decoded dimensions from a tiny compressed PNG header', async () => {
  const image = await photoFixture();
  image.writeUInt32BE(10000, 16);
  image.writeUInt32BE(10000, 20);
  // Correct the IHDR CRC to exercise the pixel limit, not an unrelated checksum error.
  const { crc32 } = await import('node:zlib');
  image.writeUInt32BE(crc32(image.subarray(12, 29)), 29);
  await expect(processPlantPhoto(image)).rejects.toMatchObject({
    code: 'VALIDATION_FAILED',
    cause: expect.any(Error),
  });
});
test('rejects actual animated WebP', async () => {
  const image = await animatedPhotoFixture();
  expect((await sharp(image, { animated: true }).metadata()).pages).toBe(2);
  await expect(processPlantPhoto(image)).rejects.toThrow('Animated');
});
test('rejects an APNG animation control chunk even if the decoder would ignore it', async () => {
  const png = await photoFixture();
  const animationChunk = Buffer.alloc(20);
  animationChunk.writeUInt32BE(8, 0);
  animationChunk.write('acTL', 4, 'ascii');
  animationChunk.writeUInt32BE(2, 8);
  const { crc32 } = await import('node:zlib');
  animationChunk.writeUInt32BE(crc32(animationChunk.subarray(4, 16)), 16);
  await expect(
    processPlantPhoto(Buffer.concat([png.subarray(0, 33), animationChunk, png.subarray(33)])),
  ).rejects.toThrow('Animated');
});
