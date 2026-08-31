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
  updatePlantPhotoCrop,
  previewNewPlantPhoto,
  getPlantPhotoCropPreview,
} from '../../src/modules/plants/plant-photo-service';
import {
  getPlantPhotoGallery,
  getPrimaryPlantPhoto,
  getPlantPhotoReadUrl,
} from '../../src/modules/plants/plant-photo-queries';
import { fakePlantPhotoStorage } from '../helpers/fake-plant-photo-storage';
import { photoFixture } from '../fixtures/plant-photo-images';
import { getPlantList, getArchivedPlantList } from '../../src/modules/plants/plant-queries';
import { createPhotoKeys, photoVariantKey } from '../../src/modules/plants/plant-photo-keys';
import {
  uploadPlantPhotoRequest,
  setPrimaryPlantPhotoRequest,
  deliverPlantPhoto,
} from '../../src/modules/plants/plant-photo-http';

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

test.each([false, true])(
  'browser upload, gallery, primary selection and list reads preserve archive state (%s)',
  (archived) =>
    fixture(async (tx, fake) => {
      const original = await plant(tx, {
        archivedAt: archived ? new Date('2026-08-01T00:00:00Z') : null,
        status: 'DECEASED',
      });
      const origin = 'http://127.0.0.1:3000';
      const list = archived ? getArchivedPlantList : getPlantList;
      expect((await list()).find((row) => row.id === original.id)?.photos).toEqual([]);
      async function upload(expectedUpdatedAt: string) {
        const body = new FormData();
        // Deliberately wrong MIME/extension: only the synthetic PNG bytes count.
        body.set('image', new File([new Uint8Array(image)], 'leaf.jpg', { type: 'image/jpeg' }));
        body.set('caption', ' Leaf photo ');
        body.set('takenAt', '2026-08-01T12:30:00.000Z');
        body.set('expectedUpdatedAt', expectedUpdatedAt);
        return uploadPlantPhotoRequest(
          new Request(`${origin}/plants/${original.id}/photos`, {
            method: 'POST',
            headers: { origin },
            body,
          }),
          original.id,
        );
      }
      const firstResponse = await upload(original.updatedAt.toISOString());
      expect(firstResponse.status).toBe(201);
      const first = await firstResponse.json();
      expect(first).not.toHaveProperty('photo');
      const secondResponse = await upload(first.plantUpdatedAt);
      expect(secondResponse.status).toBe(201);
      const second = await secondResponse.json();
      const gallery = await getPlantPhotoGallery(original.id);
      expect(gallery).toHaveLength(2);
      expect(gallery[0]).toMatchObject({
        caption: 'Leaf photo',
        isPrimary: true,
        takenAt: new Date('2026-08-01T12:30:00.000Z'),
      });
      expect((await list()).find((row) => row.id === original.id)?.photos).toEqual([
        { id: gallery[0].id, derivativeRevision: gallery[0].derivativeRevision },
      ]);
      const select = await setPrimaryPlantPhotoRequest(
        new Request(`${origin}/plants/${original.id}/photos/${gallery[1].id}/primary`, {
          method: 'POST',
          headers: { origin, 'content-type': 'application/json' },
          body: JSON.stringify({ expectedUpdatedAt: second.plantUpdatedAt }),
        }),
        original.id,
        gallery[1].id,
      );
      expect(select.status).toBe(200);
      const result = await select.json();
      expect((await list()).find((row) => row.id === original.id)?.photos).toEqual([
        { id: gallery[1].id, derivativeRevision: gallery[1].derivativeRevision },
      ]);
      expect(await tx.plant.findUnique({ where: { id: original.id } })).toEqual({
        ...original,
        updatedAt: new Date(result.plantUpdatedAt),
      });
      expect((await deliverPlantPhoto(original.id, gallery[1].id, 'thumbnail')).status).toBe(307);
      expect((await deliverPlantPhoto(original.id, gallery[0].id, 'display')).status).toBe(307);
      expect((await deliverPlantPhoto(original.id, gallery[0].id, 'original')).status).toBe(400);
      expect((await deliverPlantPhoto(randomUUID(), gallery[0].id, 'display')).status).toBe(404);
      expect((await upload(original.updatedAt.toISOString())).status).toBe(409);
      expect(fake.objects.size).toBe(6);
      expect(await tx.plantPhoto.count({ where: { plantId: original.id } })).toBe(2);
    }),
);

test('browser upload rejects malformed bytes through the real service without storing anything', () =>
  fixture(async (tx, fake) => {
    const original = await plant(tx);
    const origin = 'http://127.0.0.1:3000';
    const body = new FormData();
    body.set('image', new File(['not an image'], 'pretend.jpg', { type: 'image/jpeg' }));
    body.set('expectedUpdatedAt', original.updatedAt.toISOString());
    const response = await uploadPlantPhotoRequest(
      new Request(origin, { method: 'POST', headers: { origin }, body }),
      original.id,
    );
    expect(response.status).toBe(400);
    expect(fake.objects.size).toBe(0);
    expect(await tx.plantPhoto.count({ where: { plantId: original.id } })).toBe(0);
    expect(await tx.plant.findUnique({ where: { id: original.id } })).toEqual(original);
  }));

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
      if (object.key.includes('/thumbnails/'))
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

test('crop migration is installed with both checks and preserves nullable legacy rows', () =>
  fixture(async (tx, fake) => {
    const checks = await tx.$queryRaw<
      { conname: string }[]
    >`SELECT conname FROM pg_constraint WHERE conname IN ('PlantPhoto_crop_consistency_check', 'PlantPhoto_crop_ranges_check')`;
    expect(checks).toHaveLength(2);
    expect(
      await tx.$queryRaw`SELECT migration_name FROM "_prisma_migrations" WHERE migration_name = '20260831230000_add_plant_photo_thumbnail_crop' AND finished_at IS NOT NULL AND rolled_back_at IS NULL`,
    ).toHaveLength(1);
    const owner = await plant(tx);
    const keys = createPhotoKeys(owner.id, 'png');
    const photo = await tx.plantPhoto.create({
      data: { plantId: owner.id, storageKey: keys.original },
    });
    expect(photo).toMatchObject({
      cropX: null,
      cropY: null,
      cropSize: null,
      derivativeRevision: null,
    });
    await getPlantPhotoReadUrl(owner.id, photo.id, 'thumbnail');
    expect(fake.storage.signVariant).toHaveBeenLastCalledWith(keys.original, 'thumbnail', null);
    expect(photoVariantKey(keys.original, 'thumbnail', photo.derivativeRevision)).toBe(
      keys.thumbnail,
    );
  }));

test('crop consistency rejects every partially populated combination', () =>
  fixture(async (tx) => {
    const owner = await plant(tx);
    const fields = ['cropX', 'cropY', 'cropSize', 'derivativeRevision'] as const;
    for (let mask = 1; mask < 15; mask++) {
      const data = Object.fromEntries(
        fields
          .filter((_, index) => mask & (1 << index))
          .map((field) => [
            field,
            field === 'derivativeRevision' ? randomUUID() : field === 'cropSize' ? 1 : 0,
          ]),
      );
      await tx.$executeRaw`SAVEPOINT crop_check`;
      await expect(
        tx.plantPhoto.create({
          data: { plantId: owner.id, storageKey: `fixture/${randomUUID()}`, ...data },
        }),
      ).rejects.toThrow('PlantPhoto_crop_consistency_check');
      await tx.$executeRaw`ROLLBACK TO SAVEPOINT crop_check`;
    }
  }));

test.each([
  ['cropX', '-0.1'],
  ['cropX', '1'],
  ['cropY', '-0.1'],
  ['cropY', '1'],
  ['cropSize', '0'],
  ['cropSize', '1.01'],
  ...['cropX', 'cropY', 'cropSize'].flatMap((field) =>
    ['NaN', 'Infinity', '-Infinity'].map((value) => [field, value]),
  ),
])('database crop range rejects %s = %s', (field, value) =>
  fixture(async (tx) => {
    const owner = await plant(tx);
    const photo = await tx.plantPhoto.create({
      data: {
        plantId: owner.id,
        storageKey: `fixture/${randomUUID()}`,
        cropX: 0,
        cropY: 0,
        cropSize: 1,
        derivativeRevision: randomUUID(),
      },
    });
    await tx.$executeRaw`SAVEPOINT crop_range`;
    // Column comes only from the literal test cases above; values stay parameterised.
    await expect(
      tx.$executeRawUnsafe(
        `UPDATE "PlantPhoto" SET "${field}" = $1::double precision WHERE id = $2::uuid`,
        value,
        photo.id,
      ),
    ).rejects.toThrow('PlantPhoto_crop_ranges_check');
    await tx.$executeRaw`ROLLBACK TO SAVEPOINT crop_range`;
  }),
);

test.each([false, true])(
  'crop lifecycle preserves existing records and full images (archived: %s)',
  (archived) =>
    fixture(async (tx, fake) => {
      const owner = await plant(tx, {
        archivedAt: archived ? new Date('2026-01-01') : null,
        status: 'SOLD',
      });
      const preview = await previewNewPlantPhoto(owner.id, { image, ...token(owner) });
      expect(preview).toMatchObject({ width: 16, height: 12 });
      expect(fake.objects.size).toBe(0);
      expect(await tx.plant.findUnique({ where: { id: owner.id } })).toEqual(owner);
      const uploaded = await uploadPlantPhoto(owner.id, {
        image,
        ...token(owner),
        caption: 'Original caption',
        takenAt: '2026-01-02T00:00:00.000Z',
      });
      expect(uploaded.photo).toMatchObject({
        cropX: 0.125,
        cropY: 0,
        cropSize: 1,
        derivativeRevision: expect.any(String),
      });
      const originals = new Map(fake.objects);
      expect(await getPlantPhotoCropPreview(owner.id, uploaded.photo.id)).toEqual({
        width: 16,
        height: 12,
        crop: { x: 0.125, y: 0, size: 1 },
      });
      const crop = { x: 0, y: 0, size: 0.5 };
      vi.spyOn(Date, 'now').mockReturnValue(uploaded.plantUpdatedAt.getTime());
      const saved = await updatePlantPhotoCrop(owner.id, uploaded.photo.id, {
        crop,
        expectedUpdatedAt: uploaded.plantUpdatedAt.toISOString(),
      });
      expect(saved.plantUpdatedAt.getTime()).toBe(uploaded.plantUpdatedAt.getTime() + 1);
      expect(saved.photo).toEqual({
        ...uploaded.photo,
        cropX: 0,
        cropY: 0,
        cropSize: 0.5,
        derivativeRevision: saved.photo.derivativeRevision,
        updatedAt: saved.photo.updatedAt,
      });
      expect(saved.photo.updatedAt.getTime()).toBeGreaterThan(uploaded.photo.updatedAt.getTime());
      expect(saved.photo.derivativeRevision).not.toBe(uploaded.photo.derivativeRevision);
      for (const [key, value] of originals) expect(fake.objects.get(key)).toEqual(value);
      expect(fake.objects.size).toBe(4);
      expect(await tx.plant.findUnique({ where: { id: owner.id } })).toEqual({
        ...owner,
        updatedAt: saved.plantUpdatedAt,
      });
      const noOp = await updatePlantPhotoCrop(owner.id, saved.photo.id, {
        crop,
        expectedUpdatedAt: saved.plantUpdatedAt.toISOString(),
      });
      expect(noOp.changed).toBe(false);
      expect(noOp.plantUpdatedAt).toEqual(saved.plantUpdatedAt);
      expect(fake.objects.size).toBe(4);
      await expect(
        updatePlantPhotoCrop(owner.id, saved.photo.id, {
          crop,
          expectedUpdatedAt: uploaded.plantUpdatedAt.toISOString(),
        }),
      ).rejects.toMatchObject({ code: 'STALE_UPDATE' });
      await getPlantPhotoReadUrl(owner.id, saved.photo.id, 'thumbnail');
      expect(fake.storage.signVariant).toHaveBeenLastCalledWith(
        saved.photo.storageKey,
        'thumbnail',
        saved.photo.derivativeRevision,
      );
      const rows = await (archived ? getArchivedPlantList() : getPlantList());
      expect(rows.find((row) => row.id === owner.id)?.photos[0]).toEqual({
        id: saved.photo.id,
        derivativeRevision: saved.photo.derivativeRevision,
      });
      const second = await updatePlantPhotoCrop(owner.id, saved.photo.id, {
        crop: { x: 0.25, y: 0, size: 0.5 },
        expectedUpdatedAt: saved.plantUpdatedAt.toISOString(),
      });
      expect(second.plantUpdatedAt.getTime()).toBe(saved.plantUpdatedAt.getTime() + 1);
    }),
);

test('legacy photo is untouched on preview, gains its first revision only on save', () =>
  fixture(async (tx, fake) => {
    const owner = await plant(tx);
    const keys = createPhotoKeys(owner.id, 'png');
    const photo = await tx.plantPhoto.create({
      data: { plantId: owner.id, storageKey: keys.original },
    });
    fake.objects.set(keys.original, {
      key: keys.original,
      body: image,
      contentType: 'image/png',
      uploadId: randomUUID(),
    });
    expect((await getPlantPhotoCropPreview(owner.id, photo.id)).crop).toBeNull();
    expect(await tx.plantPhoto.findUnique({ where: { id: photo.id } })).toEqual(photo);
    const saved = await updatePlantPhotoCrop(owner.id, photo.id, {
      crop: { x: 0.125, y: 0, size: 1 },
      ...token(owner),
    });
    expect(saved.changed).toBe(true);
    expect(fake.storage.upload).toHaveBeenCalledOnce();
    expect(saved.photo.storageKey).toBe(photo.storageKey);
  }));

test('a related timestamp failure rolls back a crop switch and removes only the attempted revision', () =>
  fixture(async (tx, fake) => {
    const owner = await plant(tx);
    const uploaded = await uploadPlantPhoto(owner.id, { image, ...token(owner) });
    const objects = new Map(fake.objects);
    await tx.$executeRaw`CREATE FUNCTION pg_temp.reject_crop_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF EXISTS (SELECT 1 FROM public."PlantPhoto" WHERE "plantId" = NEW.id AND "cropSize" = 0.5) THEN RAISE EXCEPTION 'crop rollback saw changed metadata'; END IF;
      RAISE EXCEPTION 'crop rollback missing metadata'; END; $$`;
    await tx.$executeRaw`CREATE TRIGGER reject_crop_update AFTER UPDATE ON public."Plant" FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_crop_update()`;
    await expect(
      updatePlantPhotoCrop(owner.id, uploaded.photo.id, {
        crop: { x: 0, y: 0, size: 0.5 },
        expectedUpdatedAt: uploaded.plantUpdatedAt.toISOString(),
      }),
    ).rejects.toThrow('crop rollback saw changed metadata');
    expect(await tx.plantPhoto.findUnique({ where: { id: uploaded.photo.id } })).toEqual(
      uploaded.photo,
    );
    expect((await tx.plant.findUniqueOrThrow({ where: { id: owner.id } })).updatedAt).toEqual(
      uploaded.plantUpdatedAt,
    );
    expect(fake.objects).toEqual(objects);
    expect(fake.storage.remove).toHaveBeenCalledOnce();
  }));

test('crop rechecks after storage work and rejects another Plant photo before storage', () =>
  fixture(async (tx, fake) => {
    const owner = await plant(tx);
    const other = await plant(tx);
    const uploaded = await uploadPlantPhoto(owner.id, { image, ...token(owner) });
    const input = {
      crop: { x: 0, y: 0, size: 0.5 },
      expectedUpdatedAt: uploaded.plantUpdatedAt.toISOString(),
    };
    await expect(
      updatePlantPhotoCrop(other.id, uploaded.photo.id, { ...input, ...token(other) }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(updatePlantPhotoCrop(owner.id, randomUUID(), input)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    const before = new Map(fake.objects);
    fake.storage.upload.mockImplementation(async (object) => {
      fake.objects.set(object.key, object);
      await tx.plant.update({
        where: { id: owner.id },
        data: { updatedAt: new Date(uploaded.plantUpdatedAt.getTime() + 1) },
      });
    });
    await expect(updatePlantPhotoCrop(owner.id, uploaded.photo.id, input)).rejects.toMatchObject({
      code: 'STALE_UPDATE',
    });
    expect(fake.objects).toEqual(before);
    expect(await tx.plantPhoto.findUnique({ where: { id: uploaded.photo.id } })).toEqual(
      uploaded.photo,
    );
  }));
