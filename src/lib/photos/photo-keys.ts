import 'server-only';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

export type PhotoExtension = 'jpg' | 'png' | 'webp';
export type PhotoVariant = 'display' | 'thumbnail';
const extensionSchema = z.enum(['jpg', 'png', 'webp']);
export const photoVariantSchema = z.enum(['display', 'thumbnail']);
export const photoNamespaceSchema = z.enum(['plants', 'equipment']);
export type PhotoNamespace = z.infer<typeof photoNamespaceSchema>;
const originalPattern = /^(plants|equipment)\/([^/]+)\/([^/]+)\/original\.(jpg|png|webp)$/;

export function createPhotoKeys(
  namespace: PhotoNamespace,
  ownerId: string,
  extension: PhotoExtension,
  revision?: string,
) {
  photoNamespaceSchema.parse(namespace);
  const owner = z.uuid().parse(ownerId).toLowerCase();
  const assetId = randomUUID();
  const original = `${namespace}/${owner}/${assetId}/original.${extensionSchema.parse(extension)}`;
  return {
    original,
    display: photoVariantKey(namespace, original, 'display'),
    thumbnail: photoVariantKey(namespace, original, 'thumbnail', revision),
  };
}

export function parsePhotoStorageKey(namespace: PhotoNamespace, key: string) {
  photoNamespaceSchema.parse(namespace);
  const match = originalPattern.exec(key);
  if (
    !match ||
    match[0] !== key ||
    match[1] !== namespace ||
    !z.uuid().safeParse(match[2]).success ||
    !z.uuid().safeParse(match[3]).success
  ) {
    throw new Error('Invalid photo storage key or namespace.');
  }
  return {
    namespace,
    ownerId: match[2],
    assetId: match[3],
    extension: extensionSchema.parse(match[4]),
  };
}

export function photoAssetPrefix(namespace: PhotoNamespace, originalKey: string): string {
  parsePhotoStorageKey(namespace, originalKey);
  // Keep the trailing slash: an adjacent asset must never match this prefix.
  return originalKey.slice(0, originalKey.lastIndexOf('/') + 1);
}

export function assertPhotoAssetObjectKey(
  namespace: PhotoNamespace,
  originalKey: string,
  key: string,
): void {
  const prefix = photoAssetPrefix(namespace, originalKey);
  if (!key.startsWith(prefix)) throw new Error('Object is outside the photo asset.');
  assertPhotoObjectKey(namespace, key);
}

export function photoVariantKey(
  namespace: PhotoNamespace,
  original: string,
  variant: PhotoVariant,
  revision?: string | null,
): string {
  parsePhotoStorageKey(namespace, original);
  photoVariantSchema.parse(variant);
  if (revision != null) z.uuid().parse(revision);
  return (
    original.slice(0, original.lastIndexOf('/') + 1) +
    (variant === 'thumbnail' && revision ? `thumbnails/${revision}.webp` : `${variant}.webp`)
  );
}

export function assertPhotoObjectKey(namespace: PhotoNamespace, key: string): void {
  const revision = /\/thumbnails\/([^/]+)\.webp$/.exec(key);
  if (revision) {
    if (revision.index + revision[0].length !== key.length) throw new Error('Invalid photo key.');
    z.uuid().parse(revision[1]);
    parsePhotoStorageKey(namespace, key.slice(0, revision.index) + '/original.webp');
    return;
  }
  const original = key.replace(/\/(display|thumbnail)\.webp$/, '/original.webp');
  parsePhotoStorageKey(namespace, original);
}
