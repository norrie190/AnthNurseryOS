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
} from './plant-photo-input';
import { createPhotoKeys } from './plant-photo-keys';
import { processPlantPhoto } from './plant-photo-processing';
import { getPlantPhotoStorage, type PlantPhotoStorage } from './plant-photo-storage';

export type { UploadPlantPhotoInput, SetPrimaryPlantPhotoInput } from './plant-photo-input';
export type PlantPhotoResult = { photo: PlantPhoto; plantUpdatedAt: Date };
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
  const processed = await processPlantPhoto(parsed.input.image);
  const keys = createPhotoKeys(parsed.plantId, processed.extension);
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
