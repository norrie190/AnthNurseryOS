import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { getTestDatabaseUrl } from '../../scripts/test-database-target';
import { PrismaClient, type Prisma } from '../../src/generated/prisma/client';
import { PlantError } from '../../src/modules/plants/plant-errors';
import {
  createPlant,
  type CreatedPlant,
  type CreatePlantInput,
} from '../../src/modules/plants/plant-service';

vi.mock('server-only', () => ({}));
// Only replace the application connection binding. All queries use real PostgreSQL.
vi.mock('../../src/lib/prisma', () => ({ getPrisma: () => database }));

const connectionString = getTestDatabaseUrl();
const database = new PrismaClient({
  adapter: new PrismaPg({
    connectionString,
    connectionTimeoutMillis: 5_000,
    max: 10,
  }),
});
const realTransaction = database.$transaction.bind(database);
let arrange: (transaction: Prisma.TransactionClient) => Promise<void>;
let inspect: (transaction: Prisma.TransactionClient, plant: CreatedPlant) => Promise<void>;
let baseline: unknown;

class RollbackFixture extends Error {
  constructor(readonly plant: CreatedPlant) {
    super('Roll back successful test fixtures.');
  }
}

async function counts() {
  return database.$queryRaw`
    SELECT (SELECT count(*) FROM "Plant") AS plants,
           (SELECT count(*) FROM "PlantParentage") AS parentage,
           (SELECT count(*) FROM "PlantPurchase") AS purchases,
           (SELECT count(*) FROM "PlantPhoto") AS photos,
           (SELECT count(*) FROM "Location") AS locations
  `;
}

beforeAll(async () => {
  const [target] = await database.$queryRaw<{ name: string; version: number }[]>`
    SELECT current_database() AS name, current_setting('server_version_num')::int AS version
  `;
  expect(target.name).toBe(decodeURIComponent(new URL(connectionString).pathname.slice(1)));
  expect(target.version).toBeGreaterThanOrEqual(180000);
  expect(target.version).toBeLessThan(190000);
  baseline = await counts();
});

beforeEach(() => {
  arrange = async () => {};
  inspect = async () => {};

  // Exercise the public createPlant operation, but always roll back successful fixtures.
  // SQL failures still escape the real Prisma transaction and trigger its own rollback.
  const rollbackTransaction = async (
    operation: (tx: Prisma.TransactionClient) => Promise<CreatedPlant>,
  ) => {
    try {
      return await realTransaction(
        async (transaction) => {
          await arrange(transaction);
          const plant = await operation(transaction);
          await inspect(transaction, plant);
          throw new RollbackFixture(plant);
        },
        { maxWait: 5_000, timeout: 10_000 },
      );
    } catch (error) {
      if (error instanceof RollbackFixture) return error.plant;
      throw error;
    }
  };
  // Prisma overloads this method for array transactions too; createPlant uses the callback form only.
  vi.spyOn(database, '$transaction').mockImplementation(
    rollbackTransaction as typeof database.$transaction,
  );
});

afterEach(async () => {
  vi.restoreAllMocks();
  expect(await counts()).toEqual(baseline);
});

afterAll(async () => {
  await database.$disconnect();
});

async function parentFixture(transaction: Prisma.TransactionClient, id = randomUUID()) {
  return transaction.plant.create({ data: { id, reference: `test-${randomUUID()}` } });
}

function sequenceNumber(reference: string): bigint {
  return BigInt(reference.slice(4));
}

describe('Plant creation against PostgreSQL', () => {
  test('has the reviewed persistent sequence without wrapping or row ownership', async () => {
    const rows = await database.$queryRaw`
      SELECT seqstart, seqincrement, seqmin, seqcycle, seqcache
      FROM pg_sequence WHERE seqrelid = 'public.plant_reference_sequence'::regclass
    `;
    expect(rows).toEqual([
      { seqstart: 1n, seqincrement: 1n, seqmin: 1n, seqcycle: false, seqcache: 1n },
    ]);
    const ownership = await database.$queryRaw`
      SELECT count(*)::int AS count FROM pg_depend
      WHERE classid = 'pg_class'::regclass AND objid = 'public.plant_reference_sequence'::regclass
        AND deptype IN ('a', 'i')
    `;
    expect(ownership).toEqual([{ count: 0 }]);
    const history = await database.$queryRaw`
      SELECT finished_at IS NOT NULL AS finished FROM "_prisma_migrations"
      WHERE migration_name = '20260830222017_add_plant_reference_sequence' AND rolled_back_at IS NULL
    `;
    expect(history).toEqual([{ finished: true }]);
  });

  test('creates a minimal unnamed Plant with defaults and no related records', async () => {
    const plant = await createPlant({});
    expect(plant).toMatchObject({
      name: null,
      status: 'GROWING',
      locationId: null,
      notes: null,
      archivedAt: null,
      parentage: null,
      purchase: null,
      location: null,
    });
    expect(plant.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(plant.reference).toMatch(/^ANT-\d{4,}$/);
    expect(plant.createdAt).toBeInstanceOf(Date);
    expect(plant.updatedAt).toBeInstanceOf(Date);
  });

  test('creates optional Location, parentage and purchase atomically', async () => {
    const locationId = randomUUID();
    const seedId = randomUUID();
    arrange = async (tx) => {
      await tx.location.create({ data: { id: locationId, name: `test-${randomUUID()}` } });
      await parentFixture(tx, seedId);
    };
    const plant = await createPlant({
      name: '  Velvet  ',
      notes: '  Purchased hybrid  ',
      status: 'QUARANTINE',
      locationId,
      parentage: { seedParentPlantId: seedId, pollenParentName: ' External pollen ' },
      purchase: {
        seller: ' Nursery ',
        orderReference: ' ORDER-123 ',
        purchaseDate: '2024-02-29',
        plantPriceMinor: 12500,
        shippingCostMinor: null,
        otherCostMinor: 0,
        currency: ' eur ',
      },
    });
    expect(plant).toMatchObject({
      name: 'Velvet',
      notes: 'Purchased hybrid',
      status: 'QUARANTINE',
      locationId,
      location: { id: locationId },
      parentage: {
        plantId: plant.id,
        seedParentPlantId: seedId,
        seedParentName: null,
        pollenParentPlantId: null,
        pollenParentName: 'External pollen',
      },
      purchase: {
        plantId: plant.id,
        seller: 'Nursery',
        orderReference: 'ORDER-123',
        plantPriceMinor: 12500,
        shippingCostMinor: null,
        otherCostMinor: 0,
        currency: 'EUR',
      },
    });
    expect(plant.purchase?.purchaseDate?.toISOString()).toBe('2024-02-29T00:00:00.000Z');
  });

  test('links two existing parents', async () => {
    const seed = randomUUID(),
      pollen = randomUUID();
    arrange = async (tx) => {
      await parentFixture(tx, seed);
      await parentFixture(tx, pollen);
    };
    expect(
      (await createPlant({ parentage: { seedParentPlantId: seed, pollenParentPlantId: pollen } }))
        .parentage,
    ).toMatchObject({ seedParentPlantId: seed, pollenParentPlantId: pollen });
  });

  test.each(['GROWING', 'SOLD', 'DECEASED'] as const)(
    'allows the same archived %s Plant in both parent roles',
    async (status) => {
      const id = randomUUID();
      arrange = async (tx) => {
        await parentFixture(tx, id);
        await tx.plant.update({
          where: { id },
          data: { status, archivedAt: new Date() },
        });
      };
      expect(
        (await createPlant({ parentage: { seedParentPlantId: id, pollenParentPlantId: id } }))
          .parentage,
      ).toMatchObject({ seedParentPlantId: id, pollenParentPlantId: id });
    },
  );

  test('assigns a new Plant to a Location already shared by another Plant', async () => {
    const locationId = randomUUID();
    arrange = async (tx) => {
      await tx.location.create({ data: { id: locationId, name: `test-${randomUUID()}` } });
      await tx.plant.create({ data: { reference: `test-${randomUUID()}`, locationId } });
    };
    inspect = async (tx) => {
      expect(await tx.plant.count({ where: { locationId } })).toBe(2);
    };
    expect((await createPlant({ locationId })).location?.id).toBe(locationId);
  });

  test.each(['0001-01-01', '9999-12-31'])(
    'preserves calendar date %s through PostgreSQL',
    async (purchaseDate) => {
      const plant = await createPlant({ purchase: { purchaseDate } });
      expect(plant.purchase?.purchaseDate?.toISOString()).toBe(`${purchaseDate}T00:00:00.000Z`);
    },
  );

  test.each([
    { seedParentName: ' External seed ' },
    { pollenParentName: ' External pollen ' },
    { seedParentName: 'External seed', pollenParentName: 'External pollen' },
  ])('accepts named parentage %j', async (parentage) => {
    const plant = await createPlant({ parentage });
    expect(plant.parentage?.seedParentName).toBe(parentage.seedParentName?.trim() ?? null);
    expect(plant.parentage?.pollenParentName).toBe(parentage.pollenParentName?.trim() ?? null);
  });

  test('does not create blank parentage but does preserve an explicit empty purchase', async () => {
    const plant = await createPlant({ parentage: { seedParentName: ' ' }, purchase: {} });
    expect(plant.parentage).toBeNull();
    expect(plant.purchase).toMatchObject({
      plantId: plant.id,
      currency: 'GBP',
      plantPriceMinor: null,
      shippingCostMinor: null,
      otherCostMinor: null,
      seller: null,
      orderReference: null,
      purchaseDate: null,
    });
  });

  test.each([null, 0, 12345])('persists purchase amounts %s without coercion', async (amount) => {
    const plant = await createPlant({
      purchase: { plantPriceMinor: amount, shippingCostMinor: amount, otherCostMinor: amount },
    });
    expect(plant.purchase).toMatchObject({
      plantPriceMinor: amount,
      shippingCostMinor: amount,
      otherCostMinor: amount,
    });
  });

  test.each(['seedParentPlantId', 'pollenParentPlantId'])('rejects missing %s', async (field) => {
    await expect(createPlant({ parentage: { [field]: randomUUID() } })).rejects.toMatchObject({
      code: 'INVALID_PARENT',
    });
  });

  test.each(['seed', 'pollen'])('rejects conflicting %s parent input', async (role) => {
    await expect(
      createPlant({
        parentage: { [`${role}ParentPlantId`]: randomUUID(), [`${role}ParentName`]: 'External' },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_PARENT' });
    expect(database.$transaction).not.toHaveBeenCalled();
  });

  test('rejects an archived Location', async () => {
    const id = randomUUID();
    arrange = async (tx) => {
      await tx.location.create({
        data: { id, name: `test-${randomUUID()}`, archivedAt: new Date() },
      });
    };
    await expect(createPlant({ locationId: id })).rejects.toMatchObject({
      code: 'LOCATION_UNAVAILABLE',
    });
  });

  test('rejects a missing Location', async () => {
    await expect(createPlant({ locationId: randomUUID() })).rejects.toMatchObject({
      code: 'LOCATION_UNAVAILABLE',
    });
  });

  test.each([
    { reference: 'ANT-0001' },
    { id: randomUUID() },
    { archivedAt: new Date() },
    { purchase: { create: {} } },
    { locationId: 'bad-id' },
    { parentage: { seedParentPlantId: 'bad-id' } },
    { purchase: { plantPriceMinor: -1 } },
  ])('rejects invalid public input before allocating %j', async (input) => {
    await expect(createPlant(input as CreatePlantInput)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    expect(database.$transaction).not.toHaveBeenCalled();
  });

  test('allocates unique references for simultaneous creation on separate connections', async () => {
    const workers = 6;
    let arrived = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const connections = new Set<number>();
    arrange = async (tx) => {
      const [row] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      connections.add(row.pid);
      if (++arrived === workers) release();
      await gate;
    };
    const results = await Promise.allSettled(
      Array.from({ length: workers }, () => createPlant({})),
    );
    const references = results.map((result) => {
      expect(result.status).toBe('fulfilled');
      if (result.status !== 'fulfilled') throw result.reason;
      return result.value.reference;
    });
    expect(connections.size).toBe(workers);
    expect(new Set(references).size).toBe(workers);
  });

  test('never reuses an allocation after its Plant transaction rolls back', async () => {
    const first = await createPlant({});
    expect(await database.plant.findUnique({ where: { id: first.id } })).toBeNull();
    const second = await createPlant({});
    expect(sequenceNumber(second.reference)).toBeGreaterThan(sequenceNumber(first.reference));
  });

  test('archiving a Plant does not change or release its allocation', async () => {
    inspect = async (tx, plant) => {
      await tx.plant.update({ where: { id: plant.id }, data: { archivedAt: new Date() } });
      expect((await tx.plant.findUniqueOrThrow({ where: { id: plant.id } })).reference).toBe(
        plant.reference,
      );
      const [row] = await tx.$queryRaw<
        { value: bigint }[]
      >`SELECT nextval('public.plant_reference_sequence') AS value`;
      expect(row.value).toBeGreaterThan(sequenceNumber(plant.reference));
    };
    await createPlant({});
  });

  test('retains the unique reference constraint as final protection', async () => {
    arrange = async (tx) => {
      const [next] = await tx.$queryRaw<{ value: bigint }[]>`
        SELECT CASE WHEN is_called THEN last_value + 1 ELSE last_value END AS value
        FROM public.plant_reference_sequence
      `;
      // Tests run sequentially; only this fixture deliberately reserves the next label.
      await tx.plant.create({
        data: { reference: `ANT-${next.value.toString().padStart(4, '0')}` },
      });
    };
    await expect(createPlant({})).rejects.toMatchObject({
      code: 'CONFLICT',
      cause: { code: 'P2002' },
    });
  });

  test('rolls back Plant and parentage when the related purchase insert fails in PostgreSQL', async () => {
    const marker = `rollback-${randomUUID()}`;
    arrange = async (tx) => {
      // Both the function and trigger disappear when this test transaction rolls back.
      await tx.$executeRaw`
        CREATE FUNCTION pg_temp.reject_test_purchase() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF EXISTS (SELECT 1 FROM public."Plant" WHERE id = NEW."plantId")
             AND EXISTS (SELECT 1 FROM public."PlantParentage" WHERE "plantId" = NEW."plantId") THEN
            RAISE EXCEPTION 'purchase rollback fixture: Plant and parentage already exist';
          END IF;
          RAISE EXCEPTION 'rollback fixture did not see earlier writes';
        END; $$
      `;
      await tx.$executeRaw`
        CREATE TRIGGER reject_test_purchase BEFORE INSERT ON public."PlantPurchase"
        FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_test_purchase()
      `;
    };
    let failure: unknown;
    try {
      await createPlant({ name: marker, parentage: { seedParentName: 'External' }, purchase: {} });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(PlantError);
    expect(String(failure)).toContain(
      'purchase rollback fixture: Plant and parentage already exist',
    );
    expect(await database.plant.count({ where: { name: marker } })).toBe(0);
    expect(await counts()).toEqual(baseline);
    expect(
      await database.$queryRaw`
      SELECT count(*)::int AS count FROM pg_trigger WHERE tgname = 'reject_test_purchase'
    `,
    ).toEqual([{ count: 0 }]);
  });
});
