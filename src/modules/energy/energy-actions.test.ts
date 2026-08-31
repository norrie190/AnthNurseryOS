import { beforeEach, expect, test, vi } from 'vitest';
import { Prisma } from '../../generated/prisma/client';
import { saveEnergyAction } from './energy-actions';
import * as power from './equipment-power-service';
import * as tariff from './electricity-tariff-service';
import { getEquipmentPowerHistory, getElectricityTariffHistory } from './energy-queries';
import { EnergyError } from './energy-errors';
import type { EnergyContext } from './energy-browser';

vi.mock('server-only', () => ({}));
vi.mock('./equipment-power-service');
vi.mock('./electricity-tariff-service');
vi.mock('./energy-queries');
const id = '12345678-1234-4234-8234-123456789abc';
const other = '12345678-1234-4234-8234-123456789abd';
const timestamp = '2026-09-01T00:00:00.000Z';
const context: EnergyContext = { kind: 'power', equipmentId: id, mode: 'record', token: timestamp };
function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}
const values = {
  powerWatts: '70.00',
  hoursPerDay: '12',
  effectiveFrom: '2026-09-01',
  lastDay: '2026-09-30',
  notes: 'test',
};
const row = {
  id,
  equipmentId: id,
  effectiveFrom: new Date('2026-09-01'),
  effectiveTo: new Date('2026-10-01'),
  powerWatts: new Prisma.Decimal('70'),
  hoursPerDay: new Prisma.Decimal('12'),
  notes: null,
  correctionReason: null,
  voidedAt: null,
  createdAt: new Date(timestamp),
  updatedAt: new Date(timestamp),
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getEquipmentPowerHistory).mockResolvedValue({
    id,
    usesPower: true,
    archivedAt: null,
    updatedAt: new Date(timestamp),
    powerPeriods: [row],
    hasOngoingPowerPeriod: true,
  });
  vi.mocked(getElectricityTariffHistory).mockResolvedValue({
    timelineToken: 'a'.repeat(64),
    tariffs: [{ ...row, unitRateMinorPerKwh: new Prisma.Decimal('24.5'), currency: 'GBP' }],
  });
});
test('power record maps only approved fields and converts inclusive last day', async () => {
  expect(await saveEnergyAction(context, form(values))).toMatchObject({ success: true });
  expect(power.recordEquipmentPowerPeriod).toHaveBeenCalledWith(id, {
    powerWatts: '70.00',
    hoursPerDay: '12',
    effectiveFrom: '2026-09-01',
    effectiveTo: '2026-10-01',
    notes: 'test',
    expectedUpdatedAt: timestamp,
  });
});
test('blank last day is open; zero strings and notes remain intact at boundary', async () => {
  await saveEnergyAction(
    context,
    form({ ...values, lastDay: '', powerWatts: '0', hoursPerDay: '24' }),
  );
  expect(power.recordEquipmentPowerPeriod).toHaveBeenCalledWith(
    id,
    expect.objectContaining({ effectiveTo: null, powerWatts: '0', hoursPerDay: '24' }),
  );
});
test.each(['id', 'reference', 'updatedAt', 'voidedAt', 'data', 'currency', 'adjacentAdjustments'])(
  'rejects injected %s',
  async (key) => {
    expect(await saveEnergyAction(context, form({ ...values, [key]: 'untrusted' }))).toMatchObject({
      success: false,
    });
    expect(power.recordEquipmentPowerPeriod).not.toHaveBeenCalled();
  },
);
test('rejects duplicate fields, files and invalid context before service', async () => {
  const duplicate = form(values);
  duplicate.append('powerWatts', '2');
  expect(await saveEnergyAction(context, duplicate)).toMatchObject({ success: false });
  const file = form(values);
  file.set('notes', new File(['x'], 'x.txt'));
  expect(await saveEnergyAction(context, file)).toMatchObject({ success: false });
  expect(await saveEnergyAction({ ...context, equipmentId: 'bad' }, form(values))).toMatchObject({
    success: false,
  });
  expect(power.recordEquipmentPowerPeriod).not.toHaveBeenCalled();
});
test('invalid last day gives useful field error without service call', async () => {
  expect(await saveEnergyAction(context, form({ ...values, lastDay: '2026-02-30' }))).toMatchObject(
    { success: false, issues: [{ field: 'lastDay' }] },
  );
});
test('change delegates scheduling to existing power service, without supplying end', async () => {
  const data = form(values);
  data.delete('lastDay');
  await saveEnergyAction({ ...context, mode: 'change' }, data);
  expect(power.changeEquipmentPowerSettings).toHaveBeenCalledWith(id, {
    powerWatts: '70.00',
    hoursPerDay: '12',
    effectiveFrom: '2026-09-01',
    notes: 'test',
    expectedUpdatedAt: timestamp,
  });
});
test('correction sends explicit fields, reason and only confirmed adjacent adjustments', async () => {
  const successor = { ...row, id: other, effectiveFrom: new Date('2026-10-01'), effectiveTo: null };
  vi.mocked(getEquipmentPowerHistory).mockResolvedValue({
    id,
    usesPower: true,
    archivedAt: null,
    updatedAt: new Date(timestamp),
    powerPeriods: [row, successor],
    hasOngoingPowerPeriod: true,
  });
  const c = { ...context, mode: 'correct' as const, periodId: id };
  const data = { ...values, lastDay: '2026-10-05', correctionReason: 'Wrong date' };
  expect(await saveEnergyAction(c, form(data))).toMatchObject({ success: false });
  expect(power.correctEquipmentPowerPeriod).not.toHaveBeenCalled();
  expect(await saveEnergyAction(c, form({ ...data, confirmAdjacent: 'yes' }))).toMatchObject({
    success: true,
  });
  expect(power.correctEquipmentPowerPeriod).toHaveBeenCalledWith(
    id,
    id,
    expect.objectContaining({
      effectiveTo: '2026-10-06',
      correctionReason: 'Wrong date',
      adjacentAdjustments: [{ periodId: other, effectiveFrom: '2026-10-06' }],
    }),
  );
});
test.each(['power', 'tariff'] as const)(
  'void %s requires confirmation and delegates reason/token',
  async (kind) => {
    const c = {
      ...context,
      kind,
      mode: 'void' as const,
      periodId: id,
      token: kind === 'power' ? timestamp : 'a'.repeat(64),
    };
    expect(await saveEnergyAction(c, form({ correctionReason: 'Duplicate' }))).toMatchObject({
      success: false,
    });
    expect(
      await saveEnergyAction(c, form({ correctionReason: 'Duplicate', confirmVoid: 'yes' })),
    ).toMatchObject({ success: true });
    expect(
      kind === 'power' ? power.voidEquipmentPowerPeriod : tariff.voidElectricityTariff,
    ).toHaveBeenCalledOnce();
  },
);
test.each(['record', 'change', 'correct'] as const)(
  'tariff %s keeps exact pence strings and timeline token',
  async (mode) => {
    const data = form({
      unitRateMinorPerKwh: '24.50123',
      effectiveFrom: '2026-09-01',
      notes: 'Flat rate',
      ...(mode !== 'change' ? { lastDay: '2026-09-30' } : {}),
      ...(mode === 'correct' ? { correctionReason: 'Bill checked' } : {}),
    });
    expect(
      await saveEnergyAction(
        {
          kind: 'tariff',
          mode,
          periodId: mode === 'correct' ? id : undefined,
          token: 'a'.repeat(64),
        },
        data,
      ),
    ).toMatchObject({ success: true });
    const fn =
      mode === 'record'
        ? tariff.recordElectricityTariff
        : mode === 'change'
          ? tariff.changeElectricityTariff
          : tariff.correctElectricityTariff;
    expect(fn).toHaveBeenCalledOnce();
    const args = vi.mocked(fn).mock.calls[0];
    expect(args.at(-1)).toMatchObject({
      unitRateMinorPerKwh: '24.50123',
      expectedTimelineToken: 'a'.repeat(64),
    });
  },
);
test('safe validation and stale errors retain field issue information', async () => {
  vi.mocked(power.recordEquipmentPowerPeriod).mockRejectedValue(
    new EnergyError('VALIDATION_FAILED', 'Check the energy information.', {
      issues: [{ field: 'powerWatts', message: 'At most 2 decimal places.' }],
    }),
  );
  expect(await saveEnergyAction(context, form(values))).toMatchObject({
    success: false,
    issues: [{ field: 'powerWatts' }],
  });
  vi.mocked(power.recordEquipmentPowerPeriod).mockRejectedValue(
    new EnergyError('STALE_UPDATE', 'stale'),
  );
  expect(await saveEnergyAction(context, form(values))).toMatchObject({
    success: false,
    stale: true,
    message: expect.stringContaining('Your values have been kept'),
  });
});
test('unexpected failure retains server diagnostics without returning technical data', async () => {
  const error = new Error('secret database connection');
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.mocked(power.recordEquipmentPowerPeriod).mockRejectedValue(error);
  const response = await saveEnergyAction(context, form(values));
  expect(JSON.stringify(response)).not.toContain('secret');
  expect(log).toHaveBeenCalledWith('Energy form save failed', error);
  log.mockRestore();
});
