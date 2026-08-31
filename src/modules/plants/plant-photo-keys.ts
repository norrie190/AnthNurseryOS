import 'server-only';
import * as keys from '../../lib/photos/photo-keys';
import type { PhotoExtension, PhotoVariant } from '../../lib/photos/photo-keys';

export {
  photoVariantSchema,
  type PhotoExtension,
  type PhotoVariant,
} from '../../lib/photos/photo-keys';
// Plant callers cannot choose a different namespace.
export function createPhotoKeys(plantId: string, extension: PhotoExtension, revision?: string) {
  return keys.createPhotoKeys('plants', plantId, extension, revision);
}
export function parsePhotoStorageKey(key: string) {
  const parsed = keys.parsePhotoStorageKey('plants', key);
  return { plantId: parsed.ownerId, assetId: parsed.assetId, extension: parsed.extension };
}
export function photoAssetPrefix(originalKey: string) {
  return keys.photoAssetPrefix('plants', originalKey);
}
export function assertPhotoAssetObjectKey(originalKey: string, key: string) {
  return keys.assertPhotoAssetObjectKey('plants', originalKey, key);
}
export function photoVariantKey(original: string, variant: PhotoVariant, revision?: string | null) {
  return keys.photoVariantKey('plants', original, variant, revision);
}
export function assertPhotoObjectKey(key: string) {
  return keys.assertPhotoObjectKey('plants', key);
}
