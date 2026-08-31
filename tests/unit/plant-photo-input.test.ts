// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { expect, test, vi } from 'vitest';
import {
  parseUploadPlantPhoto,
  parseSetPrimaryPlantPhoto,
  normalisePhotoFilename,
  MAX_PHOTO_BYTES,
} from '../../src/modules/plants/plant-photo-input';
import { createPhotoKeys, photoVariantKey } from '../../src/modules/plants/plant-photo-keys';
vi.mock('server-only', () => ({}));
const plantId = randomUUID();
const input = { image: Buffer.from('bytes'), expectedUpdatedAt: '2026-08-31T11:00:00.000Z' };

test.each([
  'id',
  'photoId',
  'storageKey',
  'isPrimary',
  'sortOrder',
  'createdAt',
  'updatedAt',
  'plant',
  'delete',
  'mimeType',
  'reference',
])('rejects unexpected %s', (key) => {
  expect(() => parseUploadPlantPhoto(plantId, { ...input, [key]: 'injected' })).toThrow();
});
test('normalises optional metadata and copies the supplied bytes', () => {
  const result = parseUploadPlantPhoto(plantId, {
    ...input,
    originalFilename: 'C:\\fakepath\\ ../ leaf\u0000.jpg ',
    caption: '   ',
    takenAt: '2026-08-31T12:00:00.000+01:00',
  });
  expect(result.input.originalFilename).toBe('leaf.jpg');
  expect(result.input.caption).toBeNull();
  expect(new Date(result.input.takenAt!).toISOString()).toBe('2026-08-31T11:00:00.000Z');
  expect(result.input.image).toEqual(input.image);
  expect(result.input.image).not.toBe(input.image);
});
test.each(['', '.', '..', ' / '])('normalises meaningless filename %s to null', (filename) =>
  expect(normalisePhotoFilename(filename)).toBeNull(),
);
test('limits retained filename length without splitting surrogate pairs', () =>
  expect(Array.from(normalisePhotoFilename('🌱'.repeat(300))!)).toHaveLength(255));
test.each([
  {},
  { ...input, image: 'C:/file.jpg' },
  { ...input, image: Buffer.alloc(0) },
  { ...input, image: Buffer.alloc(MAX_PHOTO_BYTES + 1) },
  { ...input, takenAt: '2026-02-30T12:00:00.000Z' },
  { ...input, takenAt: '2026-08-31' },
  { ...input, expectedUpdatedAt: 'bad' },
  { ...input, caption: 'x'.repeat(2001) },
  { ...input, caption: 'Invalid\0caption' },
  { ...input, takenAt: '0000-01-01T12:00:00.000Z' },
])('rejects invalid metadata or file input', (value) =>
  expect(() => parseUploadPlantPhoto(plantId, value)).toThrow(),
);
test('validates primary request as a strict token and photo ID pair', () => {
  const value = { photoId: randomUUID(), expectedUpdatedAt: input.expectedUpdatedAt };
  expect(parseSetPrimaryPlantPhoto(plantId, value).input).toEqual(value);
  expect(() => parseSetPrimaryPlantPhoto(plantId, { ...value, isPrimary: true })).toThrow();
  expect(() => parseSetPrimaryPlantPhoto(plantId, { ...value, photoId: 'bad' })).toThrow();
});
test('generates unique safe companion paths independently of filenames and references', () => {
  const first = createPhotoKeys(plantId, 'jpg');
  const second = createPhotoKeys(plantId, 'jpg');
  expect(first.original).not.toBe(second.original);
  expect(first.original).toMatch(new RegExp(`^plants/${plantId}/[a-f0-9-]{36}/original.jpg$`));
  expect(photoVariantKey(first.original, 'display')).toBe(first.display);
  expect(photoVariantKey(first.original, 'thumbnail')).toBe(first.thumbnail);
  expect(() => createPhotoKeys('../../ANT-0001', 'png')).toThrow();
  expect(() => createPhotoKeys(plantId, '../../file' as 'jpg')).toThrow();
});
test.each([
  '../../original.jpg',
  'https://example.com/original.jpg',
  `plants/${plantId}/../original.jpg`,
  `plants/${plantId}/${randomUUID()}/original.jpg/../secret`,
  `plants/${plantId}/${randomUUID()}/original.jpg\n`,
])('rejects arbitrary signing/companion key %s', (key) =>
  expect(() => photoVariantKey(key, 'display')).toThrow(),
);
test('never derives an original or arbitrary variant for delivery', () => {
  expect(() =>
    photoVariantKey(createPhotoKeys(plantId, 'png').original, 'original' as 'display'),
  ).toThrow();
});
