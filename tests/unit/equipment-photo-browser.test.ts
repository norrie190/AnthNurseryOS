import { expect, test } from 'vitest';
import {
  equipmentPhotoImagePath,
  equipmentPhotoTakenInstant,
} from '../../src/modules/equipment/equipment-photo-browser';

test('blank Equipment photo time is unknown and device time becomes a UTC instant', () => {
  expect(equipmentPhotoTakenInstant('')).toBeNull();
  expect(equipmentPhotoTakenInstant('2026-08-31T12:30')).toBe(
    new Date('2026-08-31T12:30').toISOString(),
  );
  expect(equipmentPhotoTakenInstant('2024-02-29T00:00')).toBe(
    new Date('2024-02-29T00:00').toISOString(),
  );
});

test.each([
  '2026-02-29T12:30',
  '2026-04-31T12:30',
  '2026-13-01T12:30',
  '2026-08-31',
  '2026-08-31T24:00',
  '2026-08-31T12:60',
  '0000-01-01T00:00',
  'hello',
])('rejects invalid Equipment photo local time %s', (value) => {
  expect(() => equipmentPhotoTakenInstant(value)).toThrow();
});

test('Equipment image paths escape components and only use the Equipment route', () => {
  expect(equipmentPhotoImagePath('equipment', 'photo', 'thumbnail')).toBe(
    '/equipment/equipment/photos/photo/thumbnail',
  );
  expect(equipmentPhotoImagePath('../equipment', 'https://other', 'display')).toBe(
    '/equipment/..%2Fequipment/photos/https%3A%2F%2Fother/display',
  );
  expect(equipmentPhotoImagePath('equipment', 'photo', 'thumbnail', 'revision')).toBe(
    '/equipment/equipment/photos/photo/thumbnail?v=revision',
  );
});
