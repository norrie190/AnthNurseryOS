import 'server-only';
import { randomUUID } from 'node:crypto';
import { Prisma, type Equipment, type EquipmentPhoto } from '../../generated/prisma/client';
import { getPrisma } from '../../lib/prisma';
import { EquipmentError } from './equipment-errors';
import {
  parseDeleteEquipmentPhoto,
  parseSetPrimaryEquipmentPhoto,
  parseUpdateEquipmentPhotoCrop,
  parseUploadEquipmentPhoto,
  type DeleteEquipmentPhotoInput,
  type SetPrimaryEquipmentPhotoInput,
  type UpdateEquipmentPhotoCropInput,
  type UploadEquipmentPhotoInput,
} from './equipment-photo-input';
import {
  createEquipmentPhotoKeys,
  equipmentPhotoAssetPrefix,
  equipmentPhotoVariantKey,
  parseEquipmentPhotoStorageKey,
} from './equipment-photo-keys';
import {
  processEquipmentPhoto,
  processEquipmentPhotoPreview,
  processEquipmentPhotoThumbnail,
  readEquipmentPhotoDimensions,
} from './equipment-photo-processing';
import { getEquipmentPhotoStorage, type EquipmentPhotoStorage } from './equipment-photo-storage';
import { equipmentIdSchema } from './equipment-input';

export type {
  DeleteEquipmentPhotoInput,
  SetPrimaryEquipmentPhotoInput,
  UpdateEquipmentPhotoCropInput,
  UploadEquipmentPhotoInput,
} from './equipment-photo-input';

export type EquipmentPhotoResult = { photo: EquipmentPhoto; equipmentUpdatedAt: Date };
export type DeleteEquipmentPhotoResult = {
  deletedPhotoId: string;
  primaryPhotoId: string | null;
  equipmentUpdatedAt: Date;
  cleanupPending: boolean;
};

const transactionOptions = {
  isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
  maxWait: 5000,
  timeout: 10000,
};

function checkCurrent(
  current: Pick<Equipment, 'updatedAt'> | null | undefined,
  token: string,
): asserts current is Pick<Equipment, 'updatedAt'> {
  if (!current) throw new EquipmentError('NOT_FOUND', 'This Equipment could not be found.');
  if (current.updatedAt.toISOString() !== token)
    throw new EquipmentError(
      'STALE_UPDATE',
      'This Equipment has changed. Review its latest details before changing photos.',
    );
}

async function lockEquipment(tx: Prisma.TransactionClient, equipmentId: string) {
  const [equipment] = await tx.$queryRaw<
    Equipment[]
  >`SELECT * FROM public."Equipment" WHERE id = ${equipmentId}::uuid FOR NO KEY UPDATE`;
  return equipment;
}

async function advanceEquipment(tx: Prisma.TransactionClient, equipmentId: string, previous: Date) {
  return tx.equipment.update({
    where: { id: equipmentId },
    data: { updatedAt: new Date(Math.max(Date.now(), previous.getTime() + 1)) },
    select: { updatedAt: true },
  });
}

function checkPhotoOwner(
  photo: EquipmentPhoto | null,
  equipmentId: string,
): asserts photo is EquipmentPhoto {
  if (!photo || photo.equipmentId !== equipmentId)
    throw new EquipmentError('NOT_FOUND', 'This photo could not be found for this Equipment.');
  if (parseEquipmentPhotoStorageKey(photo.storageKey).equipmentId !== equipmentId)
    throw new Error('Photo storage ownership does not match the Equipment.');
}

function rethrowPhotoFailure(error: unknown): never {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    ['P2002', 'P2003', 'P2034'].includes(error.code)
  ) {
    throw new EquipmentError(
      'CONFLICT',
      'The Equipment photo could not be saved because of conflicting database data.',
      { cause: error },
    );
  }
  throw error;
}

async function cleanupUpload(
  storage: EquipmentPhotoStorage,
  equipmentId: string,
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
  console.error('Equipment photo upload cleanup', {
    equipmentId,
    uploadId,
    bucket: storage.bucket,
    stage,
    objects: outcomes,
  });
}

export async function uploadEquipmentPhoto(
  equipmentId: string,
  input: UploadEquipmentPhotoInput,
): Promise<EquipmentPhotoResult> {
  const parsed = parseUploadEquipmentPhoto(equipmentId, input);
  const db = getPrisma();
  const current = await db.equipment.findUnique({
    where: { id: parsed.equipmentId },
    select: { updatedAt: true },
  });
  checkCurrent(current, parsed.input.expectedUpdatedAt);

  const storage = getEquipmentPhotoStorage();
  const processed = await processEquipmentPhoto(parsed.input.image, parsed.input.crop);
  const derivativeRevision = randomUUID();
  const keys = createEquipmentPhotoKeys(
    parsed.equipmentId,
    processed.extension,
    derivativeRevision,
  );
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
    await cleanupUpload(storage, parsed.equipmentId, uploadId, attempted, 'storage');
    throw error;
  }

  let callbackCompleted = false;
  try {
    return await db.$transaction(async (tx) => {
      const locked = await lockEquipment(tx, parsed.equipmentId);
      checkCurrent(locked, parsed.input.expectedUpdatedAt);
      const last = await tx.equipmentPhoto.findFirst({
        where: { equipmentId: parsed.equipmentId },
        orderBy: [{ sortOrder: 'desc' }, { id: 'asc' }],
        select: { sortOrder: true },
      });
      if (last && last.sortOrder >= 2147483647)
        throw new EquipmentError(
          'CONFLICT',
          'This Equipment has reached the photo ordering limit.',
        );
      const photo = await tx.equipmentPhoto.create({
        data: {
          equipmentId: parsed.equipmentId,
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
      const equipment = await advanceEquipment(tx, parsed.equipmentId, locked.updatedAt);
      callbackCompleted = true;
      return { photo, equipmentUpdatedAt: equipment.updatedAt };
    }, transactionOptions);
  } catch (error) {
    if (callbackCompleted) {
      let resolved: EquipmentPhotoResult | null;
      try {
        resolved = await db.$transaction(async (tx) => {
          const locked = await lockEquipment(tx, parsed.equipmentId);
          const photo = await tx.equipmentPhoto.findUnique({
            where: { storageKey: keys.original },
          });
          if (photo && (!locked || photo.equipmentId !== parsed.equipmentId))
            throw new Error('Cannot confirm the Equipment photo owner.');
          return photo ? { photo, equipmentUpdatedAt: locked.updatedAt } : null;
        }, transactionOptions);
      } catch {
        console.error('Equipment photo commit unresolved; objects retained', {
          equipmentId: parsed.equipmentId,
          uploadId,
          bucket: storage.bucket,
          keys: attempted,
          stage: 'commit',
        });
        throw new Error(
          'The photo save could not be confirmed. Check the Equipment before trying again.',
          { cause: error },
        );
      }
      if (resolved) return resolved;
    }
    await cleanupUpload(storage, parsed.equipmentId, uploadId, attempted, 'database');
    rethrowPhotoFailure(error);
  }
}

export async function setPrimaryEquipmentPhoto(
  equipmentId: string,
  input: SetPrimaryEquipmentPhotoInput,
): Promise<EquipmentPhotoResult & { changed: boolean }> {
  const parsed = parseSetPrimaryEquipmentPhoto(equipmentId, input);
  try {
    return await getPrisma().$transaction(async (tx) => {
      const current = await lockEquipment(tx, parsed.equipmentId);
      checkCurrent(current, parsed.input.expectedUpdatedAt);
      const photo = await tx.equipmentPhoto.findFirst({
        where: { id: parsed.input.photoId, equipmentId: parsed.equipmentId },
      });
      if (!photo)
        throw new EquipmentError('NOT_FOUND', 'This photo could not be found for this Equipment.');
      checkPhotoOwner(photo, parsed.equipmentId);
      if (photo.isPrimary) return { photo, equipmentUpdatedAt: current.updatedAt, changed: false };
      await tx.equipmentPhoto.updateMany({
        where: { equipmentId: parsed.equipmentId, isPrimary: true },
        data: { isPrimary: false },
      });
      const selected = await tx.equipmentPhoto.update({
        where: { id: photo.id },
        data: { isPrimary: true },
      });
      const equipment = await advanceEquipment(tx, parsed.equipmentId, current.updatedAt);
      return { photo: selected, equipmentUpdatedAt: equipment.updatedAt, changed: true };
    }, transactionOptions);
  } catch (error) {
    rethrowPhotoFailure(error);
  }
}

export async function previewNewEquipmentPhoto(
  equipmentId: string,
  input: UploadEquipmentPhotoInput,
) {
  const parsed = parseUploadEquipmentPhoto(equipmentId, input);
  const equipment = await getPrisma().equipment.findUnique({
    where: { id: parsed.equipmentId },
    select: { updatedAt: true },
  });
  checkCurrent(equipment, parsed.input.expectedUpdatedAt);
  return processEquipmentPhotoPreview(parsed.input.image);
}

export async function getEquipmentPhotoCropPreview(equipmentId: string, photoId: string) {
  if (
    !equipmentIdSchema.safeParse(equipmentId).success ||
    !equipmentIdSchema.safeParse(photoId).success
  )
    throw new EquipmentError('VALIDATION_FAILED', 'Choose a valid Equipment photo.');
  const photo = await getPrisma().equipmentPhoto.findFirst({
    where: { id: photoId, equipmentId },
  });
  checkPhotoOwner(photo, equipmentId);
  const dimensions = await readEquipmentPhotoDimensions(
    await getEquipmentPhotoStorage().readOriginal(photo.storageKey),
  );
  return {
    ...dimensions,
    crop: photo.cropX == null ? null : { x: photo.cropX, y: photo.cropY!, size: photo.cropSize! },
  };
}

export async function updateEquipmentPhotoCrop(
  equipmentId: string,
  photoId: string,
  input: UpdateEquipmentPhotoCropInput,
): Promise<EquipmentPhotoResult & { changed: boolean }> {
  const parsed = parseUpdateEquipmentPhotoCrop(equipmentId, photoId, input);
  const { crop, expectedUpdatedAt } = parsed.input;
  const db = getPrisma();
  checkCurrent(
    await db.equipment.findUnique({
      where: { id: parsed.equipmentId },
      select: { updatedAt: true },
    }),
    expectedUpdatedAt,
  );
  const previous = await db.equipmentPhoto.findFirst({
    where: { id: parsed.input.photoId, equipmentId: parsed.equipmentId },
  });
  checkPhotoOwner(previous, parsed.equipmentId);
  const sameCrop = (photo: EquipmentPhoto) =>
    photo.derivativeRevision != null &&
    photo.cropX === crop.x &&
    photo.cropY === crop.y &&
    photo.cropSize === crop.size;
  if (sameCrop(previous)) {
    return db.$transaction(async (tx) => {
      const equipment = await lockEquipment(tx, parsed.equipmentId);
      checkCurrent(equipment, expectedUpdatedAt);
      const photo = await tx.equipmentPhoto.findFirst({
        where: { id: parsed.input.photoId, equipmentId: parsed.equipmentId },
      });
      checkPhotoOwner(photo, parsed.equipmentId);
      if (!sameCrop(photo))
        throw new EquipmentError(
          'STALE_UPDATE',
          'This photo has changed. Review it before saving.',
        );
      return { photo, equipmentUpdatedAt: equipment.updatedAt, changed: false };
    }, transactionOptions);
  }

  const storage = getEquipmentPhotoStorage();
  const thumbnail = await processEquipmentPhotoThumbnail(
    await storage.readOriginal(previous.storageKey),
    crop,
  );
  const revision = randomUUID();
  const key = equipmentPhotoVariantKey(previous.storageKey, 'thumbnail', revision);
  const uploadId = randomUUID();
  try {
    await storage.upload({ key, body: thumbnail, contentType: 'image/webp', uploadId });
  } catch (error) {
    await cleanupUpload(storage, parsed.equipmentId, uploadId, [key], 'crop-storage');
    throw error;
  }

  let callbackCompleted = false;
  try {
    return await db.$transaction(async (tx) => {
      const equipment = await lockEquipment(tx, parsed.equipmentId);
      checkCurrent(equipment, expectedUpdatedAt);
      const photo = await tx.equipmentPhoto.findFirst({
        where: { id: parsed.input.photoId, equipmentId: parsed.equipmentId },
      });
      checkPhotoOwner(photo, parsed.equipmentId);
      const saved = await tx.equipmentPhoto.update({
        where: { id: photo.id },
        data: {
          cropX: crop.x,
          cropY: crop.y,
          cropSize: crop.size,
          derivativeRevision: revision,
          updatedAt: new Date(Math.max(Date.now(), photo.updatedAt.getTime() + 1)),
        },
      });
      const updatedEquipment = await advanceEquipment(tx, parsed.equipmentId, equipment.updatedAt);
      callbackCompleted = true;
      return { photo: saved, equipmentUpdatedAt: updatedEquipment.updatedAt, changed: true };
    }, transactionOptions);
  } catch (error) {
    if (callbackCompleted) {
      let resolved: EquipmentPhotoResult | null;
      try {
        resolved = await db.$transaction(async (tx) => {
          const equipment = await lockEquipment(tx, parsed.equipmentId);
          const photo = await tx.equipmentPhoto.findFirst({
            where: { id: parsed.input.photoId, equipmentId: parsed.equipmentId },
          });
          checkPhotoOwner(photo, parsed.equipmentId);
          if (!equipment) throw new Error('Cannot confirm Equipment.');
          if (photo.derivativeRevision === revision)
            return { photo, equipmentUpdatedAt: equipment.updatedAt };
          if (photo.derivativeRevision === previous.derivativeRevision) return null;
          throw new Error('A different revision is active.');
        }, transactionOptions);
      } catch {
        console.error('Equipment photo crop commit unresolved; thumbnail retained', {
          equipmentId: parsed.equipmentId,
          photoId: parsed.input.photoId,
          uploadId,
          bucket: storage.bucket,
          key,
          revision,
          stage: 'crop-commit',
        });
        throw new Error(
          'The crop save could not be confirmed. Check the Equipment before trying again.',
          { cause: error },
        );
      }
      if (resolved) return { ...resolved, changed: true };
    }
    await cleanupUpload(storage, parsed.equipmentId, uploadId, [key], 'crop-database');
    rethrowPhotoFailure(error);
  }
}

export async function deleteEquipmentPhoto(
  equipmentId: string,
  photoId: string,
  input: DeleteEquipmentPhotoInput,
): Promise<DeleteEquipmentPhotoResult> {
  const parsed = parseDeleteEquipmentPhoto(equipmentId, photoId, input);
  const db = getPrisma();
  type Deletion = {
    storageKey: string;
    result: Omit<DeleteEquipmentPhotoResult, 'cleanupPending'>;
  };
  let completed: Deletion | undefined;
  let deletion: Deletion;
  try {
    deletion = await db.$transaction(async (tx) => {
      const locked = await lockEquipment(tx, parsed.equipmentId);
      checkCurrent(locked, parsed.input.expectedUpdatedAt);
      const photo = await tx.equipmentPhoto.findUnique({
        where: { id: parsed.input.photoId },
      });
      checkPhotoOwner(photo, parsed.equipmentId);
      const prefix = equipmentPhotoAssetPrefix(photo.storageKey);
      const [sharedEquipmentAsset, sharedPlantAsset] = await Promise.all([
        tx.equipmentPhoto.findFirst({
          where: { id: { not: photo.id }, storageKey: { startsWith: prefix } },
          select: { id: true },
        }),
        tx.plantPhoto.findFirst({
          where: { storageKey: { startsWith: prefix } },
          select: { id: true },
        }),
      ]);
      if (sharedEquipmentAsset || sharedPlantAsset)
        throw new EquipmentError('CONFLICT', 'This photo asset needs review before deletion.');
      await tx.equipmentPhoto.delete({ where: { id: photo.id } });
      const primary = await tx.equipmentPhoto.findFirst({
        where: {
          equipmentId: parsed.equipmentId,
          ...(photo.isPrimary ? {} : { isPrimary: true }),
        },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
        select: { id: true },
      });
      if (photo.isPrimary && primary)
        await tx.equipmentPhoto.update({
          where: { id: primary.id },
          data: { isPrimary: true },
        });
      const updated = await advanceEquipment(tx, parsed.equipmentId, locked.updatedAt);
      completed = {
        storageKey: photo.storageKey,
        result: {
          deletedPhotoId: photo.id,
          primaryPhotoId: primary?.id ?? null,
          equipmentUpdatedAt: updated.updatedAt,
        },
      };
      return completed;
    }, transactionOptions);
  } catch (error) {
    if (!completed) rethrowPhotoFailure(error);
    const attempt = completed;
    let resolved: Deletion | null;
    try {
      resolved = await db.$transaction(async (tx) => {
        const locked = await lockEquipment(tx, parsed.equipmentId);
        if (!locked) throw new Error('Equipment disappeared while resolving photo deletion.');
        const prefix = equipmentPhotoAssetPrefix(attempt.storageKey);
        const [remaining, conflictingPlantAsset] = await Promise.all([
          tx.equipmentPhoto.findFirst({
            where: {
              OR: [{ id: parsed.input.photoId }, { storageKey: { startsWith: prefix } }],
            },
            select: { id: true },
          }),
          tx.plantPhoto.findFirst({
            where: { storageKey: { startsWith: prefix } },
            select: { id: true },
          }),
        ]);
        if (conflictingPlantAsset)
          throw new Error('A Plant photo now references the Equipment asset.');
        if (remaining) return null;
        const primary = await tx.equipmentPhoto.findFirst({
          where: { equipmentId: parsed.equipmentId, isPrimary: true },
          select: { id: true },
        });
        return {
          storageKey: attempt.storageKey,
          result: {
            deletedPhotoId: parsed.input.photoId,
            primaryPhotoId: primary?.id ?? null,
            equipmentUpdatedAt: locked.updatedAt,
          },
        };
      }, transactionOptions);
    } catch {
      console.error('Equipment photo deletion commit uncertain; storage retained', {
        equipmentId: parsed.equipmentId,
        photoId: parsed.input.photoId,
        assetPrefix: equipmentPhotoAssetPrefix(attempt.storageKey),
      });
      throw new Error('Photo deletion outcome is uncertain.', { cause: error });
    }
    if (!resolved) rethrowPhotoFailure(error);
    deletion = resolved;
  }

  try {
    await getEquipmentPhotoStorage().removePhotoAsset(deletion.storageKey);
    return { ...deletion.result, cleanupPending: false };
  } catch {
    console.error('Equipment photo deleted; targeted storage cleanup incomplete', {
      equipmentId: parsed.equipmentId,
      photoId: parsed.input.photoId,
      assetPrefix: equipmentPhotoAssetPrefix(deletion.storageKey),
    });
    return { ...deletion.result, cleanupPending: true };
  }
}
