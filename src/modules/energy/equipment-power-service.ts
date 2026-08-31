import 'server-only';
import type { Equipment, EquipmentPowerPeriod } from '../../generated/prisma/client';
import { dateToSql, nurseryToday } from '../../lib/calendar-date';
import { EnergyError } from './energy-errors';
import {
  advanceEquipment,
  intervalValues,
  nextEnergyTimestamp,
  withEquipmentEnergy,
} from './energy-persistence';
import {
  includesDate,
  planCorrection,
  planSettingChange,
  validateTimeline,
} from './energy-periods';
import {
  changePowerSchema,
  correctPowerSchema,
  energyIdSchema,
  parseEnergy,
  recordPowerSchema,
  voidPowerSchema,
  type ChangePowerInput,
  type CorrectPowerInput,
  type RecordPowerInput,
  type VoidPowerInput,
} from './energy-input';

export type PowerMutationResult = {
  period: EquipmentPowerPeriod;
  equipmentUpdatedAt: Date;
  changed: boolean;
};
function requirePowerCapability(equipment: Equipment, end: string | null) {
  if (!equipment.usesPower && (end === null || end > nurseryToday()))
    throw new EnergyError(
      'POWER_UNAVAILABLE',
      'Enable power tracking before recording current or future operating periods.',
    );
}
function currentPeriod(rows: EquipmentPowerPeriod[], periodId: string) {
  const period = rows.find((row) => row.id === periodId);
  if (!period)
    throw new EnergyError('NOT_FOUND', 'This power period does not belong to this Equipment.');
  return period;
}
function samePower(
  a: EquipmentPowerPeriod,
  b: { powerWatts: string; hoursPerDay: string; notes: string | null },
) {
  return (
    a.powerWatts.toFixed(2) === b.powerWatts &&
    a.hoursPerDay.toFixed(2) === b.hoursPerDay &&
    a.notes === b.notes
  );
}

export async function recordEquipmentPowerPeriod(
  equipmentId: string,
  input: RecordPowerInput,
): Promise<PowerMutationResult> {
  const id = parseEnergy(energyIdSchema, equipmentId);
  const values = parseEnergy(recordPowerSchema, input);
  return withEquipmentEnergy(id, values.expectedUpdatedAt, async (tx, equipment) => {
    const effectiveTo = values.effectiveTo ?? null;
    requirePowerCapability(equipment, effectiveTo);
    const rows = await tx.equipmentPowerPeriod.findMany({
      where: { equipmentId: id, voidedAt: null },
    });
    validateTimeline([
      ...rows.map(intervalValues),
      { id: 'new', effectiveFrom: values.effectiveFrom, effectiveTo },
    ]);
    const period = await tx.equipmentPowerPeriod.create({
      data: {
        equipmentId: id,
        powerWatts: values.powerWatts,
        hoursPerDay: values.hoursPerDay,
        effectiveFrom: dateToSql(values.effectiveFrom),
        effectiveTo: effectiveTo ? dateToSql(effectiveTo) : null,
        notes: values.notes ?? null,
      },
    });
    return { period, equipmentUpdatedAt: await advanceEquipment(tx, equipment), changed: true };
  });
}

export async function changeEquipmentPowerSettings(
  equipmentId: string,
  input: ChangePowerInput,
): Promise<PowerMutationResult> {
  const id = parseEnergy(energyIdSchema, equipmentId);
  const values = parseEnergy(changePowerSchema, input);
  return withEquipmentEnergy(id, values.expectedUpdatedAt, async (tx, equipment) => {
    if (values.effectiveFrom < nurseryToday())
      throw new EnergyError(
        'VALIDATION_FAILED',
        'Use a correction or record missing history for past dates.',
      );
    requirePowerCapability(equipment, null);
    const rows = await tx.equipmentPowerPeriod.findMany({
      where: { equipmentId: id, voidedAt: null },
    });
    const active = rows.map(intervalValues);
    const covering = active.find((row) => includesDate(row, values.effectiveFrom));
    const same = covering && rows.find((row) => row.id === covering.id);
    if (same && samePower(same, { ...values, notes: values.notes ?? null }))
      return { period: same, equipmentUpdatedAt: equipment.updatedAt, changed: false };
    const plan = planSettingChange(active, values.effectiveFrom);
    if (plan.previous)
      await tx.equipmentPowerPeriod.update({
        where: { id: plan.previous.id },
        data: {
          effectiveTo: dateToSql(values.effectiveFrom),
          updatedAt: nextEnergyTimestamp(plan.previous.updatedAt),
        },
      });
    const period = await tx.equipmentPowerPeriod.create({
      data: {
        equipmentId: id,
        powerWatts: values.powerWatts,
        hoursPerDay: values.hoursPerDay,
        notes: values.notes ?? null,
        effectiveFrom: dateToSql(values.effectiveFrom),
        effectiveTo: plan.effectiveTo ? dateToSql(plan.effectiveTo) : null,
      },
    });
    return { period, equipmentUpdatedAt: await advanceEquipment(tx, equipment), changed: true };
  });
}

export async function correctEquipmentPowerPeriod(
  equipmentId: string,
  periodId: string,
  input: CorrectPowerInput,
): Promise<PowerMutationResult> {
  const id = parseEnergy(energyIdSchema, equipmentId);
  const targetId = parseEnergy(energyIdSchema, periodId);
  const values = parseEnergy(correctPowerSchema, input);
  return withEquipmentEnergy(id, values.expectedUpdatedAt, async (tx, equipment) => {
    const rows = await tx.equipmentPowerPeriod.findMany({ where: { equipmentId: id } });
    const current = currentPeriod(rows, targetId);
    if (current.voidedAt)
      throw new EnergyError(
        'CONFLICT',
        'A voided period cannot be corrected. Record a replacement if needed.',
      );
    const active = rows
      .filter((row) => !row.voidedAt)
      .map((row) => ({
        ...intervalValues(row),
        powerWatts: row.powerWatts.toFixed(2),
        hoursPerDay: row.hoursPerDay.toFixed(2),
      }));
    const before = active.find((row) => row.id === targetId)!;
    const proposed = {
      ...before,
      powerWatts: values.powerWatts ?? before.powerWatts,
      hoursPerDay: values.hoursPerDay ?? before.hoursPerDay,
      effectiveFrom: values.effectiveFrom ?? before.effectiveFrom,
      effectiveTo: values.effectiveTo === undefined ? before.effectiveTo : values.effectiveTo,
      notes: values.notes === undefined ? before.notes : values.notes,
      correctionReason: values.correctionReason,
    };
    const changes = planCorrection(active, before, proposed, values.adjacentAdjustments);
    let changed = false;
    for (const change of changes) {
      requirePowerCapability(equipment, change.effectiveTo);
      const old = active.find((row) => row.id === change.id)!;
      const correctionReason = values.correctionReason;
      if (
        samePower(
          rows.find((row) => row.id === change.id)!,
          change,
        ) &&
        old.effectiveFrom === change.effectiveFrom &&
        old.effectiveTo === change.effectiveTo &&
        old.correctionReason === correctionReason
      )
        continue;
      await tx.equipmentPowerPeriod.update({
        where: { id: change.id },
        data: {
          powerWatts: change.powerWatts,
          hoursPerDay: change.hoursPerDay,
          notes: change.notes,
          effectiveFrom: dateToSql(change.effectiveFrom),
          effectiveTo: change.effectiveTo ? dateToSql(change.effectiveTo) : null,
          correctionReason,
          updatedAt: nextEnergyTimestamp(old.updatedAt),
        },
      });
      changed = true;
    }
    return {
      period: await tx.equipmentPowerPeriod.findUniqueOrThrow({ where: { id: targetId } }),
      equipmentUpdatedAt: changed ? await advanceEquipment(tx, equipment) : equipment.updatedAt,
      changed,
    };
  });
}

export async function voidEquipmentPowerPeriod(
  equipmentId: string,
  periodId: string,
  input: VoidPowerInput,
): Promise<PowerMutationResult> {
  const id = parseEnergy(energyIdSchema, equipmentId);
  const targetId = parseEnergy(energyIdSchema, periodId);
  const values = parseEnergy(voidPowerSchema, input);
  return withEquipmentEnergy(id, values.expectedUpdatedAt, async (tx, equipment) => {
    const current = await tx.equipmentPowerPeriod.findFirst({
      where: { id: targetId, equipmentId: id },
    });
    if (!current)
      throw new EnergyError('NOT_FOUND', 'This power period does not belong to this Equipment.');
    if (current.voidedAt)
      return { period: current, equipmentUpdatedAt: equipment.updatedAt, changed: false };
    const period = await tx.equipmentPowerPeriod.update({
      where: { id: targetId },
      data: {
        voidedAt: new Date(),
        correctionReason: values.correctionReason,
        updatedAt: nextEnergyTimestamp(current.updatedAt),
      },
    });
    return { period, equipmentUpdatedAt: await advanceEquipment(tx, equipment), changed: true };
  });
}
