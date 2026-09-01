import 'server-only';
import * as keys from '../../lib/photos/photo-keys';
import type { PhotoExtension, PhotoVariant } from '../../lib/photos/photo-keys';

export {
  photoVariantSchema,
  type PhotoExtension,
  type PhotoVariant,
} from '../../lib/photos/photo-keys';

// Equipment callers cannot choose a different namespace.
export function createEquipmentPhotoKeys(
  equipmentId: string,
  extension: PhotoExtension,
  revision?: string,
) {
  return keys.createPhotoKeys('equipment', equipmentId, extension, revision);
}

export function parseEquipmentPhotoStorageKey(key: string) {
  const parsed = keys.parsePhotoStorageKey('equipment', key);
  return { equipmentId: parsed.ownerId, assetId: parsed.assetId, extension: parsed.extension };
}

export function equipmentPhotoAssetPrefix(originalKey: string) {
  return keys.photoAssetPrefix('equipment', originalKey);
}

export function assertEquipmentPhotoAssetObjectKey(originalKey: string, key: string) {
  return keys.assertPhotoAssetObjectKey('equipment', originalKey, key);
}

export function equipmentPhotoVariantKey(
  original: string,
  variant: PhotoVariant,
  revision?: string | null,
) {
  return keys.photoVariantKey('equipment', original, variant, revision);
}

export function assertEquipmentPhotoObjectKey(key: string) {
  return keys.assertPhotoObjectKey('equipment', key);
}
