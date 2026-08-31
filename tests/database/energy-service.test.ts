import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest';
import { PrismaClient, type Prisma } from '../../src/generated/prisma/client';
import { getTestDatabaseUrl } from '../../scripts/test-database-target';
import {
  recordEquipmentPowerPeriod,
  changeEquipmentPowerSettings,
  correctEquipmentPowerPeriod,
  voidEquipmentPowerPeriod,
} from '../../src/modules/energy/equipment-power-service';
import {
  recordElectricityTariff,
  changeElectricityTariff,
  correctElectricityTariff,
  voidElectricityTariff,
} from '../../src/modules/energy/electricity-tariff-service';
import {
  getEquipmentPowerHistory,
  getElectricityTariffHistory,
  getCurrentEquipmentPowerPeriod,
  getCurrentElectricityTariff,
  getEquipmentEnergySummary,
  getNurseryEnergySummary,
  getEquipmentEnergyProjections,
} from '../../src/modules/energy/energy-queries';
import {
  tariffTimelineToken,
  TARIFF_LOCK_ID,
  TARIFF_LOCK_NAMESPACE,
} from '../../src/modules/energy/energy-persistence';
import {
  archiveEquipment,
  restoreEquipment,
  updateEquipment,
} from '../../src/modules/equipment/equipment-service';
import { formatEnergyKwh, formatGbp } from '../../src/modules/energy/energy-calculations';
import { saveEnergyAction } from '../../src/modules/energy/energy-actions';
import { loadEquipmentEnergyView } from '../../src/modules/energy/energy-page-data';

vi.mock('server-only', () => ({}));
vi.mock('../../src/lib/prisma', () => ({ getPrisma: () => binding ?? database }));
const url = getTestDatabaseUrl();
const database = new PrismaClient({
  adapter: new PrismaPg({ connectionString: url, max: 8, connectionTimeoutMillis: 5000 }),
});
const realTransaction = database.$transaction.bind(database);
let binding: object | undefined;
let baseline: unknown;
const rollback = new Error('Rollback all energy fixtures');
const emptyToken = tariffTimelineToken([]);
const token = (equipment: { updatedAt: Date }) => ({
  expectedUpdatedAt: equipment.updatedAt.toISOString(),
});
const powerValues = { powerWatts: '80', hoursPerDay: '12', effectiveFrom: '2099-09-01' };
const tariffValues = { unitRateMinorPerKwh: '24.50', effectiveFrom: '2099-09-01' };
async function snapshot() {
  return database.$queryRaw`SELECT
    (SELECT jsonb_agg(t ORDER BY id) FROM "Equipment" t) equipment,
    (SELECT jsonb_agg(t ORDER BY id) FROM "EquipmentPurchase" t) purchases,
    (SELECT jsonb_agg(t ORDER BY id) FROM "EquipmentPowerPeriod" t) periods,
    (SELECT jsonb_agg(t ORDER BY id) FROM "ElectricityTariff" t) tariffs,
    (SELECT jsonb_agg(t ORDER BY id) FROM "Location" t) locations,
    (SELECT jsonb_agg(t ORDER BY id) FROM "Plant" t) plants,
    (SELECT jsonb_agg(t ORDER BY id) FROM "PlantPurchase" t) plant_purchases,
    (SELECT jsonb_agg(t ORDER BY id) FROM "PlantParentage" t) parentage,
    (SELECT jsonb_agg(t ORDER BY id) FROM "PlantPhoto" t) photos,
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
  vi.restoreAllMocks();
  expect(await snapshot()).toEqual(baseline);
});
afterAll(() => database.$disconnect());

async function fixture(check: (tx: Prisma.TransactionClient) => Promise<void>) {
  try {
    await realTransaction(
      async (tx) => {
        // Serialize overlapping logical calls inside the shared rollback fixture. Production
        // uses independent transactions; the separate connection test below exercises real locks.
        let pending: Promise<unknown> = Promise.resolve();
        const operationTransaction = (
          operation: (client: Prisma.TransactionClient) => Promise<unknown>,
          options: { isolationLevel: string },
        ) => {
          expect(['ReadCommitted', 'RepeatableRead']).toContain(options.isolationLevel);
          const run = pending.then(async () => {
            await tx.$executeRaw`SAVEPOINT energy_operation`;
            try {
              const result = await operation(tx);
              await tx.$executeRaw`RELEASE SAVEPOINT energy_operation`;
              return result;
            } catch (error) {
              await tx.$executeRaw`ROLLBACK TO SAVEPOINT energy_operation`;
              await tx.$executeRaw`RELEASE SAVEPOINT energy_operation`;
              throw error;
            }
          });
          pending = run.catch(() => undefined);
          return run;
        };
        binding = {
          equipment: tx.equipment,
          equipmentPowerPeriod: tx.equipmentPowerPeriod,
          electricityTariff: tx.electricityTariff,
          $transaction: operationTransaction,
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
function equipment(
  tx: Prisma.TransactionClient,
  data: Partial<Prisma.EquipmentUncheckedCreateInput> = {},
) {
  return tx.equipment.create({
    data: { reference: `energy-fixture-${randomUUID()}`, name: 'Light', usesPower: true, ...data },
  });
}
async function latestToken(tx: Prisma.TransactionClient, id: string) {
  return token(await tx.equipment.findUniqueOrThrow({ where: { id } }));
}

function browserForm(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

test('browser power workflow records, changes, corrects and voids on archived Equipment without unrelated changes', () =>
  fixture(async (tx) => {
    const item = await equipment(tx, {
      archivedAt: new Date('2026-01-01'),
      notes: 'Preserve inventory',
    });
    const context = {
      kind: 'power' as const,
      equipmentId: item.id,
      token: item.updatedAt.toISOString(),
    };
    const fields = {
      powerWatts: '70.00',
      hoursPerDay: '12',
      effectiveFrom: '2099-09-01',
      lastDay: '',
      notes: 'Initial',
    };
    expect(
      await saveEnergyAction({ ...context, mode: 'record' }, browserForm(fields)),
    ).toMatchObject({ success: true });
    const first = await tx.equipmentPowerPeriod.findFirstOrThrow({
      where: { equipmentId: item.id },
    });
    expect(first.powerWatts.toString()).toBe('70');
    expect(
      await saveEnergyAction(
        { ...context, mode: 'change' },
        browserForm({ powerWatts: '65', hoursPerDay: '11', effectiveFrom: '2099-09-21' }),
      ),
    ).toMatchObject({ success: false, stale: true });
    const fresh = async () => (await latestToken(tx, item.id)).expectedUpdatedAt;
    expect(
      await saveEnergyAction(
        { ...context, token: await fresh(), mode: 'change' },
        browserForm({ powerWatts: '65', hoursPerDay: '11', effectiveFrom: '2099-09-21' }),
      ),
    ).toMatchObject({ success: true });
    const corrected = {
      ...fields,
      lastDay: '2099-09-22',
      powerWatts: '80',
      correctionReason: 'Actual schedule checked',
      confirmAdjacent: 'yes',
    };
    expect(
      await saveEnergyAction(
        { ...context, token: await fresh(), mode: 'correct', periodId: first.id },
        browserForm(corrected),
      ),
    ).toMatchObject({ success: true });
    const history = await getEquipmentPowerHistory(item.id);
    expect(
      history.powerPeriods.map((p) => [
        p.effectiveFrom.toISOString().slice(0, 10),
        p.effectiveTo?.toISOString().slice(0, 10),
      ]),
    ).toEqual([
      ['2099-09-01', '2099-09-23'],
      ['2099-09-23', undefined],
    ]);
    expect(
      await saveEnergyAction(
        { ...context, token: await fresh(), mode: 'void', periodId: first.id },
        browserForm({ correctionReason: 'Incorrect source', confirmVoid: 'yes' }),
      ),
    ).toMatchObject({ success: true });
    expect(
      (await tx.equipmentPowerPeriod.findUniqueOrThrow({ where: { id: first.id } })).voidedAt,
    ).not.toBeNull();
    const after = await tx.equipment.findUniqueOrThrow({ where: { id: item.id } });
    expect({ ...after, updatedAt: item.updatedAt }).toEqual(item);
    const view = await loadEquipmentEnergyView(item.id);
    expect(view.rows).toHaveLength(2);
    expect(view.rows[0].voidedAt).not.toBeNull();
  }));

test('browser numeric and reason validation uses the real strict services with no rows written', () =>
  fixture(async (tx) => {
    const item = await equipment(tx);
    const c = {
      kind: 'power' as const,
      equipmentId: item.id,
      token: item.updatedAt.toISOString(),
      mode: 'record' as const,
    };
    for (const powerWatts of ['70.001', '1e2', 'NaN', '-1']) {
      expect(
        await saveEnergyAction(
          c,
          browserForm({ powerWatts, hoursPerDay: '12', effectiveFrom: '2099-01-01' }),
        ),
      ).toMatchObject({
        success: false,
        issues: expect.arrayContaining([expect.objectContaining({ field: 'powerWatts' })]),
      });
    }
    expect(await tx.equipmentPowerPeriod.count({ where: { equipmentId: item.id } })).toBe(0);
    expect(
      await saveEnergyAction(
        c,
        browserForm({
          powerWatts: '0',
          hoursPerDay: '24',
          effectiveFrom: '2099-01-01',
          lastDay: '2099-01-01',
        }),
      ),
    ).toMatchObject({ success: true });
    const period = await tx.equipmentPowerPeriod.findFirstOrThrow({
      where: { equipmentId: item.id },
    });
    expect(period.effectiveTo?.toISOString().slice(0, 10)).toBe('2099-01-02');
    for (const mode of ['correct', 'void'] as const) {
      const fields: Record<string, string> =
        mode === 'void'
          ? { correctionReason: ' ', confirmVoid: 'yes' }
          : {
              correctionReason: ' ',
              powerWatts: '0',
              hoursPerDay: '24',
              effectiveFrom: '2099-01-01',
              lastDay: '2099-01-01',
            };
      expect(
        await saveEnergyAction(
          {
            ...c,
            mode,
            periodId: period.id,
            token: (await latestToken(tx, item.id)).expectedUpdatedAt,
          },
          browserForm(fields),
        ),
      ).toMatchObject({
        success: false,
        issues: expect.arrayContaining([expect.objectContaining({ field: 'correctionReason' })]),
      });
    }
  }));

test('browser tariff workflow preserves exact rates, scheduled history, reason and stale timeline protection', () =>
  fixture(async (tx) => {
    const fresh = async () => (await getElectricityTariffHistory()).timelineToken;
    const c = { kind: 'tariff' as const, token: emptyToken, mode: 'record' as const };
    expect(
      await saveEnergyAction(
        c,
        browserForm({ unitRateMinorPerKwh: '24.501234', effectiveFrom: '2099-09-01' }),
      ),
    ).toMatchObject({ success: false });
    expect(
      await saveEnergyAction(
        c,
        browserForm({ unitRateMinorPerKwh: '24.50123', effectiveFrom: '2099-09-01' }),
      ),
    ).toMatchObject({ success: true });
    const first = await tx.electricityTariff.findFirstOrThrow();
    expect(first.unitRateMinorPerKwh.toFixed(5)).toBe('24.50123');
    const change = browserForm({ unitRateMinorPerKwh: '26.17', effectiveFrom: '2099-10-01' });
    expect(await saveEnergyAction({ ...c, mode: 'change' }, change)).toMatchObject({
      success: false,
      stale: true,
    });
    expect(
      await saveEnergyAction({ ...c, mode: 'change', token: await fresh() }, change),
    ).toMatchObject({ success: true });
    expect(
      await saveEnergyAction(
        { ...c, mode: 'correct', token: await fresh(), periodId: first.id },
        browserForm({
          unitRateMinorPerKwh: '0',
          effectiveFrom: '2099-09-01',
          lastDay: '2099-09-30',
          correctionReason: 'Free tariff confirmed',
        }),
      ),
    ).toMatchObject({ success: true });
    expect(
      await saveEnergyAction(
        { ...c, mode: 'void', token: await fresh(), periodId: first.id },
        browserForm({ correctionReason: 'Incorrect source', confirmVoid: 'yes' }),
      ),
    ).toMatchObject({ success: true });
    const history = await getElectricityTariffHistory();
    expect(history.tariffs).toHaveLength(2);
    expect(history.tariffs[0].voidedAt).not.toBeNull();
    expect(history.tariffs[1].effectiveFrom.toISOString().slice(0, 10)).toBe('2099-10-01');
  }));

test('recording maps strict values, allows zero and 24 hours, preserves identity and related data', () =>
  fixture(async (tx) => {
    const location = await tx.location.create({ data: { name: randomUUID() } });
    const item = await equipment(tx, {
      locationId: location.id,
      purchase: { create: { equipmentPriceMinor: 0 } },
      updatedAt: new Date('2100-01-01'),
    });
    const before = await tx.equipment.findUniqueOrThrow({
      where: { id: item.id },
      include: { purchase: true, location: true },
    });
    const result = await recordEquipmentPowerPeriod(item.id, {
      ...powerValues,
      powerWatts: '0',
      hoursPerDay: '24',
      notes: '  measured  ',
      ...token(item),
    });
    expect(result.period.powerWatts.toString()).toBe('0');
    expect(result.period.hoursPerDay.toString()).toBe('24');
    expect(result.period.notes).toBe('measured');
    expect(result.equipmentUpdatedAt.getTime()).toBe(item.updatedAt.getTime() + 1);
    const second = await changeEquipmentPowerSettings(item.id, {
      ...powerValues,
      effectiveFrom: '2099-09-02',
      hoursPerDay: '0',
      expectedUpdatedAt: result.equipmentUpdatedAt.toISOString(),
    });
    expect(second.equipmentUpdatedAt.getTime()).toBe(result.equipmentUpdatedAt.getTime() + 1);
    const after = await tx.equipment.findUniqueOrThrow({
      where: { id: item.id },
      include: { purchase: true, location: true },
    });
    expect({ ...after, updatedAt: before.updatedAt }).toEqual(before);
  }));
test('recording supports adjacency and gaps but rejects overlap, invalid interval and precision', () =>
  fixture(async (tx) => {
    const item = await equipment(tx);
    await recordEquipmentPowerPeriod(item.id, {
      ...powerValues,
      effectiveTo: '2099-09-10',
      ...token(item),
    });
    await recordEquipmentPowerPeriod(item.id, {
      ...powerValues,
      effectiveFrom: '2099-09-10',
      effectiveTo: '2099-09-20',
      ...(await latestToken(tx, item.id)),
    });
    await recordEquipmentPowerPeriod(item.id, {
      ...powerValues,
      effectiveFrom: '2099-10-01',
      ...(await latestToken(tx, item.id)),
    });
    await expect(
      recordEquipmentPowerPeriod(item.id, {
        ...powerValues,
        effectiveFrom: '2099-10-20',
        ...(await latestToken(tx, item.id)),
      }),
    ).rejects.toMatchObject({ code: 'OVERLAP' });
    await expect(
      recordEquipmentPowerPeriod(item.id, {
        ...powerValues,
        effectiveTo: '2099-09-01',
        ...(await latestToken(tx, item.id)),
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(
      recordEquipmentPowerPeriod(item.id, {
        ...powerValues,
        powerWatts: '80.001',
        ...(await latestToken(tx, item.id)),
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect((await getEquipmentPowerHistory(item.id)).powerPeriods).toHaveLength(3);
  }));
test('normal change preserves a scheduled successor and changes all boundaries atomically', () =>
  fixture(async (tx) => {
    const item = await equipment(tx);
    const first = await recordEquipmentPowerPeriod(item.id, {
      ...powerValues,
      effectiveTo: '2099-10-01',
      ...token(item),
    });
    const future = await recordEquipmentPowerPeriod(item.id, {
      ...powerValues,
      powerWatts: '50',
      effectiveFrom: '2099-10-01',
      ...(await latestToken(tx, item.id)),
    });
    const changed = await changeEquipmentPowerSettings(item.id, {
      ...powerValues,
      powerWatts: '65',
      hoursPerDay: '11',
      effectiveFrom: '2099-09-21',
      ...(await latestToken(tx, item.id)),
    });
    expect(changed.period.effectiveTo).toEqual(new Date('2099-10-01'));
    expect(
      (await tx.equipmentPowerPeriod.findUniqueOrThrow({ where: { id: first.period.id } }))
        .effectiveTo,
    ).toEqual(new Date('2099-09-21'));
    expect(
      await tx.equipmentPowerPeriod.findUniqueOrThrow({ where: { id: future.period.id } }),
    ).toEqual(future.period);
    const same = await changeEquipmentPowerSettings(item.id, {
      ...powerValues,
      powerWatts: '65',
      hoursPerDay: '11',
      effectiveFrom: '2099-09-21',
      ...(await latestToken(tx, item.id)),
    });
    expect(same.changed).toBe(false);
    expect(same.equipmentUpdatedAt).toEqual(changed.equipmentUpdatedAt);
  }));
test('corrections require explicit shared boundary adjustments, preserve notes when omitted and allow clear', () =>
  fixture(async (tx) => {
    const item = await equipment(tx);
    const left = await recordEquipmentPowerPeriod(item.id, {
      ...powerValues,
      notes: 'source',
      effectiveTo: '2099-09-16',
      ...token(item),
    });
    const right = await recordEquipmentPowerPeriod(item.id, {
      ...powerValues,
      effectiveFrom: '2099-09-16',
      ...(await latestToken(tx, item.id)),
    });
    await expect(
      correctEquipmentPowerPeriod(item.id, left.period.id, {
        effectiveTo: '2099-09-20',
        correctionReason: 'Wrong date',
        ...(await latestToken(tx, item.id)),
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    const corrected = await correctEquipmentPowerPeriod(item.id, left.period.id, {
      powerWatts: '70',
      effectiveTo: '2099-09-20',
      correctionReason: 'Wrong date',
      adjacentAdjustments: [{ periodId: right.period.id, effectiveFrom: '2099-09-20' }],
      ...(await latestToken(tx, item.id)),
    });
    expect(corrected.period.notes).toBe('source');
    expect(corrected.period.powerWatts.toString()).toBe('70');
    expect(
      (await tx.equipmentPowerPeriod.findUniqueOrThrow({ where: { id: right.period.id } }))
        .effectiveFrom,
    ).toEqual(new Date('2099-09-20'));
    const cleared = await correctEquipmentPowerPeriod(item.id, left.period.id, {
      notes: null,
      correctionReason: 'Clear note',
      ...(await latestToken(tx, item.id)),
    });
    expect(cleared.period.notes).toBeNull();
    const same = await correctEquipmentPowerPeriod(item.id, left.period.id, {
      notes: null,
      correctionReason: 'Clear note',
      ...(await latestToken(tx, item.id)),
    });
    expect(same.changed).toBe(false);
    expect(same.equipmentUpdatedAt).toEqual(cleared.equipmentUpdatedAt);
  }));
test('void preserves source history, leaves gaps, requires reason and does not rewrite a repeated void', () =>
  fixture(async (tx) => {
    const item = await equipment(tx);
    const created = await recordEquipmentPowerPeriod(item.id, { ...powerValues, ...token(item) });
    await expect(
      voidEquipmentPowerPeriod(item.id, created.period.id, {
        correctionReason: ' ',
        ...(await latestToken(tx, item.id)),
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    const voided = await voidEquipmentPowerPeriod(item.id, created.period.id, {
      correctionReason: 'Wrong Equipment',
      ...(await latestToken(tx, item.id)),
    });
    const again = await voidEquipmentPowerPeriod(item.id, created.period.id, {
      correctionReason: 'Retry',
      ...(await latestToken(tx, item.id)),
    });
    expect(again).toEqual({ ...voided, changed: false });
    expect((await getEquipmentPowerHistory(item.id)).powerPeriods).toHaveLength(1);
    expect(await getCurrentEquipmentPowerPeriod(item.id, '2099-09-02')).toBeNull();
    await expect(
      correctEquipmentPowerPeriod(item.id, created.period.id, {
        correctionReason: 'Try edit',
        ...(await latestToken(tx, item.id)),
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  }));
test('usesPower guards current/future history, but allows bounded past records and corrections', () =>
  fixture(async (tx) => {
    const item = await equipment(tx, { usesPower: false });
    await expect(
      recordEquipmentPowerPeriod(item.id, { ...powerValues, ...token(item) }),
    ).rejects.toMatchObject({ code: 'POWER_UNAVAILABLE' });
    const historical = await recordEquipmentPowerPeriod(item.id, {
      ...powerValues,
      effectiveFrom: '2020-01-01',
      effectiveTo: '2020-02-01',
      ...token(item),
    });
    await correctEquipmentPowerPeriod(item.id, historical.period.id, {
      powerWatts: '65',
      correctionReason: 'Meter reading',
      ...(await latestToken(tx, item.id)),
    });
    await expect(
      correctEquipmentPowerPeriod(item.id, historical.period.id, {
        effectiveTo: null,
        correctionReason: 'Reopen',
        ...(await latestToken(tx, item.id)),
      }),
    ).rejects.toMatchObject({ code: 'POWER_UNAVAILABLE' });
    await updateEquipment(item.id, { usesPower: true, ...(await latestToken(tx, item.id)) });
    const future = await recordEquipmentPowerPeriod(item.id, {
      ...powerValues,
      ...(await latestToken(tx, item.id)),
    });
    await expect(
      updateEquipment(item.id, { usesPower: false, ...(await latestToken(tx, item.id)) }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await voidEquipmentPowerPeriod(item.id, future.period.id, {
      correctionReason: 'Wrong schedule',
      ...(await latestToken(tx, item.id)),
    });
    expect(
      (await updateEquipment(item.id, { usesPower: false, ...(await latestToken(tx, item.id)) }))
        .usesPower,
    ).toBe(false);
    expect((await getEquipmentPowerHistory(item.id)).powerPeriods).toHaveLength(2);
  }));
test('archive/restore do not change power history and archived Equipment accepts corrections', () =>
  fixture(async (tx) => {
    const item = await equipment(tx);
    const period = await recordEquipmentPowerPeriod(item.id, {
      ...powerValues,
      effectiveFrom: '2020-01-01',
      ...token(item),
    });
    const archived = await archiveEquipment(item.id, await latestToken(tx, item.id));
    expect(
      await tx.equipmentPowerPeriod.findUniqueOrThrow({ where: { id: period.period.id } }),
    ).toEqual(period.period);
    expect((await getEquipmentPowerHistory(item.id)).hasOngoingPowerPeriod).toBe(true);
    await correctEquipmentPowerPeriod(item.id, period.period.id, {
      powerWatts: '70',
      correctionReason: 'Actual draw',
      ...token(archived.equipment),
    });
    expect((await tx.equipment.findUniqueOrThrow({ where: { id: item.id } })).archivedAt).toEqual(
      archived.equipment.archivedAt,
    );
    await restoreEquipment(item.id, await latestToken(tx, item.id));
    expect(await getCurrentEquipmentPowerPeriod(item.id)).not.toBeNull();
  }));
test('power writes and Equipment edits invalidate each other; concurrent callers cannot overwrite', () =>
  fixture(async (tx) => {
    const item = await equipment(tx);
    const outcomes = await Promise.allSettled([
      recordEquipmentPowerPeriod(item.id, { ...powerValues, ...token(item) }),
      recordEquipmentPowerPeriod(item.id, { ...powerValues, ...token(item) }),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.find((outcome) => outcome.status === 'rejected')).toMatchObject({
      reason: { code: 'STALE_UPDATE' },
    });
    await expect(updateEquipment(item.id, { notes: 'old', ...token(item) })).rejects.toMatchObject({
      code: 'STALE_UPDATE',
    });
    const stale = await latestToken(tx, item.id);
    await updateEquipment(item.id, { notes: 'new', ...stale });
    await expect(
      changeEquipmentPowerSettings(item.id, {
        ...powerValues,
        effectiveFrom: '2099-09-20',
        ...stale,
      }),
    ).rejects.toMatchObject({ code: 'STALE_UPDATE' });
  }));
test('ownership, not found and immutable inputs are enforced', () =>
  fixture(async (tx) => {
    const item = await equipment(tx);
    const other = await equipment(tx);
    const period = await recordEquipmentPowerPeriod(item.id, { ...powerValues, ...token(item) });
    await expect(
      voidEquipmentPowerPeriod(other.id, period.period.id, {
        correctionReason: 'Wrong owner',
        ...token(other),
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      recordEquipmentPowerPeriod(randomUUID(), { ...powerValues, ...token(item) }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      recordEquipmentPowerPeriod(item.id, {
        ...powerValues,
        ...token(item),
        id: randomUUID(),
      } as never),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  }));

test('tariff record/change/correction/void preserve dates and exact decimal rates', () =>
  fixture(async () => {
    const initial = await getElectricityTariffHistory();
    expect(initial.timelineToken).toBe(emptyToken);
    const first = await recordElectricityTariff({
      ...tariffValues,
      expectedTimelineToken: initial.timelineToken,
    });
    expect(first.tariff.unitRateMinorPerKwh.toString()).toBe('24.5');
    const next = await changeElectricityTariff({
      unitRateMinorPerKwh: '26.17',
      effectiveFrom: '2099-10-01',
      expectedTimelineToken: first.timelineToken,
    });
    const history = await getElectricityTariffHistory();
    expect(history.tariffs[0].effectiveTo).toEqual(new Date('2099-10-01'));
    expect((await getCurrentElectricityTariff('2099-10-01'))?.id).toBe(next.tariff.id);
    const corrected = await correctElectricityTariff(first.tariff.id, {
      unitRateMinorPerKwh: '24.56789',
      correctionReason: 'Bill precision',
      expectedTimelineToken: next.timelineToken,
    });
    expect(corrected.tariff.unitRateMinorPerKwh.toString()).toBe('24.56789');
    const same = await correctElectricityTariff(first.tariff.id, {
      unitRateMinorPerKwh: '24.56789',
      correctionReason: 'Bill precision',
      expectedTimelineToken: corrected.timelineToken,
    });
    expect(same.changed).toBe(false);
    expect(same.timelineToken).toBe(corrected.timelineToken);
    const voided = await voidElectricityTariff(first.tariff.id, {
      correctionReason: 'Wrong supply',
      expectedTimelineToken: corrected.timelineToken,
    });
    expect(await getCurrentElectricityTariff('2099-09-02')).toBeNull();
    const again = await voidElectricityTariff(first.tariff.id, {
      correctionReason: 'retry',
      expectedTimelineToken: voided.timelineToken,
    });
    expect(again).toEqual({ ...voided, changed: false });
    expect((await getElectricityTariffHistory()).tariffs).toHaveLength(2);
  }));
test('tariff gaps, adjacency, bounds, GBP and overlaps are validated', () =>
  fixture(async () => {
    const first = await recordElectricityTariff({
      ...tariffValues,
      effectiveTo: '2099-09-10',
      expectedTimelineToken: emptyToken,
    });
    const next = await recordElectricityTariff({
      ...tariffValues,
      unitRateMinorPerKwh: '0',
      effectiveFrom: '2099-09-10',
      effectiveTo: '2099-09-20',
      expectedTimelineToken: first.timelineToken,
    });
    const future = await recordElectricityTariff({
      ...tariffValues,
      effectiveFrom: '2099-10-01',
      expectedTimelineToken: next.timelineToken,
    });
    await expect(
      recordElectricityTariff({ ...tariffValues, expectedTimelineToken: future.timelineToken }),
    ).rejects.toMatchObject({ code: 'OVERLAP' });
    await expect(
      recordElectricityTariff({
        ...tariffValues,
        unitRateMinorPerKwh: '24.123456',
        expectedTimelineToken: future.timelineToken,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(
      recordElectricityTariff({
        ...tariffValues,
        currency: 'USD',
        expectedTimelineToken: future.timelineToken,
      } as never),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(await getCurrentElectricityTariff('2099-09-25')).toBeNull();
  }));
test('scheduled tariffs survive inserted settings and shared boundary corrections are atomic', () =>
  fixture(async (tx) => {
    const first = await recordElectricityTariff({
      ...tariffValues,
      effectiveTo: '2099-11-01',
      expectedTimelineToken: emptyToken,
    });
    const future = await recordElectricityTariff({
      ...tariffValues,
      unitRateMinorPerKwh: '30',
      effectiveFrom: '2099-11-01',
      expectedTimelineToken: first.timelineToken,
    });
    const inserted = await changeElectricityTariff({
      ...tariffValues,
      unitRateMinorPerKwh: '26',
      effectiveFrom: '2099-10-01',
      expectedTimelineToken: future.timelineToken,
    });
    expect(inserted.tariff.effectiveTo).toEqual(new Date('2099-11-01'));
    expect(
      await tx.electricityTariff.findUniqueOrThrow({ where: { id: future.tariff.id } }),
    ).toEqual(future.tariff);
    await expect(
      correctElectricityTariff(inserted.tariff.id, {
        effectiveFrom: '2099-09-21',
        correctionReason: 'Date',
        expectedTimelineToken: inserted.timelineToken,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    const corrected = await correctElectricityTariff(inserted.tariff.id, {
      effectiveFrom: '2099-09-21',
      correctionReason: 'Date',
      adjacentAdjustments: [{ periodId: first.tariff.id, effectiveTo: '2099-09-21' }],
      expectedTimelineToken: inserted.timelineToken,
    });
    expect(corrected.tariff.effectiveFrom).toEqual(new Date('2099-09-21'));
    expect(
      (await tx.electricityTariff.findUniqueOrThrow({ where: { id: first.tariff.id } }))
        .effectiveTo,
    ).toEqual(new Date('2099-09-21'));
  }));
test('empty timeline tokens and concurrent changes are protected including after voiding everything', () =>
  fixture(async () => {
    const outcomes = await Promise.allSettled([
      recordElectricityTariff({ ...tariffValues, expectedTimelineToken: emptyToken }),
      recordElectricityTariff({ ...tariffValues, expectedTimelineToken: emptyToken }),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.find((outcome) => outcome.status === 'rejected')).toMatchObject({
      reason: { code: 'STALE_UPDATE' },
    });
    const history = await getElectricityTariffHistory();
    const voided = await voidElectricityTariff(history.tariffs[0].id, {
      correctionReason: 'Wrong supply',
      expectedTimelineToken: history.timelineToken,
    });
    expect(voided.timelineToken).not.toBe(emptyToken);
    await expect(
      recordElectricityTariff({ ...tariffValues, expectedTimelineToken: emptyToken }),
    ).rejects.toMatchObject({ code: 'STALE_UPDATE' });
  }));

test('database exclusion failure rolls back a closed boundary and Equipment timestamp with its cause retained', () =>
  fixture(async (tx) => {
    const item = await equipment(tx);
    const initial = await recordEquipmentPowerPeriod(item.id, { ...powerValues, ...token(item) });
    await tx.$executeRawUnsafe(
      `CREATE FUNCTION pg_temp.reject_energy_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test exclusion failure' USING ERRCODE = '23P01'; END $$`,
    );
    await tx.$executeRawUnsafe(
      `CREATE TRIGGER reject_energy_insert BEFORE INSERT ON "EquipmentPowerPeriod" FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_energy_insert()`,
    );
    await expect(
      changeEquipmentPowerSettings(item.id, {
        ...powerValues,
        powerWatts: '65',
        effectiveFrom: '2099-09-21',
        expectedUpdatedAt: initial.equipmentUpdatedAt.toISOString(),
      }),
    ).rejects.toMatchObject({ code: 'OVERLAP', cause: expect.anything() });
    expect(
      await tx.equipmentPowerPeriod.findUniqueOrThrow({ where: { id: initial.period.id } }),
    ).toEqual(initial.period);
    expect((await tx.equipment.findUniqueOrThrow({ where: { id: item.id } })).updatedAt).toEqual(
      initial.equipmentUpdatedAt,
    );
  }));
test('tariff database failure also rolls back its previous boundary and timeline token', () =>
  fixture(async (tx) => {
    const initial = await recordElectricityTariff({
      ...tariffValues,
      expectedTimelineToken: emptyToken,
    });
    await tx.$executeRawUnsafe(
      `CREATE FUNCTION pg_temp.reject_tariff_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test constraint failure' USING ERRCODE = '23514'; END $$`,
    );
    await tx.$executeRawUnsafe(
      `CREATE TRIGGER reject_tariff_insert BEFORE INSERT ON "ElectricityTariff" FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_tariff_insert()`,
    );
    await expect(
      changeElectricityTariff({
        ...tariffValues,
        unitRateMinorPerKwh: '26',
        effectiveFrom: '2099-10-01',
        expectedTimelineToken: initial.timelineToken,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', cause: expect.anything() });
    expect(
      await tx.electricityTariff.findUniqueOrThrow({ where: { id: initial.tariff.id } }),
    ).toEqual(initial.tariff);
    expect((await getElectricityTariffHistory()).timelineToken).toBe(initial.timelineToken);
  }));
test('snapshot summaries include archived and now nonpowered historical Equipment, and retain incomplete coverage', () =>
  fixture(async (tx) => {
    const item = await equipment(tx, { archivedAt: new Date(), usesPower: false });
    await recordEquipmentPowerPeriod(item.id, {
      powerWatts: '70',
      hoursPerDay: '12',
      effectiveFrom: '2020-09-01',
      effectiveTo: '2020-10-01',
      ...token(item),
    });
    await recordElectricityTariff({
      unitRateMinorPerKwh: '25',
      effectiveFrom: '2020-09-01',
      expectedTimelineToken: emptyToken,
    });
    const range = { from: '2020-09-01', to: '2020-10-01' };
    const report = await getEquipmentEnergySummary(item.id, range);
    expect(report.energyComplete && report.costComplete).toBe(true);
    expect(formatEnergyKwh(report.knownSubtotal.kwhScaled)).toBe('25.2000000');
    expect(formatGbp(report.knownSubtotal.penceScaled)).toBe('£6.30');
    expect(
      (await getEquipmentEnergyProjections(item.id, '2020-09-02')).projection?.days365.penceScaled,
    ).toBe(7665n * 10n ** 12n);
    await equipment(tx); // unknown power history
    await equipment(tx, { usesPower: false }); // not applicable
    const nursery = await getNurseryEnergySummary(range);
    expect(nursery.equipment).toHaveLength(3);
    expect(nursery.energyComplete).toBe(false);
    expect(nursery.costComplete).toBe(false);
    expect(nursery.knownSubtotal).toEqual(report.knownSubtotal);
  }));

test('real independent PostgreSQL transactions wait on the tariff advisory lock and recheck the token', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let firstResult!: Awaited<ReturnType<typeof recordElectricityTariff>>;
  let ready!: () => void;
  const firstReady = new Promise<void>((resolve) => {
    ready = resolve;
  });
  let calls = 0;
  const transaction = async (operation: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
    const first = ++calls === 1;
    try {
      await realTransaction(
        async (tx) => {
          const result = await operation(tx);
          if (first) {
            firstResult = result as typeof firstResult;
            ready();
            await gate;
          }
          throw rollback;
        },
        { timeout: 15000 },
      );
    } catch (error) {
      if (error !== rollback) throw error;
    }
  };
  vi.spyOn(database, '$transaction').mockImplementation(
    transaction as typeof database.$transaction,
  );
  const first = recordElectricityTariff({ ...tariffValues, expectedTimelineToken: emptyToken });
  let second: Promise<unknown> | undefined;
  try {
    await Promise.race([
      firstReady,
      first.then(() => {
        throw new Error('First transaction ended before taking its lock');
      }),
    ]);
    // This token describes the uncommitted first change. After it rolls back, the
    // waiter must see the empty timeline and reject this token rather than write.
    second = recordElectricityTariff({
      ...tariffValues,
      expectedTimelineToken: firstResult.timelineToken,
    }).catch((error: unknown) => error);
    await vi.waitFor(
      async () => {
        const locks = await database.$queryRaw<
          { granted: boolean }[]
        >`SELECT granted FROM pg_locks WHERE locktype='advisory' AND classid=${TARIFF_LOCK_NAMESPACE}::oid AND objid=${TARIFF_LOCK_ID}::oid AND database=(SELECT oid FROM pg_database WHERE datname=current_database())`;
        expect(locks.some((lock) => lock.granted)).toBe(true);
        expect(locks.some((lock) => !lock.granted)).toBe(true);
      },
      { timeout: 3000, interval: 20 },
    );
  } finally {
    release();
    await first;
  }
  expect(await second).toMatchObject({ code: 'STALE_UPDATE' });
});
