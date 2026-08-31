import 'server-only';
import type { ElectricityTariff, Prisma } from '../../generated/prisma/client';
import { dateToSql, nurseryToday } from '../../lib/calendar-date';
import { EnergyError } from './energy-errors';
import {
  intervalValues,
  nextEnergyTimestamp,
  tariffTimelineToken,
  withTariffTimeline,
} from './energy-persistence';
import {
  includesDate,
  planCorrection,
  planSettingChange,
  validateTimeline,
} from './energy-periods';
import {
  changeTariffSchema,
  correctTariffSchema,
  energyIdSchema,
  parseEnergy,
  recordTariffSchema,
  voidTariffSchema,
  type ChangeTariffInput,
  type CorrectTariffInput,
  type RecordTariffInput,
  type VoidTariffInput,
} from './energy-input';

export type TariffMutationResult = {
  tariff: ElectricityTariff;
  timelineToken: string;
  changed: boolean;
};
async function result(
  tx: Prisma.TransactionClient,
  tariff: ElectricityTariff,
  changed: boolean,
): Promise<TariffMutationResult> {
  return {
    tariff,
    changed,
    timelineToken: tariffTimelineToken(await tx.electricityTariff.findMany()),
  };
}
export async function recordElectricityTariff(
  input: RecordTariffInput,
): Promise<TariffMutationResult> {
  const values = parseEnergy(recordTariffSchema, input);
  return withTariffTimeline(values.expectedTimelineToken, async (tx, rows) => {
    const effectiveTo = values.effectiveTo ?? null;
    validateTimeline([
      ...rows.filter((row) => !row.voidedAt).map(intervalValues),
      { id: 'new', effectiveFrom: values.effectiveFrom, effectiveTo },
    ]);
    const tariff = await tx.electricityTariff.create({
      data: {
        unitRateMinorPerKwh: values.unitRateMinorPerKwh,
        currency: 'GBP',
        notes: values.notes ?? null,
        effectiveFrom: dateToSql(values.effectiveFrom),
        effectiveTo: effectiveTo ? dateToSql(effectiveTo) : null,
      },
    });
    return result(tx, tariff, true);
  });
}
export async function changeElectricityTariff(
  input: ChangeTariffInput,
): Promise<TariffMutationResult> {
  const values = parseEnergy(changeTariffSchema, input);
  return withTariffTimeline(values.expectedTimelineToken, async (tx, rows) => {
    if (values.effectiveFrom < nurseryToday())
      throw new EnergyError(
        'VALIDATION_FAILED',
        'Use a correction or record missing tariff history for past dates.',
      );
    const active = rows.filter((row) => !row.voidedAt).map(intervalValues);
    const same = active.find((row) => includesDate(row, values.effectiveFrom));
    if (
      same &&
      same.unitRateMinorPerKwh.toFixed(5) === values.unitRateMinorPerKwh &&
      same.notes === (values.notes ?? null)
    )
      return result(
        tx,
        rows.find((row) => row.id === same.id)!,
        false,
      );
    const plan = planSettingChange(active, values.effectiveFrom);
    if (plan.previous)
      await tx.electricityTariff.update({
        where: { id: plan.previous.id },
        data: {
          effectiveTo: dateToSql(values.effectiveFrom),
          updatedAt: nextEnergyTimestamp(plan.previous.updatedAt),
        },
      });
    const tariff = await tx.electricityTariff.create({
      data: {
        unitRateMinorPerKwh: values.unitRateMinorPerKwh,
        currency: 'GBP',
        notes: values.notes ?? null,
        effectiveFrom: dateToSql(values.effectiveFrom),
        effectiveTo: plan.effectiveTo ? dateToSql(plan.effectiveTo) : null,
      },
    });
    return result(tx, tariff, true);
  });
}
export async function correctElectricityTariff(
  tariffId: string,
  input: CorrectTariffInput,
): Promise<TariffMutationResult> {
  const id = parseEnergy(energyIdSchema, tariffId);
  const values = parseEnergy(correctTariffSchema, input);
  return withTariffTimeline(values.expectedTimelineToken, async (tx, rows) => {
    const current = rows.find((row) => row.id === id);
    if (!current) throw new EnergyError('NOT_FOUND', 'This electricity tariff could not be found.');
    if (current.voidedAt)
      throw new EnergyError(
        'CONFLICT',
        'A voided tariff cannot be corrected. Record a replacement if needed.',
      );
    const active = rows
      .filter((row) => !row.voidedAt)
      .map((row) => ({
        ...intervalValues(row),
        unitRateMinorPerKwh: row.unitRateMinorPerKwh.toFixed(5),
      }));
    const before = active.find((row) => row.id === id)!;
    const proposed = {
      ...before,
      unitRateMinorPerKwh: values.unitRateMinorPerKwh ?? before.unitRateMinorPerKwh,
      effectiveFrom: values.effectiveFrom ?? before.effectiveFrom,
      effectiveTo: values.effectiveTo === undefined ? before.effectiveTo : values.effectiveTo,
      notes: values.notes === undefined ? before.notes : values.notes,
      correctionReason: values.correctionReason,
    };
    const changes = planCorrection(active, before, proposed, values.adjacentAdjustments);
    let changed = false;
    for (const change of changes) {
      const old = active.find((row) => row.id === change.id)!;
      if (
        old.unitRateMinorPerKwh === change.unitRateMinorPerKwh &&
        old.notes === change.notes &&
        old.effectiveFrom === change.effectiveFrom &&
        old.effectiveTo === change.effectiveTo &&
        old.correctionReason === values.correctionReason
      )
        continue;
      await tx.electricityTariff.update({
        where: { id: change.id },
        data: {
          unitRateMinorPerKwh: change.unitRateMinorPerKwh,
          notes: change.notes,
          effectiveFrom: dateToSql(change.effectiveFrom),
          effectiveTo: change.effectiveTo ? dateToSql(change.effectiveTo) : null,
          correctionReason: values.correctionReason,
          updatedAt: nextEnergyTimestamp(old.updatedAt),
        },
      });
      changed = true;
    }
    return result(tx, await tx.electricityTariff.findUniqueOrThrow({ where: { id } }), changed);
  });
}
export async function voidElectricityTariff(
  tariffId: string,
  input: VoidTariffInput,
): Promise<TariffMutationResult> {
  const id = parseEnergy(energyIdSchema, tariffId);
  const values = parseEnergy(voidTariffSchema, input);
  return withTariffTimeline(values.expectedTimelineToken, async (tx, rows) => {
    const current = rows.find((row) => row.id === id);
    if (!current) throw new EnergyError('NOT_FOUND', 'This electricity tariff could not be found.');
    if (current.voidedAt) return result(tx, current, false);
    const tariff = await tx.electricityTariff.update({
      where: { id },
      data: {
        voidedAt: new Date(),
        correctionReason: values.correctionReason,
        updatedAt: nextEnergyTimestamp(current.updatedAt),
      },
    });
    return result(tx, tariff, true);
  });
}
