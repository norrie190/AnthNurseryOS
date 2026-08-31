import 'server-only';
import { randomUUID } from 'node:crypto';
import { Prisma, type Plant, type PlantPhoto } from '../../generated/prisma/client';
import { getPrisma } from '../../lib/prisma';
import { PlantError } from './plant-errors';
import {
  parseUploadPlantPhoto,
  parseSetPrimaryPlantPhoto,
  type UploadPlantPhotoInput,
  type SetPrimaryPlantPhotoInput,
  parseUpdatePlantPhotoCrop,
  type UpdatePlantPhotoCropInput,
  parseDeletePlantPhoto,
  type DeletePlantPhotoInput,
} from './plant-photo-input';
import {
  createPhotoKeys,
  parsePhotoStorageKey,
  photoVariantKey,
  photoAssetPrefix,
} from './plant-photo-keys';
import {
  processPlantPhoto,
  processPlantPhotoThumbnail,
  processPlantPhotoPreview,
  readPlantPhotoDimensions,
} from './plant-photo-processing';
import { plantIdSchema } from './plant-field-schemas';
import { getPlantPhotoStorage, type PlantPhotoStorage } from './plant-photo-storage';

export type { UploadPlantPhotoInput, SetPrimaryPlantPhotoInput } from './plant-photo-input';
export type PlantPhotoResult = { photo: PlantPhoto; plantUpdatedAt: Date };
export type DeletePlantPhotoResult = {
  deletedPhotoId: string;
  primaryPhotoId: string | null;
  plantUpdatedAt: Date;
  cleanupPending: boolean;
};
const transactionOptions = {
  isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
  maxWait: 5000,
  timeout: 10000,
};

function checkCurrent(
  current: Pick<Plant, 'updatedAt'> | null | undefined,
  token: string,
): asserts current is Pick<Plant, 'updatedAt'> {
  if (!current) throw new PlantError('NOT_FOUND', 'This Plant could not be found.');
  if (current.updatedAt.toISOString() !== token)
    throw new PlantError(
      'STALE_UPDATE',
      'This Plant has changed. Review its latest details before changing photos.',
    );
}

async function lockPlant(tx: Prisma.TransactionClient, plantId: string) {
  const [plant] = await tx.$queryRaw<
    Plant[]
  >`SELECT * FROM public."Plant" WHERE id = ${plantId}::uuid FOR NO KEY UPDATE`;
  return plant;
}

async function advancePlant(tx: Prisma.TransactionClient, plantId: string, previous: Date) {
  return tx.plant.update({
    where: { id: plantId },
    data: { updatedAt: new Date(Math.max(Date.now(), previous.getTime() + 1)) },
    select: { updatedAt: true },
  });
}

export async function deletePlantPhoto(
  plantId: string,
  photoId: string,
  input: DeletePlantPhotoInput,
): Promise<DeletePlantPhotoResult> {
  const parsed = parseDeletePlantPhoto(plantId, photoId, input);
  const db = getPrisma();
  type Deletion = { storageKey: string; result: Omit<DeletePlantPhotoResult, 'cleanupPending'> };
  let completed: Deletion | undefined;
  let deletion: Deletion;
  try {
    deletion = await db.$transaction(async (tx) => {
      const locked = await lockPlant(tx, parsed.plantId);
      checkCurrent(locked, parsed.input.expectedUpdatedAt);
      const photo = await tx.plantPhoto.findUnique({ where: { id: parsed.input.photoId } });
      checkPhotoOwner(photo, parsed.plantId);
      const prefix = photoAssetPrefix(photo.storageKey);
      // Imported/corrupt rows must not share an asset folder, even if their
      // original extensions differ and pass the storageKey unique constraint.
      const sharedAsset = await tx.plantPhoto.findFirst({
        where: { id: { not: photo.id }, storageKey: { startsWith: prefix } },
        select: { id: true },
      });
      if (sharedAsset)
        throw new PlantError('CONFLICT', 'This photo asset needs review before deletion.');
      await tx.plantPhoto.delete({ where: { id: photo.id } });
      const primary = await tx.plantPhoto.findFirst({
        where: { plantId: parsed.plantId, ...(photo.isPrimary ? {} : { isPrimary: true }) },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
        select: { id: true },
      });
      if (photo.isPrimary && primary)
        await tx.plantPhoto.update({ where: { id: primary.id }, data: { isPrimary: true } });
      const updated = await advancePlant(tx, parsed.plantId, locked.updatedAt);
      completed = {
        storageKey: photo.storageKey,
        result: {
          deletedPhotoId: photo.id,
          primaryPhotoId: primary?.id ?? null,
          plantUpdatedAt: updated.updatedAt,
        },
      };
      return completed;
    }, transactionOptions);
  } catch (error) {
    if (!completed) rethrowPhotoFailure(error);
    const attempt = completed;
    // The callback completed, but COMMIT may have lost its acknowledgement.
    // Wait behind the same Plant lock before deciding whether cleanup is safe.
    let resolved: Deletion | null;
    try {
      resolved = await db.$transaction(async (tx) => {
        const locked = await lockPlant(tx, parsed.plantId);
        if (!locked) throw new Error('Plant disappeared while resolving photo deletion.');
        const remaining = await tx.plantPhoto.findFirst({
          where: {
            OR: [
              { id: parsed.input.photoId },
              { storageKey: { startsWith: photoAssetPrefix(attempt.storageKey) } },
            ],
          },
          select: { id: true },
        });
        if (remaining) return null;
        const primary = await tx.plantPhoto.findFirst({
          where: { plantId: parsed.plantId, isPrimary: true },
          select: { id: true },
        });
        // Return the observed database state, not a timestamp from a callback
        // whose commit may have rolled back before another deletion completed.
        return {
          storageKey: attempt.storageKey,
          result: {
            deletedPhotoId: parsed.input.photoId,
            primaryPhotoId: primary?.id ?? null,
            plantUpdatedAt: locked.updatedAt,
          },
        };
      }, transactionOptions);
    } catch {
      console.error('Plant photo deletion commit uncertain; storage retained', {
        plantId: parsed.plantId,
        photoId: parsed.input.photoId,
        assetPrefix: photoAssetPrefix(attempt.storageKey),
      });
      throw new Error('Photo deletion outcome is uncertain.', { cause: error });
    }
    if (!resolved) rethrowPhotoFailure(error);
    deletion = resolved;
  }

  // Never hold a database lock during R2 work. Failure here must not undo a
  // committed deletion, recreate metadata, or offer a destructive retry.
  try {
    await getPlantPhotoStorage().removePhotoAsset(deletion.storageKey);
    return { ...deletion.result, cleanupPending: false };
  } catch {
    console.error('Plant photo deleted; targeted storage cleanup incomplete', {
      plantId: parsed.plantId,
      photoId: parsed.input.photoId,
      assetPrefix: photoAssetPrefix(deletion.storageKey),
    });
    return { ...deletion.result, cleanupPending: true };
  }
}

function rethrowPhotoFailure(error: unknown): never {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    ['P2002', 'P2003', 'P2034'].includes(error.code)
  ) {
    throw new PlantError(
      'CONFLICT',
      'The photo could not be saved because of conflicting database data.',
      { cause: error },
    );
  }
  throw error;
}

async function cleanupUpload(
  storage: PlantPhotoStorage,
  plantId: string,
  uploadId: string,
  keys: string[],
  stage: string,
) {
  const outcomes = await Promise.all(
    keys.map(async (key) => {
      try {
        return { key, outcome: await storage.remove(key, uploadId) };
      } catch {
        return { key, outcome: 'cleanup-failed' };
      }
    }),
  );
  // Explicit fields only: SDK errors can contain signed URLs or credentials.
  console.error('Plant photo upload cleanup', {
    plantId,
    uploadId,
    bucket: storage.bucket,
    stage,
    objects: outcomes,
  });
}

export async function uploadPlantPhoto(
  plantId: string,
  input: UploadPlantPhotoInput,
): Promise<PlantPhotoResult> {
  const parsed = parseUploadPlantPhoto(plantId, input);
  const db = getPrisma();
  const current = await db.plant.findUnique({
    where: { id: parsed.plantId },
    select: { updatedAt: true },
  });
  checkCurrent(current, parsed.input.expectedUpdatedAt);
  const storage = getPlantPhotoStorage();
  const processed = await processPlantPhoto(parsed.input.image, parsed.input.crop);
  const derivativeRevision = randomUUID();
  const keys = createPhotoKeys(parsed.plantId, processed.extension, derivativeRevision);
  const uploadId = randomUUID();
  const attempted: string[] = [];
  try {
    for (const variant of ['original', 'display', 'thumbnail'] as const) {
      attempted.push(keys[variant]);
      await storage.upload({
        key: keys[variant],
        body: processed[variant],
        contentType: variant === 'original' ? processed.contentType : 'image/webp',
        uploadId,
      });
    }
  } catch (error) {
    await cleanupUpload(storage, parsed.plantId, uploadId, attempted, 'storage');
    throw error;
  }

  let callbackCompleted = false;
  try {
    return await db.$transaction(async (tx) => {
      const locked = await lockPlant(tx, parsed.plantId);
      checkCurrent(locked, parsed.input.expectedUpdatedAt);
      const last = await tx.plantPhoto.findFirst({
        where: { plantId: parsed.plantId },
        orderBy: [{ sortOrder: 'desc' }, { id: 'asc' }],
        select: { sortOrder: true },
      });
      if (last && last.sortOrder >= 2147483647)
        throw new PlantError('CONFLICT', 'This Plant has reached the photo ordering limit.');
      const photo = await tx.plantPhoto.create({
        data: {
          plantId: parsed.plantId,
          storageKey: keys.original,
          cropX: processed.crop.x,
          cropY: processed.crop.y,
          cropSize: processed.crop.size,
          derivativeRevision,
          originalFilename: parsed.input.originalFilename ?? null,
          caption: parsed.input.caption ?? null,
          takenAt: parsed.input.takenAt ? new Date(parsed.input.takenAt) : null,
          isPrimary: last === null,
          sortOrder: last ? last.sortOrder + 1 : 0,
        },
      });
      const plant = await advancePlant(tx, parsed.plantId, locked.updatedAt);
      callbackCompleted = true;
      return { photo, plantUpdatedAt: plant.updatedAt };
    }, transactionOptions);
  } catch (error) {
    if (callbackCompleted) {
      // The callback completed but COMMIT acknowledgement failed. The original
      // transaction already holds the Plant lock: acquiring it on a fresh transaction
      // waits for that outcome to settle before checking for the generated key.
      let resolved: PlantPhotoResult | null;
      try {
        resolved = await db.$transaction(async (tx) => {
          const locked = await lockPlant(tx, parsed.plantId);
          const photo = await tx.plantPhoto.findUnique({ where: { storageKey: keys.original } });
          if (photo && (!locked || photo.plantId !== parsed.plantId))
            throw new Error('Cannot confirm the photo owner.');
          return photo ? { photo, plantUpdatedAt: locked.updatedAt } : null;
        }, transactionOptions);
      } catch {
        console.error('Plant photo commit unresolved; objects retained', {
          plantId: parsed.plantId,
          uploadId,
          bucket: storage.bucket,
          keys: attempted,
          stage: 'commit',
        });
        throw new Error(
          'The photo save could not be confirmed. Check the Plant before trying again.',
          { cause: error },
        );
      }
      if (resolved) return resolved;
    }
    await cleanupUpload(storage, parsed.plantId, uploadId, attempted, 'database');
    rethrowPhotoFailure(error);
  }
}

export async function setPrimaryPlantPhoto(
  plantId: string,
  input: SetPrimaryPlantPhotoInput,
): Promise<PlantPhotoResult & { changed: boolean }> {
  const parsed = parseSetPrimaryPlantPhoto(plantId, input);
  try {
    return await getPrisma().$transaction(async (tx) => {
      const current = await lockPlant(tx, parsed.plantId);
      checkCurrent(current, parsed.input.expectedUpdatedAt);
      const photo = await tx.plantPhoto.findFirst({
        where: { id: parsed.input.photoId, plantId: parsed.plantId },
      });
      if (!photo)
        throw new PlantError('NOT_FOUND', 'This photo could not be found for this Plant.');
      if (photo.isPrimary) return { photo, plantUpdatedAt: current.updatedAt, changed: false };
      await tx.plantPhoto.updateMany({
        where: { plantId: parsed.plantId, isPrimary: true },
        data: { isPrimary: false },
      });
      const selected = await tx.plantPhoto.update({
        where: { id: photo.id },
        data: { isPrimary: true },
      });
      const plant = await advancePlant(tx, parsed.plantId, current.updatedAt);
      return { photo: selected, plantUpdatedAt: plant.updatedAt, changed: true };
    }, transactionOptions);
  } catch (error) {
    rethrowPhotoFailure(error);
  }
}

function checkPhotoOwner(photo: PlantPhoto | null, plantId: string): asserts photo is PlantPhoto {
  if (!photo || photo.plantId !== plantId)
    throw new PlantError('NOT_FOUND', 'This photo could not be found for this Plant.');
  if (parsePhotoStorageKey(photo.storageKey).plantId !== plantId)
    throw new Error('Photo storage ownership does not match the Plant.');
}

export async function previewNewPlantPhoto(plantId: string, input: UploadPlantPhotoInput) {
  const parsed = parseUploadPlantPhoto(plantId, input);
  const plant = await getPrisma().plant.findUnique({
    where: { id: parsed.plantId },
    select: { updatedAt: true },
  });
  checkCurrent(plant, parsed.input.expectedUpdatedAt);
  // No R2 calls or writes. The selector sees the same oriented pixels as upload.
  return processPlantPhotoPreview(parsed.input.image);
}

export async function getPlantPhotoCropPreview(plantId: string, photoId: string) {
  if (!plantIdSchema.safeParse(plantId).success || !plantIdSchema.safeParse(photoId).success)
    throw new PlantError('VALIDATION_FAILED', 'Choose a valid Plant photo.');
  const photo = await getPrisma().plantPhoto.findFirst({ where: { id: photoId, plantId } });
  checkPhotoOwner(photo, plantId);
  const dimensions = await readPlantPhotoDimensions(
    await getPlantPhotoStorage().readOriginal(photo.storageKey),
  );
  return {
    ...dimensions,
    crop: photo.cropX == null ? null : { x: photo.cropX, y: photo.cropY!, size: photo.cropSize! },
  };
}

export async function updatePlantPhotoCrop(
  plantId: string,
  photoId: string,
  input: UpdatePlantPhotoCropInput,
): Promise<PlantPhotoResult & { changed: boolean }> {
  const parsed = parseUpdatePlantPhotoCrop(plantId, photoId, input);
  const { crop, expectedUpdatedAt } = parsed.input;
  const db = getPrisma();
  checkCurrent(
    await db.plant.findUnique({ where: { id: plantId }, select: { updatedAt: true } }),
    expectedUpdatedAt,
  );
  const previous = await db.plantPhoto.findFirst({ where: { id: photoId, plantId } });
  checkPhotoOwner(previous, plantId);
  const sameCrop = (photo: PlantPhoto) =>
    photo.derivativeRevision != null &&
    photo.cropX === crop.x &&
    photo.cropY === crop.y &&
    photo.cropSize === crop.size;
  if (sameCrop(previous)) {
    return db.$transaction(async (tx) => {
      const plant = await lockPlant(tx, plantId);
      checkCurrent(plant, expectedUpdatedAt);
      const photo = await tx.plantPhoto.findFirst({ where: { id: photoId, plantId } });
      checkPhotoOwner(photo, plantId);
      if (!sameCrop(photo))
        throw new PlantError('STALE_UPDATE', 'This photo has changed. Review it before saving.');
      return { photo, plantUpdatedAt: plant.updatedAt, changed: false };
    }, transactionOptions);
  }

  const storage = getPlantPhotoStorage();
  const thumbnail = await processPlantPhotoThumbnail(
    await storage.readOriginal(previous.storageKey),
    crop,
  );
  const revision = randomUUID();
  const key = photoVariantKey(previous.storageKey, 'thumbnail', revision);
  const uploadId = randomUUID();
  try {
    await storage.upload({ key, body: thumbnail, contentType: 'image/webp', uploadId });
  } catch (error) {
    await cleanupUpload(storage, plantId, uploadId, [key], 'crop-storage');
    throw error;
  }
  let callbackCompleted = false;
  try {
    return await db.$transaction(async (tx) => {
      const plant = await lockPlant(tx, plantId);
      checkCurrent(plant, expectedUpdatedAt);
      const photo = await tx.plantPhoto.findFirst({ where: { id: photoId, plantId } });
      checkPhotoOwner(photo, plantId);
      const saved = await tx.plantPhoto.update({
        where: { id: photoId },
        data: {
          cropX: crop.x,
          cropY: crop.y,
          cropSize: crop.size,
          derivativeRevision: revision,
          updatedAt: new Date(Math.max(Date.now(), photo.updatedAt.getTime() + 1)),
        },
      });
      const updatedPlant = await advancePlant(tx, plantId, plant.updatedAt);
      callbackCompleted = true;
      return { photo: saved, plantUpdatedAt: updatedPlant.updatedAt, changed: true };
    }, transactionOptions);
  } catch (error) {
    if (callbackCompleted) {
      let resolved: PlantPhotoResult | null;
      try {
        resolved = await db.$transaction(async (tx) => {
          const plant = await lockPlant(tx, plantId);
          const photo = await tx.plantPhoto.findFirst({ where: { id: photoId, plantId } });
          checkPhotoOwner(photo, plantId);
          if (!plant) throw new Error('Cannot confirm Plant.');
          if (photo.derivativeRevision === revision)
            return { photo, plantUpdatedAt: plant.updatedAt };
          if (photo.derivativeRevision === previous.derivativeRevision) return null;
          // Another crop could have superseded our committed revision. Retain it.
          throw new Error('A different revision is active.');
        }, transactionOptions);
      } catch {
        console.error('Plant photo crop commit unresolved; thumbnail retained', {
          plantId,
          photoId,
          uploadId,
          bucket: storage.bucket,
          key,
          revision,
          stage: 'crop-commit',
        });
        throw new Error(
          'The crop save could not be confirmed. Check the Plant before trying again.',
          { cause: error },
        );
      }
      if (resolved) return { ...resolved, changed: true };
    }
    await cleanupUpload(storage, plantId, uploadId, [key], 'crop-database');
    rethrowPhotoFailure(error);
  }
}
