import { vi } from 'vitest';
import type {
  PhotoObject,
  PhotoCleanupResult,
  PlantPhotoStorage,
} from '../../src/modules/plants/plant-photo-storage';

export function fakePlantPhotoStorage() {
  const objects = new Map<string, PhotoObject>();
  const storage = {
    bucket: 'fake-plant-photos-only',
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
