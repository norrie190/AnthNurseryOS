import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, expect, test, vi } from 'vitest';
import { Prisma, PrismaClient, type Equipment } from '../../src/generated/prisma/client';
import { getPrisma } from '../../src/lib/prisma';
import {
  deleteEquipmentPhoto,
  setPrimaryEquipmentPhoto,
  updateEquipmentPhotoCrop,
  uploadEquipmentPhoto,
} from '../../src/modules/equipment/equipment-photo-service';
import {
  getEquipmentPhotoGallery,
  getEquipmentPhotoReadUrl,
  getOwnedEquipmentPhoto,
  getPrimaryEquipmentPhoto,
  getPrimaryEquipmentPhotoReferences,
} from '../../src/modules/equipment/equipment-photo-queries';
import { getEquipmentPhotoStorage } from '../../src/modules/equipment/equipment-photo-storage';
import {
  createEquipmentPhotoKeys,
  equipmentPhotoAssetPrefix,
  equipmentPhotoVariantKey,
} from '../../src/modules/equipment/equipment-photo-keys';
import { createPhotoKeys as createPlantPhotoKeys } from '../../src/modules/plants/plant-photo-keys';
import { getTestDatabaseUrl } from '../../scripts/test-database-target';
import { fakeEquipmentPhotoStorage } from '../helpers/fake-equipment-photo-storage';
import { photoFixture } from '../fixtures/plant-photo-images';

vi.mock('server-only', () => ({}));
vi.mock('../../src/lib/prisma', () => ({ getPrisma: vi.fn() }));
vi.mock('../../src/modules/equipment/equipment-photo-storage', () => ({
  getEquipmentPhotoStorage: vi.fn(),
}));

const connectionString = getTestDatabaseUrl();
const database = new PrismaClient({
  adapter: new PrismaPg({ connectionString, connectionTimeoutMillis: 5000 }),
});
const rollbackFixture = new Error('rollback Equipment photo fixture');
const image = await photoFixture();

afterAll(() => database.$disconnect());

async function fixture(
  check: (
    tx: Prisma.TransactionClient,
    fake: ReturnType<typeof fakeEquipmentPhotoStorage>,
  ) => Promise<void>,
) {
  const fake = fakeEquipmentPhotoStorage();
  vi.mocked(getEquipmentPhotoStorage).mockReturnValue(fake.storage);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    await database.$transaction(
      async (tx) => {
        const operationTransaction = async (
          operation: (client: Prisma.TransactionClient) => Promise<unknown>,
          options: { isolationLevel: string },
        ) => {
          expect(options.isolationLevel).toBe('ReadCommitted');
          await tx.$executeRaw`SAVEPOINT equipment_photo_operation`;
          try {
            const result = await operation(tx);
            await tx.$executeRaw`RELEASE SAVEPOINT equipment_photo_operation`;
            return result;
          } catch (error) {
            await tx.$executeRaw`ROLLBACK TO SAVEPOINT equipment_photo_operation`;
            await tx.$executeRaw`RELEASE SAVEPOINT equipment_photo_operation`;
            throw error;
          }
        };
        vi.mocked(getPrisma).mockReturnValue({
          equipment: tx.equipment,
          equipmentPhoto: tx.equipmentPhoto,
          plantPhoto: tx.plantPhoto,
          $transaction: operationTransaction,
        } as unknown as PrismaClient);
        await check(tx, fake);
        throw rollbackFixture;
      },
      { timeout: 20000 },
    );
  } catch (error) {
    if (error !== rollbackFixture) throw error;
  } finally {
    vi.restoreAllMocks();
  }
}

function equipment(
  tx: Prisma.TransactionClient,
  data: Partial<Prisma.EquipmentUncheckedCreateInput> = {},
) {
  return tx.equipment.create({
    data: {
      reference: `test-photo-${randomUUID()}`,
      name: 'Equipment photo owner',
      usesPower: false,
      ...data,
    },
  });
}

function token(record: { updatedAt: Date }) {
  return { expectedUpdatedAt: record.updatedAt.toISOString() };
}

function expectOnlyTimestampChanged(before: Equipment, after: Equipment) {
  expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
  expect({ ...after, updatedAt: before.updatedAt }).toEqual(before);
}

test('first and later uploads use Equipment namespace, ordering, primary rule and strict timestamp', () =>
  fixture(async (tx, fake) => {
    const owner = await equipment(tx);
    vi.spyOn(Date, 'now').mockReturnValue(owner.updatedAt.getTime());
    const first = await uploadEquipmentPhoto(owner.id, {
      image,
      ...token(owner),
      caption: ' First ',
      originalFilename: '../../equipment.png',
      takenAt: '2026-08-30T12:00:00.000Z',
    });
    expect(first.photo).toMatchObject({
      equipmentId: owner.id,
      isPrimary: true,
      sortOrder: 0,
      caption: 'First',
      originalFilename: 'equipment.png',
      takenAt: new Date('2026-08-30T12:00:00.000Z'),
      derivativeRevision: expect.any(String),
    });
    expect(first.photo.storageKey).toMatch(
      new RegExp(`^equipment/${owner.id}/[0-9a-f-]+/original\\.png$`),
    );
    expect(first.equipmentUpdatedAt.getTime()).toBe(owner.updatedAt.getTime() + 1);
    const second = await uploadEquipmentPhoto(owner.id, {
      image,
      expectedUpdatedAt: first.equipmentUpdatedAt.toISOString(),
      crop: { x: 0, y: 0, size: 0.5 },
    });
    expect(second.photo).toMatchObject({
      equipmentId: owner.id,
      isPrimary: false,
      sortOrder: 1,
      cropX: 0,
      cropY: 0,
      cropSize: 0.5,
    });
    expect(second.equipmentUpdatedAt.getTime()).toBe(first.equipmentUpdatedAt.getTime() + 1);
    expect(fake.objects.size).toBe(6);
    expect(fake.objects.get(first.photo.storageKey)?.body).toEqual(image);
    expectOnlyTimestampChanged(
      owner,
      await tx.equipment.findUniqueOrThrow({ where: { id: owner.id } }),
    );
    expect(await getPrimaryEquipmentPhoto(owner.id)).toMatchObject({ id: first.photo.id });
  }));

test.each([
  { archived: false, usesPower: false },
  { archived: true, usesPower: false },
  { archived: true, usesPower: true },
])(
  'archived/non-powered state never blocks or changes photo upload: %j',
  ({ archived, usesPower }) =>
    fixture(async (tx) => {
      const location = await tx.location.create({
        data: { name: `photo-location-${randomUUID()}` },
      });
      const owner = await equipment(tx, {
        usesPower,
        archivedAt: archived ? new Date('2026-08-20T12:00:00.000Z') : null,
        locationId: location.id,
        notes: 'Keep all Equipment state',
      });
      const purchase = await tx.equipmentPurchase.create({
        data: { equipmentId: owner.id, equipmentPriceMinor: 0, seller: 'Keep seller' },
      });
      const period = usesPower
        ? await tx.equipmentPowerPeriod.create({
            data: {
              equipmentId: owner.id,
              powerWatts: '70',
              hoursPerDay: '12',
              effectiveFrom: new Date('2026-09-01T00:00:00.000Z'),
            },
          })
        : null;
      const uploaded = await uploadEquipmentPhoto(owner.id, { image, ...token(owner) });
      expectOnlyTimestampChanged(
        owner,
        await tx.equipment.findUniqueOrThrow({ where: { id: owner.id } }),
      );
      expect(await tx.equipmentPurchase.findUnique({ where: { equipmentId: owner.id } })).toEqual(
        purchase,
      );
      if (period)
        expect(await tx.equipmentPowerPeriod.findUnique({ where: { id: period.id } })).toEqual(
          period,
        );
      expect(uploaded.photo.equipmentId).toBe(owner.id);
    }),
);

test('primary switching is atomic, unique and already-primary selection is a no-op', () =>
  fixture(async (tx) => {
    const owner = await equipment(tx);
    const first = await uploadEquipmentPhoto(owner.id, { image, ...token(owner) });
    const second = await uploadEquipmentPhoto(owner.id, {
      image,
      expectedUpdatedAt: first.equipmentUpdatedAt.toISOString(),
    });
    const selected = await setPrimaryEquipmentPhoto(owner.id, {
      photoId: second.photo.id,
      expectedUpdatedAt: second.equipmentUpdatedAt.toISOString(),
    });
    expect(selected.changed).toBe(true);
    expect(selected.equipmentUpdatedAt.getTime()).toBeGreaterThan(
      second.equipmentUpdatedAt.getTime(),
    );
    expect(
      await tx.equipmentPhoto.count({ where: { equipmentId: owner.id, isPrimary: true } }),
    ).toBe(1);
    expect(await getPrimaryEquipmentPhoto(owner.id)).toMatchObject({ id: second.photo.id });
    const noOp = await setPrimaryEquipmentPhoto(owner.id, {
      photoId: second.photo.id,
      expectedUpdatedAt: selected.equipmentUpdatedAt.toISOString(),
    });
    expect(noOp).toEqual({ ...selected, changed: false });
  }));

test('stale and cross-owned primary requests cannot change either Equipment', () =>
  fixture(async (tx) => {
    const owner = await equipment(tx);
    const other = await equipment(tx);
    const uploaded = await uploadEquipmentPhoto(other.id, { image, ...token(other) });
    await expect(
      setPrimaryEquipmentPhoto(owner.id, {
        photoId: uploaded.photo.id,
        ...token(owner),
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      setPrimaryEquipmentPhoto(other.id, {
        photoId: uploaded.photo.id,
        ...token(other),
      }),
    ).rejects.toMatchObject({ code: 'STALE_UPDATE' });
    expect(await getPrimaryEquipmentPhoto(other.id)).toMatchObject({ id: uploaded.photo.id });
  }));

test('crop adjustment creates only a revision thumbnail and leaves original/display/other metadata intact', () =>
  fixture(async (tx, fake) => {
    const owner = await equipment(tx, { archivedAt: new Date('2026-08-01') });
    const uploaded = await uploadEquipmentPhoto(owner.id, {
      image,
      ...token(owner),
      caption: 'Preserve caption',
      takenAt: '2026-08-01T10:00:00.000Z',
    });
    const displayKey = equipmentPhotoVariantKey(uploaded.photo.storageKey, 'display');
    const originalBefore = Buffer.from(fake.objects.get(uploaded.photo.storageKey)!.body);
    const displayBefore = Buffer.from(fake.objects.get(displayKey)!.body);
    const beforeCount = fake.objects.size;
    const saved = await updateEquipmentPhotoCrop(owner.id, uploaded.photo.id, {
      crop: { x: 0, y: 0, size: 0.5 },
      expectedUpdatedAt: uploaded.equipmentUpdatedAt.toISOString(),
    });
    expect(saved).toMatchObject({ changed: true, equipmentUpdatedAt: expect.any(Date) });
    expect(saved.photo).toMatchObject({
      isPrimary: true,
      sortOrder: 0,
      caption: 'Preserve caption',
      takenAt: new Date('2026-08-01T10:00:00.000Z'),
      cropX: 0,
      cropY: 0,
      cropSize: 0.5,
      derivativeRevision: expect.any(String),
    });
    expect(fake.objects.size).toBe(beforeCount + 1);
    expect(fake.objects.get(uploaded.photo.storageKey)?.body).toEqual(originalBefore);
    expect(fake.objects.get(displayKey)?.body).toEqual(displayBefore);
    expect(
      fake.objects.has(
        equipmentPhotoVariantKey(
          uploaded.photo.storageKey,
          'thumbnail',
          saved.photo.derivativeRevision,
        ),
      ),
    ).toBe(true);
  }));

test('identical crop is a no-op while stale crop removes only its attempted revision', () =>
  fixture(async (tx, fake) => {
    const owner = await equipment(tx);
    const uploaded = await uploadEquipmentPhoto(owner.id, {
      image,
      ...token(owner),
      crop: { x: 0, y: 0, size: 0.5 },
    });
    const before = new Map(fake.objects);
    const noOp = await updateEquipmentPhotoCrop(owner.id, uploaded.photo.id, {
      crop: { x: 0, y: 0, size: 0.5 },
      expectedUpdatedAt: uploaded.equipmentUpdatedAt.toISOString(),
    });
    expect(noOp.changed).toBe(false);
    expect(fake.objects).toEqual(before);
    await tx.equipment.update({
      where: { id: owner.id },
      data: { updatedAt: new Date(uploaded.equipmentUpdatedAt.getTime() + 1) },
    });
    await expect(
      updateEquipmentPhotoCrop(owner.id, uploaded.photo.id, {
        crop: { x: 0, y: 0.5, size: 0.5 },
        expectedUpdatedAt: uploaded.equipmentUpdatedAt.toISOString(),
      }),
    ).rejects.toMatchObject({ code: 'STALE_UPDATE' });
    expect(fake.objects).toEqual(before);
  }));

test('gallery, owned lookup, primary list references and safe derivative lookup stay scoped', () =>
  fixture(async (tx, fake) => {
    const owner = await equipment(tx);
    const other = await equipment(tx);
    const first = await uploadEquipmentPhoto(owner.id, { image, ...token(owner) });
    const second = await uploadEquipmentPhoto(owner.id, {
      image,
      expectedUpdatedAt: first.equipmentUpdatedAt.toISOString(),
    });
    expect((await getEquipmentPhotoGallery(owner.id)).map(({ id }) => id)).toEqual([
      first.photo.id,
      second.photo.id,
    ]);
    expect(await getOwnedEquipmentPhoto(owner.id, first.photo.id)).toMatchObject({
      id: first.photo.id,
    });
    expect(await getOwnedEquipmentPhoto(other.id, first.photo.id)).toBeNull();
    expect(await getPrimaryEquipmentPhotoReferences([owner.id, other.id])).toEqual([
      {
        id: first.photo.id,
        equipmentId: owner.id,
        derivativeRevision: first.photo.derivativeRevision,
      },
    ]);
    await getEquipmentPhotoReadUrl(owner.id, first.photo.id, 'display');
    await getEquipmentPhotoReadUrl(owner.id, first.photo.id, 'thumbnail');
    expect(fake.storage.signVariant).toHaveBeenNthCalledWith(
      1,
      first.photo.storageKey,
      'display',
      first.photo.derivativeRevision,
    );
    expect(fake.storage.signVariant).toHaveBeenNthCalledWith(
      2,
      first.photo.storageKey,
      'thumbnail',
      first.photo.derivativeRevision,
    );
    await expect(
      getEquipmentPhotoReadUrl(owner.id, first.photo.id, 'original' as 'display'),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(
      getEquipmentPhotoReadUrl(other.id, first.photo.id, 'display'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  }));

test('Plant-namespaced or cross-owned Equipment metadata cannot be read, cropped or deleted', () =>
  fixture(async (tx) => {
    const owner = await equipment(tx);
    const photo = await tx.equipmentPhoto.create({
      data: {
        equipmentId: owner.id,
        storageKey: createPlantPhotoKeys(randomUUID(), 'png').original,
      },
    });
    await expect(getEquipmentPhotoReadUrl(owner.id, photo.id, 'display')).rejects.toThrow();
    await expect(
      updateEquipmentPhotoCrop(owner.id, photo.id, {
        crop: { x: 0, y: 0, size: 1 },
        ...token(owner),
      }),
    ).rejects.toThrow();
    await expect(
      deleteEquipmentPhoto(owner.id, photo.id, { confirmed: true, ...token(owner) }),
    ).rejects.toThrow();
  }));

test('deleting primary promotes deterministic remaining photo and removes only that complete asset', () =>
  fixture(async (tx, fake) => {
    const owner = await equipment(tx, { archivedAt: new Date('2026-08-01') });
    const first = await uploadEquipmentPhoto(owner.id, { image, ...token(owner) });
    const second = await uploadEquipmentPhoto(owner.id, {
      image,
      expectedUpdatedAt: first.equipmentUpdatedAt.toISOString(),
    });
    const third = await uploadEquipmentPhoto(owner.id, {
      image,
      expectedUpdatedAt: second.equipmentUpdatedAt.toISOString(),
    });
    const tiedDate = new Date('2026-08-01T00:00:00.000Z');
    await tx.equipmentPhoto.updateMany({
      where: { id: { in: [second.photo.id, third.photo.id] } },
      data: { sortOrder: 5, createdAt: tiedDate },
    });
    const expectedPrimary = [second.photo.id, third.photo.id].sort()[0];
    const supersededKey = equipmentPhotoVariantKey(
      first.photo.storageKey,
      'thumbnail',
      randomUUID(),
    );
    fake.objects.set(supersededKey, {
      key: supersededKey,
      body: image,
      contentType: 'image/webp',
      uploadId: randomUUID(),
    });
    const otherAssetBefore = [...fake.objects.keys()].filter(
      (key) => !key.startsWith(equipmentPhotoAssetPrefix(first.photo.storageKey)),
    );
    const result = await deleteEquipmentPhoto(owner.id, first.photo.id, {
      confirmed: true,
      expectedUpdatedAt: third.equipmentUpdatedAt.toISOString(),
    });
    expect(result).toMatchObject({
      deletedPhotoId: first.photo.id,
      primaryPhotoId: expectedPrimary,
      cleanupPending: false,
    });
    expect(await tx.equipmentPhoto.findUnique({ where: { id: first.photo.id } })).toBeNull();
    expect(await getPrimaryEquipmentPhoto(owner.id)).toMatchObject({ id: expectedPrimary });
    expect(
      [...fake.objects.keys()].some((key) =>
        key.startsWith(equipmentPhotoAssetPrefix(first.photo.storageKey)),
      ),
    ).toBe(false);
    expect([...fake.objects.keys()].sort()).toEqual(otherAssetBefore.sort());
  }));

test('non-primary and only-photo deletion preserve primary semantics', () =>
  fixture(async (tx) => {
    const owner = await equipment(tx);
    const first = await uploadEquipmentPhoto(owner.id, { image, ...token(owner) });
    const second = await uploadEquipmentPhoto(owner.id, {
      image,
      expectedUpdatedAt: first.equipmentUpdatedAt.toISOString(),
    });
    const nonPrimary = await deleteEquipmentPhoto(owner.id, second.photo.id, {
      confirmed: true,
      expectedUpdatedAt: second.equipmentUpdatedAt.toISOString(),
    });
    expect(nonPrimary.primaryPhotoId).toBe(first.photo.id);
    const only = await deleteEquipmentPhoto(owner.id, first.photo.id, {
      confirmed: true,
      expectedUpdatedAt: nonPrimary.equipmentUpdatedAt.toISOString(),
    });
    expect(only.primaryPhotoId).toBeNull();
    expect(await getEquipmentPhotoGallery(owner.id)).toEqual([]);
  }));

test('deletion rejects stale, cross-owned and cross-domain shared asset metadata', () =>
  fixture(async (tx, fake) => {
    const owner = await equipment(tx);
    const other = await equipment(tx);
    const uploaded = await uploadEquipmentPhoto(owner.id, { image, ...token(owner) });
    await expect(
      deleteEquipmentPhoto(other.id, uploaded.photo.id, { confirmed: true, ...token(other) }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      deleteEquipmentPhoto(owner.id, uploaded.photo.id, { confirmed: true, ...token(owner) }),
    ).rejects.toMatchObject({ code: 'STALE_UPDATE' });
    const parsed = createEquipmentPhotoKeys(owner.id, 'jpg');
    const sharedPlantKey = uploaded.photo.storageKey.replace(/original\.png$/, 'original.jpg');
    const plant = await tx.plant.create({ data: { reference: `photo-conflict-${randomUUID()}` } });
    await tx.plantPhoto.create({ data: { plantId: plant.id, storageKey: sharedPlantKey } });
    await expect(
      deleteEquipmentPhoto(owner.id, uploaded.photo.id, {
        confirmed: true,
        expectedUpdatedAt: uploaded.equipmentUpdatedAt.toISOString(),
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await tx.equipmentPhoto.findUnique({ where: { id: uploaded.photo.id } })).not.toBeNull();
    expect(fake.objects.size).toBe(3);
    expect(parsed.original).toMatch(/^equipment\//);
  }));

test('postcommit storage failure returns cleanupPending and never recreates deleted metadata', () =>
  fixture(async (tx, fake) => {
    const owner = await equipment(tx);
    const uploaded = await uploadEquipmentPhoto(owner.id, { image, ...token(owner) });
    fake.storage.removePhotoAsset.mockRejectedValue(new Error('private provider failure'));
    const result = await deleteEquipmentPhoto(owner.id, uploaded.photo.id, {
      confirmed: true,
      expectedUpdatedAt: uploaded.equipmentUpdatedAt.toISOString(),
    });
    expect(result.cleanupPending).toBe(true);
    expect(await tx.equipmentPhoto.findUnique({ where: { id: uploaded.photo.id } })).toBeNull();
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('private provider');
  }));

test('real related database failure rolls back metadata and timestamp then compensates storage', () =>
  fixture(async (tx, fake) => {
    const owner = await equipment(tx);
    await tx.$executeRaw`CREATE FUNCTION pg_temp.reject_equipment_photo_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF EXISTS (SELECT 1 FROM public."EquipmentPhoto" WHERE "equipmentId" = NEW.id) THEN
        RAISE EXCEPTION 'equipment photo rollback saw metadata';
      END IF;
      RAISE EXCEPTION 'equipment photo rollback missing metadata';
    END; $$`;
    await tx.$executeRaw`CREATE TRIGGER reject_equipment_photo_update AFTER UPDATE ON public."Equipment" FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_equipment_photo_update()`;
    await expect(uploadEquipmentPhoto(owner.id, { image, ...token(owner) })).rejects.toThrow(
      'equipment photo rollback saw metadata',
    );
    expect(await tx.equipment.findUnique({ where: { id: owner.id } })).toEqual(owner);
    expect(await tx.equipmentPhoto.count({ where: { equipmentId: owner.id } })).toBe(0);
    expect(fake.objects.size).toBe(0);
  }));
