import { expect, test } from 'vitest';
import { photoTakenInstant, photoImagePath } from '../../src/modules/plants/plant-photo-browser';

test('blank taken time is unknown and a supplied device time becomes an explicit UTC instant', () => {
  expect(photoTakenInstant('')).toBeNull();
  expect(photoTakenInstant('2026-08-31T12:30')).toBe(new Date('2026-08-31T12:30').toISOString());
  expect(photoTakenInstant('2024-02-29T00:00')).toBe(new Date('2024-02-29T00:00').toISOString());
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
])('rejects invalid local time %s', (value) => {
  expect(() => photoTakenInstant(value)).toThrow();
});
test('image paths point to record based delivery, escaping path components', () => {
  expect(photoImagePath('plant', 'photo', 'thumbnail')).toBe(
    '/plants/plant/photos/photo/thumbnail',
  );
  expect(photoImagePath('../plant', 'https://other', 'display')).toBe(
    '/plants/..%2Fplant/photos/https%3A%2F%2Fother/display',
  );
});
