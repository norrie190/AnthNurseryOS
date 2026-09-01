// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { expect, test, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  parseDeleteEquipmentPhoto,
  parseSetPrimaryEquipmentPhoto,
  parseUpdateEquipmentPhotoCrop,
  parseUploadEquipmentPhoto,
} from '../../src/modules/equipment/equipment-photo-input';

const equipmentId = randomUUID();
const photoId = randomUUID();
const token = '2026-09-01T08:00:00.000Z';
const image = Buffer.from([1, 2, 3]);

test('upload retains only approved normalised values and owns a copy of the bytes', () => {
  const supplied = new Uint8Array(image);
  const parsed = parseUploadEquipmentPhoto(equipmentId, {
    image: supplied,
    originalFilename: '../../ controller.jpg ',
    caption: ' Front label ',
    takenAt: '2026-09-01T07:00:00.000Z',
    crop: { x: 0, y: 0.2, size: 0.5 },
    expectedUpdatedAt: token,
  });
  supplied[0] = 99;
  expect(parsed).toMatchObject({
    equipmentId,
    input: {
      originalFilename: 'controller.jpg',
      caption: 'Front label',
      crop: { x: 0, y: 0.2, size: 0.5 },
      expectedUpdatedAt: token,
    },
  });
  expect(parsed.input.image).toEqual(image);
});

test.each([
  'id',
  'photoId',
  'storageKey',
  'assetId',
  'isPrimary',
  'sortOrder',
  'derivativeRevision',
  'createdAt',
  'updatedAt',
  'equipment',
  'photos',
])('upload rejects injected %s', (key) => {
  expect(() =>
    parseUploadEquipmentPhoto(equipmentId, { image, expectedUpdatedAt: token, [key]: 'bad' }),
  ).toThrow();
});

test('primary, crop and deletion inputs reject route identity and arbitrary operations', () => {
  expect(parseSetPrimaryEquipmentPhoto(equipmentId, { photoId, expectedUpdatedAt: token })).toEqual(
    { equipmentId, input: { photoId, expectedUpdatedAt: token } },
  );
  expect(
    parseUpdateEquipmentPhotoCrop(equipmentId, photoId, {
      crop: { x: 0, y: 0, size: 1 },
      expectedUpdatedAt: token,
    }),
  ).toEqual({
    equipmentId,
    input: { photoId, crop: { x: 0, y: 0, size: 1 }, expectedUpdatedAt: token },
  });
  expect(
    parseDeleteEquipmentPhoto(equipmentId, photoId, {
      confirmed: true,
      expectedUpdatedAt: token,
    }),
  ).toEqual({ equipmentId, input: { photoId, confirmed: true, expectedUpdatedAt: token } });
  for (const injected of [{ photoId: randomUUID() }, { deleteMany: {} }, { prefix: 'equipment/' }])
    expect(() =>
      parseDeleteEquipmentPhoto(equipmentId, photoId, {
        confirmed: true,
        expectedUpdatedAt: token,
        ...injected,
      }),
    ).toThrow();
});

test('invalid token, crop, caption and delete confirmation map to Equipment validation errors', () => {
  for (const operation of [
    () => parseUploadEquipmentPhoto(equipmentId, { image, expectedUpdatedAt: 'now' }),
    () =>
      parseUploadEquipmentPhoto(equipmentId, {
        image,
        caption: 'bad\0caption',
        expectedUpdatedAt: token,
      }),
    () =>
      parseUpdateEquipmentPhotoCrop(equipmentId, photoId, {
        crop: { x: 0.9, y: 0, size: 2 },
        expectedUpdatedAt: token,
      }),
    () =>
      parseDeleteEquipmentPhoto(equipmentId, photoId, {
        confirmed: false as true,
        expectedUpdatedAt: token,
      }),
  ])
    expect(operation).toThrowError(expect.objectContaining({ code: 'VALIDATION_FAILED' }));
});
