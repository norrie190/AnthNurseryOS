import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest';
import { PrismaClient, type Prisma } from '../../src/generated/prisma/client';
import { getTestDatabaseUrl } from '../../scripts/test-database-target';
import { getPrisma } from '../../src/lib/prisma';
import { getPlantPhotoStorage } from '../../src/modules/plants/plant-photo-storage';
import {
  uploadPlantPhoto,
  setPrimaryPlantPhoto,
} from '../../src/modules/plants/plant-photo-service';
import {
  getPlantPhotoGallery,
  getPrimaryPlantPhoto,
  getPlantPhotoReadUrl,
} from '../../src/modules/plants/plant-photo-queries';
import { fakePlantPhotoStorage } from '../helpers/fake-plant-photo-storage';
import { photoFixture } from '../fixtures/plant-photo-images';

vi.mock('server-only', () => ({}));
vi.mock('../../src/lib/prisma', () => ({ getPrisma: vi.fn() }));
vi.mock('../../src/modules/plants/plant-photo-storage', () => ({ getPlantPhotoStorage: vi.fn() }));
const url = getTestDatabaseUrl();
const database = new PrismaClient({
  adapter: new PrismaPg({ connectionString: url, connectionTimeoutMillis: 5000, max: 5 }),
});
const rollbackFixture = new Error('Roll back photo fixtures');
let baseline: unknown;
let sequence: unknown;
let image: Buffer;

async function counts() {
  return database.$queryRaw`SELECT (SELECT count(*) FROM "Plant") AS plants, (SELECT count(*) FROM "PlantPhoto") AS photos`;
}
beforeAll(async () => {
  const [target] = await database.$queryRaw<
    { name: string; version: number }[]
  >`SELECT current_database() AS name, current_setting('server_version_num')::int AS version`;
  expect(target.name).toBe(decodeURIComponent(new URL(url).pathname.slice(1)));
  expect(target.version).toBeGreaterThanOrEqual(180000);
  expect(target.version).toBeLessThan(190000);
  baseline = await counts();
  sequence =
    await database.$queryRaw`SELECT last_value, is_called FROM public.plant_reference_sequence`;
  image = await photoFixture();
});
afterEach(async () => {
  vi.restoreAllMocks();
  expect(await counts()).toEqual(baseline);
  expect(
    await database.$queryRaw`SELECT last_value, is_called FROM public.plant_reference_sequence`,
  ).toEqual(sequence);
});
afterAll(() => database.$disconnect());

async function fixture(
  check: (
    tx: Prisma.TransactionClient,
    fake: ReturnType<typeof fakePlantPhotoStorage>,
  ) => Promise<void>,
) {
  const fake = fakePlantPhotoStorage();
  vi.mocked(getPlantPhotoStorage).mockReturnValue(fake.storage);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    await database.$transaction(
      async (tx) => {
        const operationTransaction = async (
          operation: (client: Prisma.TransactionClient) => Promise<unknown>,
          options: { isolationLevel: string },
        ) => {
          expect(options.isolationLevel).toBe('ReadCommitted');
          await tx.$executeRaw`SAVEPOINT plant_photo_operation`;
          try {
            const result = await operation(tx);
            await tx.$executeRaw`RELEASE SAVEPOINT plant_photo_operation`;
            return result;
          } catch (error) {
            await tx.$executeRaw`ROLLBACK TO SAVEPOINT plant_photo_operation`;
            await tx.$executeRaw`RELEASE SAVEPOINT plant_photo_operation`;
            throw error;
          }
        };
        // Test-only binding: real queries and mutations, operation savepoints nested in
        // an always-rolled-back fixture transaction. No production injection machinery.
        vi.mocked(getPrisma).mockReturnValue({
          plant: tx.plant,
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
  }
}
function plant(tx: Prisma.TransactionClient, data: Partial<Prisma.PlantUncheckedCreateInput> = {}) {
  return tx.plant.create({ data: { reference: `test-photo-${randomUUID()}`, ...data } });
}
function token(record: { updatedAt: Date }) {
  return { expectedUpdatedAt: record.updatedAt.toISOString() };
}

test('installs the reviewed partial unique index and migration', async () => {
  const indexes = await database.$queryRaw<
    { indexdef: string }[]
  >`SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'PlantPhoto_one_primary_per_plant_key'`;
  expect(indexes).toHaveLength(1);
  expect(indexes[0].indexdef).toContain('UNIQUE INDEX');
  expect(indexes[0].indexdef).toContain('WHERE ("isPrimary" = true)');
  expect(
    await database.$queryRaw`SELECT migration_name FROM "_prisma_migrations" WHERE migration_name = '20260831113000_add_primary_plant_photo_index' AND finished_at IS NOT NULL AND rolled_back_at IS NULL`,
  ).toHaveLength(1);
});

test('allows many nonprimary photos and one primary per Plant, rejecting a second primary', () =>
  fixture(async (tx) => {
    const one = await plant(tx);
    const two = await plant(tx);
    for (const [plantId, isPrimary] of [
      [one.id, true],
      [one.id, false],
      [one.id, false],
      [two.id, true],
    ] as const) {
      await tx.plantPhoto.create({
        data: { plantId, isPrimary, storageKey: `test-index/${randomUUID()}` },
      });
    }
    await tx.$executeRaw`SAVEPOINT photo_unique_check`;
    await expect(
      tx.plantPhoto.create({
        data: { plantId: one.id, isPrimary: true, storageKey: `test-index/${randomUUID()}` },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
    await tx.$executeRaw`ROLLBACK TO SAVEPOINT photo_unique_check`;
    expect(await tx.plantPhoto.count({ where: { plantId: one.id } })).toBe(3);
  }));

test('first upload becomes primary, later uploads append and advance the Plant token', () =>
  fixture(async (tx, fake) => {
    const original = await plant(tx);
    vi.spyOn(Date, 'now').mockReturnValue(original.updatedAt.getTime());
    const first = await uploadPlantPhoto(original.id, {
      image,
      ...token(original),
      caption: ' Leaf one ',
      takenAt: '2026-08-01T12:00:00.000Z',
    });
    expect(first.photo).toMatchObject({
      plantId: original.id,
      isPrimary: true,
      sortOrder: 0,
      caption: 'Leaf one',
      takenAt: new Date('2026-08-01T12:00:00.000Z'),
    });
    expect(first.plantUpdatedAt.getTime()).toBe(original.updatedAt.getTime() + 1);
    const second = await uploadPlantPhoto(original.id, {
      image,
      expectedUpdatedAt: first.plantUpdatedAt.toISOString(),
      originalFilename: '../../name.gif',
    });
    expect(second.photo).toMatchObject({
      isPrimary: false,
      sortOrder: 1,
      originalFilename: 'name.gif',
      caption: null,
      takenAt: null,
    });
    expect(second.photo.storageKey).toMatch(/original\.png$/);
    expect(second.plantUpdatedAt.getTime()).toBe(first.plantUpdatedAt.getTime() + 1);
    expect(fake.objects.size).toBe(6);
    const current = await tx.plant.findUniqueOrThrow({ where: { id: original.id } });
    expect(current).toEqual({ ...original, updatedAt: second.plantUpdatedAt });
    expect(await getPrimaryPlantPhoto(original.id)).toMatchObject({ id: first.photo.id });
    const gallery = await getPlantPhotoGallery(original.id);
    expect(gallery.map((photo) => photo.id)).toEqual([first.photo.id, second.photo.id]);
    expect(gallery[0]).not.toHaveProperty('storageKey');
  }));

test.each(['GROWING', 'QUARANTINE', 'SOLD', 'DECEASED'] as const)(
  'archived %s Plants retain all state while receiving and selecting photos',
  (status) =>
    fixture(async (tx) => {
      const location = await tx.location.create({
        data: { name: `photo-location-${randomUUID()}`, archivedAt: new Date() },
      });
      const original = await plant(tx, {
        archivedAt: new Date('2026-08-20T12:00:00.000Z'),
        status,
        locationId: location.id,
        notes: 'History',
      });
      const parentage = await tx.plantParentage.create({
        data: { plantId: original.id, seedParentName: 'External' },
      });
      const purchase = await tx.plantPurchase.create({
        data: { plantId: original.id, plantPriceMinor: 0 },
      });
      const first = await uploadPlantPhoto(original.id, { image, ...token(original) });
      const second = await uploadPlantPhoto(original.id, {
        image,
        expectedUpdatedAt: first.plantUpdatedAt.toISOString(),
      });
      const primary = await setPrimaryPlantPhoto(original.id, {
        photoId: second.photo.id,
        expectedUpdatedAt: second.plantUpdatedAt.toISOString(),
      });
      expect(primary.changed).toBe(true);
      expect(primary.plantUpdatedAt.getTime()).toBeGreaterThan(second.plantUpdatedAt.getTime());
      expect(await tx.plant.findUnique({ where: { id: original.id } })).toEqual({
        ...original,
        updatedAt: primary.plantUpdatedAt,
      });
      expect(await tx.plantParentage.findUnique({ where: { plantId: original.id } })).toEqual(
        parentage,
      );
      expect(await tx.plantPurchase.findUnique({ where: { plantId: original.id } })).toEqual(
        purchase,
      );
      expect(await tx.plantPhoto.count({ where: { plantId: original.id, isPrimary: true } })).toBe(
        1,
      );
      expect(await getPrimaryPlantPhoto(original.id)).toMatchObject({ id: second.photo.id });
      expect(
        await setPrimaryPlantPhoto(original.id, {
          photoId: second.photo.id,
          expectedUpdatedAt: primary.plantUpdatedAt.toISOString(),
        }),
      ).toEqual({ ...primary, changed: false });
      expect(await getPlantPhotoReadUrl(original.id, first.photo.id, 'display')).toMatchObject({
        expiresInSeconds: 300,
      });
    }),
);

test('two callers with the same token cannot silently overwrite each other', () =>
  fixture(async (tx) => {
    const original = await plant(tx);
    const first = await uploadPlantPhoto(original.id, { image, ...token(original) });
    await expect(
      uploadPlantPhoto(original.id, { image, ...token(original) }),
    ).rejects.toMatchObject({ code: 'STALE_UPDATE' });
    await expect(
      setPrimaryPlantPhoto(original.id, { photoId: first.photo.id, ...token(original) }),
    ).rejects.toMatchObject({ code: 'STALE_UPDATE' });
    expect(await tx.plantPhoto.count({ where: { plantId: original.id } })).toBe(1);
  }));

test('rechecks a token changed while storage was busy and compensates the uncommitted upload', () =>
  fixture(async (tx, fake) => {
    const original = await plant(tx);
    fake.storage.upload.mockImplementation(async (object) => {
      fake.objects.set(object.key, object);
      if (object.key.endsWith('thumbnail.webp'))
        await tx.plant.update({
          where: { id: original.id },
          data: { updatedAt: new Date(original.updatedAt.getTime() + 1) },
        });
    });
    await expect(
      uploadPlantPhoto(original.id, { image, ...token(original) }),
    ).rejects.toMatchObject({ code: 'STALE_UPDATE' });
    expect(fake.objects.size).toBe(0);
    expect(await tx.plantPhoto.count({ where: { plantId: original.id } })).toBe(0);
  }));

test('missing Plants and photos from other Plants are rejected', () =>
  fixture(async (tx) => {
    const original = await plant(tx);
    const other = await plant(tx);
    const uploaded = await uploadPlantPhoto(other.id, { image, ...token(other) });
    await expect(
      uploadPlantPhoto(randomUUID(), { image, ...token(original) }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      setPrimaryPlantPhoto(original.id, { photoId: uploaded.photo.id, ...token(original) }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      getPlantPhotoReadUrl(original.id, uploaded.photo.id, 'thumbnail'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  }));

test('empty reads need no storage; gallery tie breaks are deterministic', () =>
  fixture(async (tx) => {
    const original = await plant(tx);
    expect(await getPlantPhotoGallery(original.id)).toEqual([]);
    expect(await getPrimaryPlantPhoto(original.id)).toBeNull();
    const date = new Date('2026-08-31T00:00:00.000Z');
    const ids: string[] = [];
    for (let index = 0; index < 3; index++) {
      const row = await tx.plantPhoto.create({
        data: {
          plantId: original.id,
          storageKey: `test-order/${randomUUID()}`,
          sortOrder: 7,
          createdAt: date,
        },
      });
      ids.push(row.id);
    }
    expect((await getPlantPhotoGallery(original.id)).map((photo) => photo.id)).toEqual(ids.sort());
  }));

test('a real SQL failure after photo insertion rolls back metadata/timestamps and cleans the objects', () =>
  fixture(async (tx, fake) => {
    const original = await plant(tx);
    await tx.$executeRaw`CREATE FUNCTION pg_temp.reject_photo_plant_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF EXISTS (SELECT 1 FROM public."PlantPhoto" WHERE "plantId" = NEW.id) THEN RAISE EXCEPTION 'photo rollback fixture saw metadata'; END IF;
    RAISE EXCEPTION 'photo rollback fixture missing metadata'; END; $$`;
    await tx.$executeRaw`CREATE TRIGGER reject_photo_plant_update AFTER UPDATE ON public."Plant" FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_photo_plant_update()`;
    await expect(uploadPlantPhoto(original.id, { image, ...token(original) })).rejects.toThrow(
      'photo rollback fixture saw metadata',
    );
    expect(await tx.plant.findUnique({ where: { id: original.id } })).toEqual(original);
    expect(await tx.plantPhoto.count({ where: { plantId: original.id } })).toBe(0);
    expect(fake.objects.size).toBe(0);
  }));

test('a failed primary switch rolls back both the selection and Plant timestamp', () =>
  fixture(async (tx) => {
    const original = await plant(tx);
    const first = await uploadPlantPhoto(original.id, { image, ...token(original) });
    const second = await uploadPlantPhoto(original.id, {
      image,
      expectedUpdatedAt: first.plantUpdatedAt.toISOString(),
    });
    await tx.$executeRaw`CREATE FUNCTION pg_temp.reject_photo_switch() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'primary switch rollback'; END; $$`;
    await tx.$executeRaw`CREATE TRIGGER reject_photo_switch AFTER UPDATE ON public."Plant" FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_photo_switch()`;
    await expect(
      setPrimaryPlantPhoto(original.id, {
        photoId: second.photo.id,
        expectedUpdatedAt: second.plantUpdatedAt.toISOString(),
      }),
    ).rejects.toThrow('primary switch rollback');
    expect(await getPrimaryPlantPhoto(original.id)).toMatchObject({ id: first.photo.id });
    expect((await tx.plant.findUniqueOrThrow({ where: { id: original.id } })).updatedAt).toEqual(
      second.plantUpdatedAt,
    );
  }));
