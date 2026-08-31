import 'server-only';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

export type PhotoExtension = 'jpg' | 'png' | 'webp';
export type PhotoVariant = 'display' | 'thumbnail';
const extensionSchema = z.enum(['jpg', 'png', 'webp']);
export const photoVariantSchema = z.enum(['display', 'thumbnail']);
const originalPattern = /^plants\/([^/]+)\/([^/]+)\/original\.(jpg|png|webp)$/;

export function createPhotoKeys(plantId: string, extension: PhotoExtension, revision?: string) {
  const owner = z.uuid().parse(plantId).toLowerCase();
  const assetId = randomUUID();
  const original = `plants/${owner}/${assetId}/original.${extensionSchema.parse(extension)}`;
  return {
    original,
    display: photoVariantKey(original, 'display'),
    thumbnail: photoVariantKey(original, 'thumbnail', revision),
  };
}

export function parsePhotoStorageKey(key: string) {
  const match = originalPattern.exec(key);
  if (
    !match ||
    match[0] !== key ||
    !z.uuid().safeParse(match[1]).success ||
    !z.uuid().safeParse(match[2]).success
  ) {
    throw new Error('Invalid Plant photo storage key.');
  }
  return { plantId: match[1], assetId: match[2], extension: extensionSchema.parse(match[3]) };
}

export function photoVariantKey(
  original: string,
  variant: PhotoVariant,
  revision?: string | null,
): string {
  parsePhotoStorageKey(original);
  photoVariantSchema.parse(variant);
  if (revision != null) z.uuid().parse(revision);
  return (
    original.slice(0, original.lastIndexOf('/') + 1) +
    (variant === 'thumbnail' && revision ? `thumbnails/${revision}.webp` : `${variant}.webp`)
  );
}

export function assertPhotoObjectKey(key: string): void {
  const revision = /\/thumbnails\/([^/]+)\.webp$/.exec(key);
  if (revision) {
    if (revision.index + revision[0].length !== key.length) throw new Error('Invalid photo key.');
    z.uuid().parse(revision[1]);
    parsePhotoStorageKey(key.slice(0, revision.index) + '/original.webp');
    return;
  }
  const original = key.replace(/\/(display|thumbnail)\.webp$/, '/original.webp');
  parsePhotoStorageKey(original);
}
