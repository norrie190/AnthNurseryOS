import { vi } from 'vitest';
import {
  photoAssetPrefix,
  assertPhotoAssetObjectKey,
} from '../../src/modules/plants/plant-photo-keys';
import type {
  PhotoObject,
  PhotoCleanupResult,
  PlantPhotoStorage,
} from '../../src/modules/plants/plant-photo-storage';

export function fakePlantPhotoStorage() {
  const objects = new Map<string, PhotoObject>();
  const storage = {
    bucket: 'fake-plant-photos-only',
    removePhotoAsset: vi.fn(async (originalKey: string) => {
      const prefix = photoAssetPrefix(originalKey);
      const keys = [...objects.keys()].filter((key) => key.startsWith(prefix));
      for (const key of keys) assertPhotoAssetObjectKey(originalKey, key);
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
    signVariant: vi.fn<PlantPhotoStorage['signVariant']>(
      async () => 'https://example.invalid/private-photo',
    ),
  } satisfies PlantPhotoStorage;
  return { storage, objects };
}
