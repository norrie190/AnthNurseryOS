import 'server-only';
import { z } from 'zod';
import { getPrisma } from '../../lib/prisma';
import { EquipmentError } from './equipment-errors';
import {
  parseEquipmentPhotoStorageKey,
  photoVariantSchema,
  type PhotoVariant,
} from './equipment-photo-keys';
import { getEquipmentPhotoStorage } from './equipment-photo-storage';
import { equipmentIdSchema } from './equipment-input';

// Browser metadata intentionally excludes the private storage key.
const metadataSelect = {
  id: true,
  equipmentId: true,
  originalFilename: true,
  caption: true,
  takenAt: true,
  isPrimary: true,
  sortOrder: true,
  createdAt: true,
  updatedAt: true,
  cropX: true,
  cropY: true,
  cropSize: true,
  derivativeRevision: true,
} as const;

function invalidSelection(cause?: unknown): EquipmentError {
  return new EquipmentError('VALIDATION_FAILED', 'Choose a valid Equipment photo.', { cause });
}

export async function getEquipmentPhotoGallery(equipmentId: string) {
  const parsed = equipmentIdSchema.safeParse(equipmentId);
  if (!parsed.success) throw invalidSelection(parsed.error);
  return getPrisma().equipmentPhoto.findMany({
    where: { equipmentId: parsed.data },
    select: metadataSelect,
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
  });
}

export async function getPrimaryEquipmentPhoto(equipmentId: string) {
  const parsed = equipmentIdSchema.safeParse(equipmentId);
  if (!parsed.success) throw invalidSelection(parsed.error);
  return getPrisma().equipmentPhoto.findFirst({
    where: { equipmentId: parsed.data, isPrimary: true },
    select: metadataSelect,
  });
}

export async function getOwnedEquipmentPhoto(equipmentId: string, photoId: string) {
  const parsed = z
    .strictObject({ equipmentId: equipmentIdSchema, photoId: equipmentIdSchema })
    .safeParse({ equipmentId, photoId });
  if (!parsed.success) throw invalidSelection(parsed.error);
  return getPrisma().equipmentPhoto.findFirst({
    where: { id: parsed.data.photoId, equipmentId: parsed.data.equipmentId },
    select: metadataSelect,
  });
}

export async function getPrimaryEquipmentPhotoReferences(equipmentIds: readonly string[]) {
  const parsed = z.array(equipmentIdSchema).max(500).safeParse(equipmentIds);
  if (!parsed.success) throw invalidSelection(parsed.error);
  const ids = [...new Set(parsed.data)];
  if (ids.length === 0) return [];
  return getPrisma().equipmentPhoto.findMany({
    where: { equipmentId: { in: ids }, isPrimary: true },
    select: { id: true, equipmentId: true, derivativeRevision: true },
    orderBy: [{ equipmentId: 'asc' }, { id: 'asc' }],
  });
}

export async function getEquipmentPhotoReadUrl(
  equipmentId: string,
  photoId: string,
  variant: PhotoVariant,
) {
  const parsed = z
    .strictObject({
      equipmentId: equipmentIdSchema,
      photoId: equipmentIdSchema,
      variant: photoVariantSchema,
    })
    .safeParse({ equipmentId, photoId, variant });
  if (!parsed.success)
    throw new EquipmentError(
      'VALIDATION_FAILED',
      'Choose a valid Equipment photo and display variant.',
      { cause: parsed.error },
    );
  const photo = await getPrisma().equipmentPhoto.findFirst({
    where: { id: parsed.data.photoId, equipmentId: parsed.data.equipmentId },
    select: { storageKey: true, derivativeRevision: true },
  });
  if (!photo)
    throw new EquipmentError('NOT_FOUND', 'This photo could not be found for this Equipment.');
  if (parseEquipmentPhotoStorageKey(photo.storageKey).equipmentId !== parsed.data.equipmentId)
    throw new Error('Photo storage ownership does not match the Equipment.');
  return {
    url: await getEquipmentPhotoStorage().signVariant(
      photo.storageKey,
      parsed.data.variant,
      photo.derivativeRevision,
    ),
    expiresInSeconds: 300 as const,
  };
}
