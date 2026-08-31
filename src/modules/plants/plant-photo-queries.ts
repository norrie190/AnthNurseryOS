import 'server-only';
import { z } from 'zod';
import { getPrisma } from '../../lib/prisma';
import { PlantError } from './plant-errors';
import { plantIdSchema } from './plant-field-schemas';
import { parsePhotoStorageKey, photoVariantSchema, type PhotoVariant } from './plant-photo-keys';
import { getPlantPhotoStorage } from './plant-photo-storage';

// UI metadata does not need bucket paths or provider URLs.
const metadataSelect = {
  id: true,
  plantId: true,
  originalFilename: true,
  caption: true,
  takenAt: true,
  isPrimary: true,
  sortOrder: true,
  createdAt: true,
  updatedAt: true,
} as const;

export async function getPlantPhotoGallery(plantId: string) {
  return getPrisma().plantPhoto.findMany({
    where: { plantId: plantIdSchema.parse(plantId) },
    select: metadataSelect,
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
  });
}

export async function getPrimaryPlantPhoto(plantId: string) {
  return getPrisma().plantPhoto.findFirst({
    where: { plantId: plantIdSchema.parse(plantId), isPrimary: true },
    select: metadataSelect,
  });
}

export async function getPlantPhotoReadUrl(
  plantId: string,
  photoId: string,
  variant: PhotoVariant,
) {
  const parsed = z
    .strictObject({ plantId: plantIdSchema, photoId: plantIdSchema, variant: photoVariantSchema })
    .safeParse({ plantId, photoId, variant });
  if (!parsed.success)
    throw new PlantError('VALIDATION_FAILED', 'Choose a valid photo and display variant.');
  const photo = await getPrisma().plantPhoto.findFirst({
    where: { id: parsed.data.photoId, plantId: parsed.data.plantId },
    select: { storageKey: true },
  });
  if (!photo) throw new PlantError('NOT_FOUND', 'This photo could not be found for this Plant.');
  if (parsePhotoStorageKey(photo.storageKey).plantId !== parsed.data.plantId)
    throw new Error('Photo storage ownership does not match the Plant.');
  return {
    url: await getPlantPhotoStorage().signVariant(photo.storageKey, parsed.data.variant),
    expiresInSeconds: 300 as const,
  };
}
