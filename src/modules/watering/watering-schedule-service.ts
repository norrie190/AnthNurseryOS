import 'server-only';
import { Prisma, type Plant, type WateringSchedulePeriod } from '../../generated/prisma/client';
import { dateToSql, sqlToDate } from '../../lib/calendar-date';
import { getPrisma } from '../../lib/prisma';
import { WateringError } from './watering-errors';
import { nextWateringTimestamp, throwWateringDatabaseError } from './watering-persistence';
import {
  parseChangeWateringScheduleInput,
  parseCorrectWateringSchedulePeriodInput,
  parseVoidWateringSchedulePeriodInput,
  type ChangeWateringScheduleInput,
  type CorrectWateringSchedulePeriodInput,
  type VoidWateringSchedulePeriodInput,
} from './watering-schedule-input';
import {
  planWateringScheduleChange,
  planWateringScheduleCorrection,
} from './watering-schedule-periods';

export type {
  ChangeWateringScheduleInput,
  CorrectWateringSchedulePeriodInput,
  VoidWateringSchedulePeriodInput,
} from './watering-schedule-input';

type LockedPlant = Plant & { databaseNow: Date };

function intervalValues(period: WateringSchedulePeriod) {
  return {
    ...period,
    effectiveFrom: sqlToDate(period.effectiveFrom),
    effectiveTo: period.effectiveTo ? sqlToDate(period.effectiveTo) : null,
  };
}

async function lockPlant(tx: Prisma.TransactionClient, plantId: string) {
  const [plant] = await tx.$queryRaw<LockedPlant[]>`
    SELECT *, clock_timestamp() AS "databaseNow"
    FROM public."Plant"
    WHERE "id" = ${plantId}::uuid
    FOR NO KEY UPDATE
  `;
  if (!plant) throw new WateringError('PLANT_NOT_FOUND', 'This Plant could not be found.');
  return plant;
}

function requireNormalScheduleEligibility(plant: Plant) {
  if (plant.archivedAt !== null || (plant.status !== 'GROWING' && plant.status !== 'QUARANTINE')) {
    throw new WateringError(
      'PLANT_NOT_ELIGIBLE',
      'Watering schedules can only be changed normally for active Growing or Quarantine Plants.',
    );
  }
}

function requireOwnedPeriod(rows: WateringSchedulePeriod[], periodId: string) {
  const period = rows.find((row) => row.id === periodId);
  if (!period) {
    throw new WateringError(
      'SCHEDULE_NOT_FOUND',
      'This watering schedule period could not be found for the selected Plant.',
    );
  }
  return period;
}

export async function changeWateringSchedule(
  plantId: string,
  input: ChangeWateringScheduleInput,
): Promise<WateringSchedulePeriod> {
  const parsed = parseChangeWateringScheduleInput(plantId, input);
  try {
    return await getPrisma().$transaction(
      async (tx) => {
        const plant = await lockPlant(tx, parsed.plantId);
        requireNormalScheduleEligibility(plant);
        const rows = await tx.wateringSchedulePeriod.findMany({
          where: { plantId: plant.id, voidedAt: null },
        });
        const periods = rows.map(intervalValues);
        const plan = planWateringScheduleChange(periods, parsed.input.effectiveFrom);
        if (plan.previous) {
          const previous = rows.find((row) => row.id === plan.previous!.id)!;
          await tx.wateringSchedulePeriod.update({
            where: { id: previous.id },
            data: {
              effectiveTo: dateToSql(parsed.input.effectiveFrom),
              updatedAt: nextWateringTimestamp(previous.updatedAt, plant.databaseNow),
            },
          });
        }
        return tx.wateringSchedulePeriod.create({
          data: {
            plantId: plant.id,
            intervalDays: parsed.input.intervalDays,
            effectiveFrom: dateToSql(parsed.input.effectiveFrom),
            effectiveTo: plan.effectiveTo ? dateToSql(plan.effectiveTo) : null,
            notes: parsed.input.notes ?? null,
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  } catch (error) {
    throwWateringDatabaseError(error);
  }
}

export async function correctWateringSchedulePeriod(
  plantId: string,
  periodId: string,
  input: CorrectWateringSchedulePeriodInput,
): Promise<WateringSchedulePeriod> {
  const parsed = parseCorrectWateringSchedulePeriodInput(plantId, periodId, input);
  try {
    return await getPrisma().$transaction(
      async (tx) => {
        const plant = await lockPlant(tx, parsed.plantId);
        const rows = await tx.wateringSchedulePeriod.findMany({ where: { plantId: plant.id } });
        const current = requireOwnedPeriod(rows, parsed.periodId);
        if (current.updatedAt.toISOString() !== parsed.input.expectedUpdatedAt) {
          throw new WateringError(
            'STALE_UPDATE',
            'This watering schedule period has changed. Review the latest history before trying again.',
          );
        }
        if (current.voidedAt) {
          throw new WateringError(
            'ALREADY_VOIDED',
            'A voided schedule period cannot be corrected.',
          );
        }
        const active = rows.filter((row) => !row.voidedAt).map(intervalValues);
        const before = active.find((row) => row.id === current.id)!;
        const proposed = {
          ...before,
          intervalDays: parsed.input.intervalDays ?? before.intervalDays,
          effectiveFrom: parsed.input.effectiveFrom ?? before.effectiveFrom,
          effectiveTo:
            parsed.input.effectiveTo === undefined ? before.effectiveTo : parsed.input.effectiveTo,
          notes: parsed.input.notes === undefined ? before.notes : parsed.input.notes,
          correctionReason: parsed.input.correctionReason,
        };
        const changes = planWateringScheduleCorrection(
          active,
          before,
          proposed,
          parsed.input.adjacentAdjustments,
        );
        for (const change of changes) {
          const old = rows.find((row) => row.id === change.id)!;
          await tx.wateringSchedulePeriod.update({
            where: { id: change.id },
            data: {
              intervalDays: change.intervalDays,
              effectiveFrom: dateToSql(change.effectiveFrom),
              effectiveTo: change.effectiveTo ? dateToSql(change.effectiveTo) : null,
              notes: change.notes,
              correctionReason: parsed.input.correctionReason,
              updatedAt: nextWateringTimestamp(old.updatedAt, plant.databaseNow),
            },
          });
        }
        return tx.wateringSchedulePeriod.findUniqueOrThrow({ where: { id: current.id } });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  } catch (error) {
    throwWateringDatabaseError(error);
  }
}

export async function voidWateringSchedulePeriod(
  plantId: string,
  periodId: string,
  input: VoidWateringSchedulePeriodInput,
): Promise<WateringSchedulePeriod> {
  const parsed = parseVoidWateringSchedulePeriodInput(plantId, periodId, input);
  try {
    return await getPrisma().$transaction(
      async (tx) => {
        const plant = await lockPlant(tx, parsed.plantId);
        const current = await tx.wateringSchedulePeriod.findFirst({
          where: { id: parsed.periodId, plantId: plant.id },
        });
        if (!current) {
          throw new WateringError(
            'SCHEDULE_NOT_FOUND',
            'This watering schedule period could not be found for the selected Plant.',
          );
        }
        if (current.updatedAt.toISOString() !== parsed.input.expectedUpdatedAt) {
          throw new WateringError(
            'STALE_UPDATE',
            'This watering schedule period has changed. Review the latest history before trying again.',
          );
        }
        if (current.voidedAt) {
          throw new WateringError(
            'ALREADY_VOIDED',
            'This watering schedule period is already voided.',
          );
        }
        return tx.wateringSchedulePeriod.update({
          where: { id: current.id },
          data: {
            voidedAt: plant.databaseNow,
            correctionReason: parsed.input.correctionReason,
            updatedAt: nextWateringTimestamp(current.updatedAt, plant.databaseNow),
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  } catch (error) {
    throwWateringDatabaseError(error);
  }
}
