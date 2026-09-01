// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { expect, test, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  assertEquipmentPhotoAssetObjectKey,
  assertEquipmentPhotoObjectKey,
  createEquipmentPhotoKeys,
  equipmentPhotoAssetPrefix,
  equipmentPhotoVariantKey,
  parseEquipmentPhotoStorageKey,
} from '../../src/modules/equipment/equipment-photo-keys';
import {
  createPhotoKeys as createPlantPhotoKeys,
  parsePhotoStorageKey as parsePlantPhotoStorageKey,
} from '../../src/modules/plants/plant-photo-keys';

const equipmentId = randomUUID();
const revision = randomUUID();

test('Equipment keys use only the approved namespace and revision layout', () => {
  const keys = createEquipmentPhotoKeys(equipmentId, 'jpg', revision);
  const parsed = parseEquipmentPhotoStorageKey(keys.original);
  expect(parsed).toMatchObject({ equipmentId, extension: 'jpg' });
  expect(keys.original).toBe(`equipment/${equipmentId}/${parsed.assetId}/original.jpg`);
  expect(keys.display).toBe(`equipment/${equipmentId}/${parsed.assetId}/display.webp`);
  expect(keys.thumbnail).toBe(
    `equipment/${equipmentId}/${parsed.assetId}/thumbnails/${revision}.webp`,
  );
  expect(equipmentPhotoAssetPrefix(keys.original)).toBe(
    `equipment/${equipmentId}/${parsed.assetId}/`,
  );
});

test('Equipment and Plant wrappers reject one another in both directions', () => {
  const equipment = createEquipmentPhotoKeys(equipmentId, 'png', revision);
  const plant = createPlantPhotoKeys(randomUUID(), 'png', revision);
  for (const key of Object.values(equipment)) {
    expect(() => parsePlantPhotoStorageKey(key)).toThrow();
    expect(() => assertEquipmentPhotoObjectKey(key)).not.toThrow();
  }
  for (const key of Object.values(plant)) {
    expect(() => parseEquipmentPhotoStorageKey(key)).toThrow();
    expect(() => assertEquipmentPhotoObjectKey(key)).toThrow();
  }
});

test.each([
  'equipment/',
  `equipment/${equipmentId}/`,
  `equipment/${equipmentId}/${randomUUID()}/`,
  `equipment/${equipmentId}/invalid/original.jpg`,
  `equipment/invalid/${randomUUID()}/original.jpg`,
  `equipment/${equipmentId}/${randomUUID()}/original.gif`,
  `equipment/${equipmentId}/${randomUUID()}/../original.jpg`,
  `plants/${equipmentId}/${randomUUID()}/original.jpg`,
])('malformed or broad Equipment path is rejected: %s', (key) => {
  expect(() => parseEquipmentPhotoStorageKey(key)).toThrow();
  expect(() => equipmentPhotoAssetPrefix(key)).toThrow();
});

test('asset validation cannot escape to another asset, owner or namespace', () => {
  const original = createEquipmentPhotoKeys(equipmentId, 'webp').original;
  const ownRevision = equipmentPhotoVariantKey(original, 'thumbnail', revision);
  expect(() => assertEquipmentPhotoAssetObjectKey(original, ownRevision)).not.toThrow();
  for (const key of [
    createEquipmentPhotoKeys(equipmentId, 'webp').display,
    createEquipmentPhotoKeys(randomUUID(), 'webp').display,
    createPlantPhotoKeys(randomUUID(), 'webp').display,
    `${equipmentPhotoAssetPrefix(original)}../display.webp`,
  ])
    expect(() => assertEquipmentPhotoAssetObjectKey(original, key)).toThrow();
});

test('arbitrary variants and revisions are rejected', () => {
  const original = createEquipmentPhotoKeys(equipmentId, 'jpg').original;
  expect(() => equipmentPhotoVariantKey(original, 'original' as 'display')).toThrow();
  expect(() => equipmentPhotoVariantKey(original, 'thumbnail', 'not-a-uuid')).toThrow();
});
