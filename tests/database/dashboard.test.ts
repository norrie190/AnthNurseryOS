import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest';
import {
  Prisma,
  PrismaClient,
  type Prisma as PrismaTypes,
} from '../../src/generated/prisma/client';
import { getTestDatabaseUrl } from '../../scripts/test-database-target';
import { getDashboardSummary } from '../../src/modules/dashboard';

vi.mock('server-only', () => ({}));
vi.mock('../../src/lib/prisma', () => ({ getPrisma: () => binding ?? database }));

const url = getTestDatabaseUrl();
const database = new PrismaClient({
  adapter: new PrismaPg({ connectionString: url, max: 6, connectionTimeoutMillis: 5000 }),
});
const realTransaction = database.$transaction.bind(database);
let binding: object | undefined;
let baseline: unknown;
const rollback = new Error('Rollback all dashboard fixtures');

async function snapshot(client: PrismaClient | PrismaTypes.TransactionClient = database) {
  return client.$queryRaw`SELECT
    (SELECT jsonb_agg(t ORDER BY id) FROM "Plant" t) plants,
    (SELECT jsonb_agg(t ORDER BY id) FROM "PlantPurchase" t) plant_purchases,
    (SELECT jsonb_agg(t ORDER BY id) FROM "PlantPhoto" t) plant_photos,
    (SELECT jsonb_agg(t ORDER BY id) FROM "Equipment" t) equipment,
    (SELECT jsonb_agg(t ORDER BY id) FROM "EquipmentPurchase" t) equipment_purchases,
    (SELECT jsonb_agg(t ORDER BY id) FROM "EquipmentPhoto" t) equipment_photos,
    (SELECT jsonb_agg(t ORDER BY id) FROM "EquipmentPowerPeriod" t) power_periods,
    (SELECT jsonb_agg(t ORDER BY id) FROM "ElectricityTariff" t) tariffs,
    (SELECT jsonb_agg(t ORDER BY id) FROM "Location" t) locations,
    (SELECT jsonb_build_object('last_value', last_value::text, 'is_called', is_called) FROM public.plant_reference_sequence) ant,
    (SELECT jsonb_build_object('last_value', last_value::text, 'is_called', is_called) FROM public.equipment_reference_sequence) eqp`;
}

beforeAll(async () => {
  const [target] = await database.$queryRaw<
    { name: string; version: number }[]
  >`SELECT current_database() name, current_setting('server_version_num')::int version`;
  expect(target.name).toBe(decodeURIComponent(new URL(url).pathname.slice(1)));
  expect(target.version).toBeGreaterThanOrEqual(180000);
  expect(target.version).toBeLessThan(190000);
  baseline = await snapshot();
});

afterEach(async () => {
  binding = undefined;
  expect(await snapshot()).toEqual(baseline);
});

afterAll(() => database.$disconnect());

async function fixture(check: (tx: PrismaTypes.TransactionClient) => Promise<void>) {
  try {
    await realTransaction(
      async (tx) => {
        binding = {
          $transaction: async (
            operation: (client: PrismaTypes.TransactionClient) => Promise<unknown>,
            options: { isolationLevel: string },
          ) => {
            expect(options).toEqual({
              isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
            });
            return operation(tx);
          },
        };
        await check(tx);
        throw rollback;
      },
      { timeout: 20000 },
    );
  } catch (error) {
    if (error !== rollback) throw error;
  }
}

test('reads counts, investment, energy, tariff and recent metadata without mutating the database', () =>
  fixture(async (tx) => {
    const tieCreatedAt = new Date('2098-06-15T12:00:00.000Z');
    const archivedAt = new Date('2098-06-16T12:00:00.000Z');
    const plantIds = [
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000002',
      '00000000-0000-4000-8000-000000000003',
      '00000000-0000-4000-8000-000000000004',
      '00000000-0000-4000-8000-000000000005',
      '00000000-0000-4000-8000-000000000006',
    ];
    const statuses = ['GROWING', 'QUARANTINE', 'SOLD', 'DECEASED'] as const;
    for (let index = 0; index < plantIds.length; index += 1) {
      await tx.plant.create({
        data: {
          id: plantIds[index],
          reference: 'dashboard-plant-' + index,
          name: index === 0 ? null : 'Plant ' + index,
          status: statuses[index % statuses.length],
          createdAt: tieCreatedAt,
          archivedAt: index === 5 ? archivedAt : null,
          purchase:
            index === 0
              ? {
                  create: {
                    currency: 'GBP',
                    plantPriceMinor: 100,
                    shippingCostMinor: 0,
                    otherCostMinor: 25,
                  },
                }
              : index === 5
                ? {
                    create: {
                      currency: 'EUR',
                      plantPriceMinor: 200,
                      shippingCostMinor: null,
                      otherCostMinor: 0,
                    },
                  }
                : undefined,
        },
      });
    }
    await tx.plantPhoto.createMany({
      data: [
        {
          id: '10000000-0000-4000-8000-000000000001',
          plantId: plantIds[0],
          storageKey: 'dashboard/plant-primary-' + randomUUID(),
          isPrimary: true,
          cropX: 0.5,
          cropY: 0.5,
          cropSize: 0.8,
          derivativeRevision: '20000000-0000-4000-8000-000000000001',
        },
        {
          id: '10000000-0000-4000-8000-000000000002',
          plantId: plantIds[0],
          storageKey: 'dashboard/plant-gallery-' + randomUUID(),
          isPrimary: false,
        },
      ],
    });

    const configured = await tx.equipment.create({
      data: {
        id: '30000000-0000-4000-8000-000000000001',
        reference: 'dashboard-equipment-1',
        name: 'Configured light',
        usesPower: true,
        createdAt: tieCreatedAt,
        purchase: {
          create: {
            currency: 'GBP',
            equipmentPriceMinor: 300,
            shippingCostMinor: 50,
            otherCostMinor: 0,
          },
        },
      },
    });
    await tx.equipment.createMany({
      data: [
        {
          id: '30000000-0000-4000-8000-000000000002',
          reference: 'dashboard-equipment-2',
          name: 'Unconfigured fan',
          usesPower: true,
          createdAt: tieCreatedAt,
        },
        {
          id: '30000000-0000-4000-8000-000000000003',
          reference: 'dashboard-equipment-3',
          name: 'Pot',
          usesPower: false,
          createdAt: tieCreatedAt,
        },
        {
          id: '30000000-0000-4000-8000-000000000004',
          reference: 'dashboard-equipment-4',
          name: 'Archived heater',
          usesPower: true,
          createdAt: tieCreatedAt,
          archivedAt,
        },
      ],
    });
    await tx.equipmentPowerPeriod.createMany({
      data: [
        {
          equipmentId: configured.id,
          powerWatts: '100.00',
          hoursPerDay: '12.00',
          effectiveFrom: new Date('2098-01-01T00:00:00.000Z'),
        },
        {
          equipmentId: '30000000-0000-4000-8000-000000000004',
          powerWatts: '500.00',
          hoursPerDay: '24.00',
          effectiveFrom: new Date('2098-01-01T00:00:00.000Z'),
        },
      ],
    });
    await tx.electricityTariff.create({
      data: {
        unitRateMinorPerKwh: '25.00000',
        currency: 'GBP',
        effectiveFrom: new Date('2098-01-01T00:00:00.000Z'),
      },
    });
    await tx.equipmentPhoto.createMany({
      data: [
        {
          id: '40000000-0000-4000-8000-000000000001',
          equipmentId: configured.id,
          storageKey: 'dashboard/equipment-primary-' + randomUUID(),
          isPrimary: true,
          cropX: 0.5,
          cropY: 0.5,
          cropSize: 0.8,
          derivativeRevision: '50000000-0000-4000-8000-000000000001',
        },
        {
          id: '40000000-0000-4000-8000-000000000002',
          equipmentId: configured.id,
          storageKey: 'dashboard/equipment-gallery-' + randomUUID(),
          isPrimary: false,
        },
      ],
    });

    const before = await snapshot(tx);
    const result = await getDashboardSummary('2098-06-15');
    const after = await snapshot(tx);

    expect(after).toEqual(before);
    expect(result.plants).toEqual({
      activeCount: 5,
      growingCount: 2,
      quarantineCount: 1,
      soldCount: 1,
      deceasedCount: 1,
      archivedCount: 1,
    });
    expect(result.equipment).toEqual({
      activeCount: 3,
      activeUsesPowerCount: 2,
      activeDoesNotUsePowerCount: 1,
      archivedCount: 1,
    });
    expect(result.investment.plants).toMatchObject({
      relevantRecordCount: 6,
      completeCostRecordCount: 1,
      unknownCurrencyRecordCount: 4,
      coverageComplete: false,
    });
    expect(result.investment.combinedByCurrency).toEqual([
      expect.objectContaining({ currency: 'EUR', knownSpendSubtotalMinor: 200 }),
      expect.objectContaining({
        currency: 'GBP',
        knownSpendSubtotalMinor: 475,
        relevantRecordCount: 2,
        completeCostRecordCount: 2,
      }),
    ]);
    expect(result.energy).toMatchObject({
      activePoweredEquipmentCount: 2,
      activePoweredEquipmentConfiguredTodayCount: 1,
      archivedEquipmentWithOngoingSettingsTodayCount: 1,
      configuredOperatingDrawWatts: '100.00',
      estimatedKwh: { daily: '1.2000000', days30: '36.0000000', days365: '438.0000000' },
      knownEstimatedVariableCostPence: {
        daily: '30.000000000000',
        days30: '900.000000000000',
        days365: '10950.000000000000',
      },
      configurationCoverage: {
        relevantEquipmentCount: 2,
        configuredEquipmentCount: 1,
        complete: false,
      },
      costCoverage: { relevantEquipmentCount: 2, knownCostEquipmentCount: 1, complete: false },
      currentTariff: {
        currency: 'GBP',
        unitRateMinorPerKwh: '25.00000',
        effectiveFrom: '2098-01-01',
      },
    });
    expect(result.recentlyAdded.plants.map((item) => item.id)).toEqual(plantIds.slice(0, 4));
    expect(result.recentlyAdded.plants[0]).toMatchObject({
      displayName: 'Unnamed Plant',
      primaryPhoto: {
        id: '10000000-0000-4000-8000-000000000001',
        derivativeRevision: '20000000-0000-4000-8000-000000000001',
      },
    });
    expect(result.recentlyAdded.plants[0]).not.toHaveProperty('photos');
    expect(result.recentlyAdded.equipment.map((item) => item.id)).toEqual([
      '30000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000002',
      '30000000-0000-4000-8000-000000000003',
    ]);
    expect(result.recentlyAdded.equipment[0].primaryPhoto).toEqual({
      id: '40000000-0000-4000-8000-000000000001',
      derivativeRevision: '50000000-0000-4000-8000-000000000001',
    });
  }));

test('Repeatable Read excludes a row committed after the dashboard snapshot begins', async () => {
  const concurrent = new PrismaClient({
    adapter: new PrismaPg({ connectionString: url, max: 2, connectionTimeoutMillis: 5000 }),
  });
  const reference = 'dashboard-concurrent-' + randomUUID();
  let insertedId: string | undefined;
  try {
    binding = {
      $transaction: (
        operation: (client: PrismaTypes.TransactionClient) => Promise<unknown>,
        options: { isolationLevel: string },
      ) =>
        realTransaction(
          async (tx) => {
            let inserted = false;
            const wrapped = {
              plant: {
                findMany: async (args: Parameters<typeof tx.plant.findMany>[0]) => {
                  const rows = await tx.plant.findMany(args);
                  if (!inserted) {
                    inserted = true;
                    const row = await concurrent.equipment.create({
                      data: { reference, name: 'Concurrent item', usesPower: false },
                    });
                    insertedId = row.id;
                  }
                  return rows;
                },
              },
              equipment: tx.equipment,
              electricityTariff: tx.electricityTariff,
            } as unknown as PrismaTypes.TransactionClient;
            return operation(wrapped);
          },
          { isolationLevel: options.isolationLevel as Prisma.TransactionIsolationLevel },
        ),
    };

    const result = await getDashboardSummary('2098-06-15');

    expect(insertedId).toBeDefined();
    expect(result.recentlyAdded.equipment).not.toContainEqual(
      expect.objectContaining({ reference }),
    );
  } finally {
    binding = undefined;
    if (insertedId) await concurrent.equipment.delete({ where: { id: insertedId } });
    await concurrent.$disconnect();
  }
});
