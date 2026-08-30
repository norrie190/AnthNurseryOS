import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { getTestDatabaseUrl } from '../../scripts/test-database-target';
import type {
  Location,
  Plant,
  PlantParentage,
  PlantPhoto,
  PlantPurchase,
} from '../../src/generated/prisma/client';

const connectionString = getTestDatabaseUrl();
const database = new Client({
  connectionString,
  application_name: 'anth-nursery-database-tests',
  connectionTimeoutMillis: 5_000,
  statement_timeout: 5_000,
});

beforeAll(async () => {
  await database.connect();
  const result = await database.query<{ name: string; version: number }>(
    "SELECT current_database() AS name, current_setting('server_version_num')::int AS version",
  );
  expect(result.rows[0].name).toBe(decodeURIComponent(new URL(connectionString).pathname.slice(1)));
  expect(result.rows[0].version).toBeGreaterThanOrEqual(180000);
  expect(result.rows[0].version).toBeLessThan(190000);
  await database.query("SET search_path TO public; SET TIME ZONE 'UTC'");
});

beforeEach(async () => {
  await database.query('BEGIN');
});

afterEach(async () => {
  // A rejected statement aborts its transaction. ROLLBACK also clears that state.
  await database.query('ROLLBACK');
});

afterAll(async () => {
  await database.end();
});

async function insertPlant(reference = `test-${randomUUID()}`, locationId: string | null = null) {
  const result = await database.query<Plant>(
    'INSERT INTO "Plant" ("id", "reference", "locationId", "updatedAt") VALUES ($1, $2, $3, CURRENT_TIMESTAMP) RETURNING *',
    [randomUUID(), reference, locationId],
  );
  return result.rows[0];
}

async function insertLocation(
  name = `test-${randomUUID()}`,
  parentLocationId: string | null = null,
) {
  const result = await database.query<Location>(
    'INSERT INTO "Location" ("id", "name", "parentLocationId", "updatedAt") VALUES ($1, $2, $3, CURRENT_TIMESTAMP) RETURNING *',
    [randomUUID(), name, parentLocationId],
  );
  return result.rows[0];
}

type PurchaseCosts = Pick<
  PlantPurchase,
  'plantPriceMinor' | 'shippingCostMinor' | 'otherCostMinor'
>;

async function insertPurchase(plantId: string, costs: Partial<PurchaseCosts> = {}) {
  const result = await database.query<PlantPurchase>(
    'INSERT INTO "PlantPurchase" ("id", "plantId", "plantPriceMinor", "shippingCostMinor", "otherCostMinor", "updatedAt") VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP) RETURNING *',
    [
      randomUUID(),
      plantId,
      costs.plantPriceMinor ?? null,
      costs.shippingCostMinor ?? null,
      costs.otherCostMinor ?? null,
    ],
  );
  return result.rows[0];
}

type ParentDetails = Pick<
  PlantParentage,
  'seedParentPlantId' | 'seedParentName' | 'pollenParentPlantId' | 'pollenParentName'
>;

async function insertParentage(plantId: string, parents: Partial<ParentDetails> = {}) {
  const result = await database.query<PlantParentage>(
    'INSERT INTO "PlantParentage" ("id", "plantId", "seedParentPlantId", "seedParentName", "pollenParentPlantId", "pollenParentName", "updatedAt") VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP) RETURNING *',
    [
      randomUUID(),
      plantId,
      parents.seedParentPlantId ?? null,
      parents.seedParentName ?? null,
      parents.pollenParentPlantId ?? null,
      parents.pollenParentName ?? null,
    ],
  );
  return result.rows[0];
}

async function insertPhoto(plantId: string, storageKey = `test-photos/${randomUUID()}`) {
  const result = await database.query<PlantPhoto>(
    'INSERT INTO "PlantPhoto" ("id", "plantId", "storageKey", "updatedAt") VALUES ($1, $2, $3, CURRENT_TIMESTAMP) RETURNING *',
    [randomUUID(), plantId, storageKey],
  );
  return result.rows[0];
}

describe('initial Plant Management migration', () => {
  test('has the completed migration and custom PostgreSQL constraints installed', async () => {
    const history = await database.query<{ finished: boolean; rolledBack: boolean }>(
      'SELECT "finished_at" IS NOT NULL AS finished, "rolled_back_at" IS NOT NULL AS "rolledBack" FROM "_prisma_migrations" WHERE "migration_name" = $1',
      ['20260830195606_init_plant_management'],
    );
    expect(history.rows).toEqual([{ finished: true, rolledBack: false }]);

    const checks = await database.query<{ conname: string; convalidated: boolean }>(
      `SELECT conname, convalidated FROM pg_constraint
       WHERE conrelid = 'public."PlantPurchase"'::regclass AND contype = 'c'
       ORDER BY conname`,
    );
    expect(checks.rows).toEqual([
      { conname: 'PlantPurchase_otherCostMinor_nonnegative', convalidated: true },
      { conname: 'PlantPurchase_plantPriceMinor_nonnegative', convalidated: true },
      { conname: 'PlantPurchase_shippingCostMinor_nonnegative', convalidated: true },
    ]);

    const index = await database.query<{ indnullsnotdistinct: boolean }>(
      `SELECT indnullsnotdistinct FROM pg_index
       WHERE indexrelid = 'public."Location_parentLocationId_name_key"'::regclass`,
    );
    expect(index.rows).toEqual([{ indnullsnotdistinct: true }]);
  });

  test('allows an unnamed Plant without parentage, purchase or Location', async () => {
    const plant = await insertPlant();
    expect(plant).toMatchObject({
      name: null,
      locationId: null,
      notes: null,
      archivedAt: null,
      status: 'GROWING',
    });
    const related = await database.query(
      'SELECT (SELECT count(*)::int FROM "PlantPurchase" WHERE "plantId" = $1) AS purchases, (SELECT count(*)::int FROM "PlantParentage" WHERE "plantId" = $1) AS parentages, (SELECT count(*)::int FROM "PlantPhoto" WHERE "plantId" = $1) AS photos',
      [plant.id],
    );
    expect(related.rows).toEqual([{ purchases: 0, parentages: 0, photos: 0 }]);
  });

  test('rejects duplicate Plant references', async () => {
    const plant = await insertPlant();
    await expect(insertPlant(plant.reference)).rejects.toMatchObject({
      code: '23505',
      constraint: 'Plant_reference_key',
    });
  });

  test('does not release a reference when a Plant is archived', async () => {
    const plant = await insertPlant();
    await database.query('UPDATE "Plant" SET "archivedAt" = CURRENT_TIMESTAMP WHERE id = $1', [
      plant.id,
    ]);
    await expect(insertPlant(plant.reference)).rejects.toMatchObject({
      code: '23505',
      constraint: 'Plant_reference_key',
    });
  });

  test.each(['GROWING', 'QUARANTINE', 'SOLD', 'DECEASED'])(
    'accepts the approved status %s',
    async (status) => {
      const plant = await insertPlant();
      const result = await database.query<Plant>(
        'UPDATE "Plant" SET status = $1 WHERE id = $2 RETURNING *',
        [status, plant.id],
      );
      expect(result.rows[0].status).toBe(status);
    },
  );

  test('rejects a status outside the approved enum', async () => {
    const plant = await insertPlant();
    await expect(
      database.query('UPDATE "Plant" SET status = $1 WHERE id = $2', ['INVALID', plant.id]),
    ).rejects.toMatchObject({ code: '22P02' });
  });

  test('rejects duplicate root Location names', async () => {
    const root = await insertLocation();
    await expect(insertLocation(root.name)).rejects.toMatchObject({
      code: '23505',
      constraint: 'Location_parentLocationId_name_key',
    });
  });

  test('rejects duplicate child Location names under the same parent', async () => {
    const root = await insertLocation();
    await insertLocation('Top Shelf', root.id);
    await expect(insertLocation('Top Shelf', root.id)).rejects.toMatchObject({
      code: '23505',
      constraint: 'Location_parentLocationId_name_key',
    });
  });

  test('allows the same child Location name under different parents', async () => {
    const firstRack = await insertLocation();
    const secondRack = await insertLocation();
    const firstShelf = await insertLocation('Top Shelf', firstRack.id);
    const secondShelf = await insertLocation('Top Shelf', secondRack.id);
    expect(firstShelf.name).toBe(secondShelf.name);
    expect(firstShelf.parentLocationId).not.toBe(secondShelf.parentLocationId);
  });

  test('allows a root and a child Location to share a name', async () => {
    const root = await insertLocation();
    const child = await insertLocation(root.name, root.id);
    expect(child.name).toBe(root.name);
  });

  test('rejects moving a child into the root group when its name is taken', async () => {
    const root = await insertLocation();
    const child = await insertLocation(root.name, root.id);
    await expect(
      database.query('UPDATE "Location" SET "parentLocationId" = NULL WHERE id = $1', [child.id]),
    ).rejects.toMatchObject({ code: '23505', constraint: 'Location_parentLocationId_name_key' });
  });

  test('does not release an archived root Location name', async () => {
    const root = await insertLocation();
    await database.query('UPDATE "Location" SET "archivedAt" = CURRENT_TIMESTAMP WHERE id = $1', [
      root.id,
    ]);
    await expect(insertLocation(root.name)).rejects.toMatchObject({
      code: '23505',
      constraint: 'Location_parentLocationId_name_key',
    });
  });

  const costFields = ['plantPriceMinor', 'shippingCostMinor', 'otherCostMinor'] as const;

  test.each(costFields)('rejects a negative %s on insert', async (field) => {
    const plant = await insertPlant();
    await expect(insertPurchase(plant.id, { [field]: -1 })).rejects.toMatchObject({
      code: '23514',
      constraint: `PlantPurchase_${field}_nonnegative`,
    });
  });

  test.each(costFields)('rejects a negative %s on update', async (field) => {
    const plant = await insertPlant();
    const purchase = await insertPurchase(plant.id);
    // The column comes only from the fixed field list above, never from user input.
    await expect(
      database.query(`UPDATE "PlantPurchase" SET "${field}" = $1 WHERE id = $2`, [-1, purchase.id]),
    ).rejects.toMatchObject({ code: '23514', constraint: `PlantPurchase_${field}_nonnegative` });
  });

  test.each([null, 0])('allows and preserves purchase costs of %s', async (value) => {
    const plant = await insertPlant();
    const purchase = await insertPurchase(plant.id, {
      plantPriceMinor: value,
      shippingCostMinor: value,
      otherCostMinor: value,
    });
    expect(purchase).toMatchObject({
      plantPriceMinor: value,
      shippingCostMinor: value,
      otherCostMinor: value,
      currency: 'GBP',
      orderReference: null,
    });
  });

  test('preserves a mix of positive, unknown and zero purchase costs', async () => {
    const plant = await insertPlant();
    const purchase = await insertPurchase(plant.id, {
      plantPriceMinor: 12500,
      shippingCostMinor: null,
      otherCostMinor: 0,
    });
    expect(purchase).toMatchObject({
      plantPriceMinor: 12500,
      shippingCostMinor: null,
      otherCostMinor: 0,
    });
    const result = await database.query<PlantPurchase>(
      'UPDATE "PlantPurchase" SET currency = $1, "orderReference" = $2 WHERE id = $3 RETURNING *',
      ['EUR', 'SELLER-123', purchase.id],
    );
    expect(result.rows[0]).toMatchObject({ currency: 'EUR', orderReference: 'SELLER-123' });
  });

  test('rejects a second PlantPurchase for the same Plant', async () => {
    const plant = await insertPlant();
    await insertPurchase(plant.id);
    await expect(insertPurchase(plant.id)).rejects.toMatchObject({
      code: '23505',
      constraint: 'PlantPurchase_plantId_key',
    });
  });

  test('rejects a second PlantParentage for the same Plant', async () => {
    const plant = await insertPlant();
    await insertParentage(plant.id);
    await expect(insertParentage(plant.id)).rejects.toMatchObject({
      code: '23505',
      constraint: 'PlantParentage_plantId_key',
    });
  });

  test('allows multiple photos for one Plant', async () => {
    const plant = await insertPlant();
    const first = await insertPhoto(plant.id);
    const second = await insertPhoto(plant.id);
    expect(first.id).not.toBe(second.id);
    expect(first).toMatchObject({
      originalFilename: null,
      caption: null,
      takenAt: null,
      isPrimary: false,
      sortOrder: 0,
    });
    const result = await database.query(
      'SELECT count(*)::int AS count FROM "PlantPhoto" WHERE "plantId" = $1',
      [plant.id],
    );
    expect(result.rows).toEqual([{ count: 2 }]);
  });

  test('rejects duplicate photo storage keys even for different Plants', async () => {
    const first = await insertPlant();
    const second = await insertPlant();
    const photo = await insertPhoto(first.id);
    await expect(insertPhoto(second.id, photo.storageKey)).rejects.toMatchObject({
      code: '23505',
      constraint: 'PlantPhoto_storageKey_key',
    });
  });

  test('allows multiple Plants to share a Location', async () => {
    const location = await insertLocation();
    await insertPlant(undefined, location.id);
    await insertPlant(undefined, location.id);
    const result = await database.query(
      'SELECT count(*)::int AS count FROM "Plant" WHERE "locationId" = $1',
      [location.id],
    );
    expect(result.rows).toEqual([{ count: 2 }]);
  });

  test('links both parents to multiple offspring through internal Plant IDs', async () => {
    const seed = await insertPlant();
    const pollen = await insertPlant();
    const first = await insertPlant();
    const second = await insertPlant();
    for (const child of [first, second]) {
      await insertParentage(child.id, {
        seedParentPlantId: seed.id,
        pollenParentPlantId: pollen.id,
      });
    }
    const result = await database.query<{ seedReference: string; pollenReference: string }>(
      'SELECT s.reference AS "seedReference", p.reference AS "pollenReference" FROM "PlantParentage" a JOIN "Plant" s ON s.id = a."seedParentPlantId" JOIN "Plant" p ON p.id = a."pollenParentPlantId" WHERE a."plantId" = ANY($1::uuid[])',
      [[first.id, second.id]],
    );
    expect(result.rows).toEqual(
      Array(2).fill({ seedReference: seed.reference, pollenReference: pollen.reference }),
    );
  });

  test.each<Partial<ParentDetails>>([
    {},
    { seedParentName: 'External seed parent' },
    { pollenParentName: 'External pollen parent' },
    { seedParentName: 'External seed parent', pollenParentName: 'External pollen parent' },
  ])('allows unknown or external parentage (%j)', async (parents) => {
    const plant = await insertPlant();
    const parentage = await insertParentage(plant.id, parents);
    expect(parentage).toMatchObject({
      seedParentPlantId: null,
      pollenParentPlantId: null,
      seedParentName: null,
      pollenParentName: null,
      ...parents,
    });
  });

  test.each(['seedParentPlantId', 'pollenParentPlantId'] as const)(
    'allows only a linked %s',
    async (field) => {
      const parent = await insertPlant();
      const child = await insertPlant();
      const parentage = await insertParentage(child.id, { [field]: parent.id });
      expect(parentage[field]).toBe(parent.id);
    },
  );

  test('preserves all relationships when a Plant is archived', async () => {
    const location = await insertLocation();
    const seed = await insertPlant();
    const pollen = await insertPlant();
    const plant = await insertPlant(undefined, location.id);
    const offspring = await insertPlant();
    const parentage = await insertParentage(plant.id, {
      seedParentPlantId: seed.id,
      pollenParentPlantId: pollen.id,
    });
    const purchase = await insertPurchase(plant.id);
    const photo = await insertPhoto(plant.id);
    const offspringParentage = await insertParentage(offspring.id, { seedParentPlantId: plant.id });
    await database.query(
      'UPDATE "Plant" SET "archivedAt" = CURRENT_TIMESTAMP, status = $1 WHERE id = $2',
      ['DECEASED', plant.id],
    );

    const result = await database.query(
      'SELECT p.status, p."archivedAt", p."locationId", a.id AS parentage, b.id AS purchase, f.id AS photo, o.id AS offspring FROM "Plant" p JOIN "PlantParentage" a ON a."plantId" = p.id JOIN "PlantPurchase" b ON b."plantId" = p.id JOIN "PlantPhoto" f ON f."plantId" = p.id JOIN "PlantParentage" o ON o."seedParentPlantId" = p.id WHERE p.id = $1',
      [plant.id],
    );
    expect(result.rows).toEqual([
      {
        status: 'DECEASED',
        archivedAt: expect.any(Date),
        locationId: location.id,
        parentage: parentage.id,
        purchase: purchase.id,
        photo: photo.id,
        offspring: offspringParentage.id,
      },
    ]);
  });

  test('preserves Plants and child Locations when a Location is archived', async () => {
    const location = await insertLocation();
    const child = await insertLocation('Shelf', location.id);
    const plant = await insertPlant(undefined, location.id);
    await database.query('UPDATE "Location" SET "archivedAt" = CURRENT_TIMESTAMP WHERE id = $1', [
      location.id,
    ]);
    const result = await database.query(
      'SELECT p.id AS plant, c.id AS child FROM "Location" l JOIN "Plant" p ON p."locationId" = l.id JOIN "Location" c ON c."parentLocationId" = l.id WHERE l.id = $1',
      [location.id],
    );
    expect(result.rows).toEqual([{ plant: plant.id, child: child.id }]);
  });

  test.each([
    ['purchase', insertPurchase, 'PlantPurchase_plantId_fkey'],
    ['parentage', insertParentage, 'PlantParentage_plantId_fkey'],
    ['photo', insertPhoto, 'PlantPhoto_plantId_fkey'],
  ] as const)(
    'restricts deletion of a Plant with a %s',
    async (_label, insertRelated, constraint) => {
      const plant = await insertPlant();
      await insertRelated(plant.id);
      await expect(
        database.query('DELETE FROM "Plant" WHERE id = $1', [plant.id]),
      ).rejects.toMatchObject({ code: '23001', constraint });
    },
  );

  test.each(['seedParentPlantId', 'pollenParentPlantId'] as const)(
    'restricts deletion of a linked %s',
    async (field) => {
      const parent = await insertPlant();
      const child = await insertPlant();
      await insertParentage(child.id, { [field]: parent.id });
      await expect(
        database.query('DELETE FROM "Plant" WHERE id = $1', [parent.id]),
      ).rejects.toMatchObject({ code: '23001', constraint: `PlantParentage_${field}_fkey` });
    },
  );

  test('restricts deletion of a Location containing a Plant', async () => {
    const location = await insertLocation();
    await insertPlant(undefined, location.id);
    await expect(
      database.query('DELETE FROM "Location" WHERE id = $1', [location.id]),
    ).rejects.toMatchObject({ code: '23001', constraint: 'Plant_locationId_fkey' });
  });

  test('restricts deletion of a Location containing a child Location', async () => {
    const root = await insertLocation();
    await insertLocation('Shelf', root.id);
    await expect(
      database.query('DELETE FROM "Location" WHERE id = $1', [root.id]),
    ).rejects.toMatchObject({ code: '23001', constraint: 'Location_parentLocationId_fkey' });
  });

  test('rejects a nonexistent current Location', async () => {
    await expect(insertPlant(undefined, randomUUID())).rejects.toMatchObject({
      code: '23503',
      constraint: 'Plant_locationId_fkey',
    });
  });

  test.each(['seedParentPlantId', 'pollenParentPlantId'] as const)(
    'rejects a nonexistent linked %s',
    async (field) => {
      const plant = await insertPlant();
      await expect(insertParentage(plant.id, { [field]: randomUUID() })).rejects.toMatchObject({
        code: '23503',
        constraint: `PlantParentage_${field}_fkey`,
      });
    },
  );
});
