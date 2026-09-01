import { vi } from 'vitest';
import {
  assertEquipmentPhotoAssetObjectKey,
  equipmentPhotoAssetPrefix,
} from '../../src/modules/equipment/equipment-photo-keys';
import type {
  EquipmentPhotoStorage,
  PhotoCleanupResult,
  PhotoObject,
} from '../../src/modules/equipment/equipment-photo-storage';

export function fakeEquipmentPhotoStorage() {
  const objects = new Map<string, PhotoObject>();
  const storage = {
    bucket: 'fake-equipment-photos-only',
    removePhotoAsset: vi.fn(async (originalKey: string) => {
      const prefix = equipmentPhotoAssetPrefix(originalKey);
      const keys = [...objects.keys()].filter((key) => key.startsWith(prefix));
      for (const key of keys) assertEquipmentPhotoAssetObjectKey(originalKey, key);
      for (const key of keys) objects.delete(key);
    }),
    readOriginal: vi.fn(async (key: string) => {
      const object = objects.get(key);
      if (!object) throw new Error('Original is unavailable');
      return Buffer.from(object.body);
    }),
    upload: vi.fn(async (object: PhotoObject) => {
      if (objects.has(object.key)) throw new Error('Object already exists');
      objects.set(object.key, { ...object, body: Buffer.from(object.body) });
    }),
    lookup: vi.fn(async (key: string) => {
      const object = objects.get(key);
      return object ? { uploadId: object.uploadId, etag: 'fake' } : null;
    }),
    remove: vi.fn(async (key: string, uploadId: string): Promise<PhotoCleanupResult> => {
      const object = objects.get(key);
      if (!object) return 'absent';
      if (object.uploadId !== uploadId) return 'not-owned';
      objects.delete(key);
      return 'removed';
    }),
    signVariant: vi.fn<EquipmentPhotoStorage['signVariant']>(
      async () => 'https://example.invalid/private-equipment-photo',
    ),
  } satisfies EquipmentPhotoStorage;
  return { storage, objects };
}
