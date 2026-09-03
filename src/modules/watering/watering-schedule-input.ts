import { z } from 'zod';
import { calendarDateSchema } from '../../lib/calendar-date';
import { WateringError } from './watering-errors';
import {
  wateringCorrectionReasonSchema,
  wateringExpectedUpdatedAtSchema,
  wateringIdSchema,
  wateringNotesSchema,
} from './watering-input';

export const wateringIntervalDaysSchema = z.number().int().min(1).max(365);

const adjacentAdjustmentSchema = z.strictObject({
  periodId: wateringIdSchema,
  effectiveFrom: calendarDateSchema.optional(),
  effectiveTo: calendarDateSchema.optional(),
});

export const changeWateringScheduleSchema = z.strictObject({
  intervalDays: wateringIntervalDaysSchema,
  effectiveFrom: calendarDateSchema,
  notes: wateringNotesSchema,
});

export const correctWateringSchedulePeriodSchema = z
  .strictObject({
    intervalDays: wateringIntervalDaysSchema.optional(),
    effectiveFrom: calendarDateSchema.optional(),
    effectiveTo: calendarDateSchema.nullable().optional(),
    notes: wateringNotesSchema,
    correctionReason: wateringCorrectionReasonSchema,
    adjacentAdjustments: z.array(adjacentAdjustmentSchema).max(2).optional(),
    expectedUpdatedAt: wateringExpectedUpdatedAtSchema,
  })
  .refine(
    (input) =>
      input.intervalDays !== undefined ||
      input.effectiveFrom !== undefined ||
      input.effectiveTo !== undefined ||
      input.notes !== undefined,
    { message: 'Supply an interval, boundary or notes to correct.' },
  );

export const voidWateringSchedulePeriodSchema = z.strictObject({
  correctionReason: wateringCorrectionReasonSchema,
  expectedUpdatedAt: wateringExpectedUpdatedAtSchema,
});

export type ChangeWateringScheduleInput = z.input<typeof changeWateringScheduleSchema>;
export type CorrectWateringSchedulePeriodInput = z.input<
  typeof correctWateringSchedulePeriodSchema
>;
export type VoidWateringSchedulePeriodInput = z.input<typeof voidWateringSchedulePeriodSchema>;

function parse<T>(schema: z.ZodType<T>, value: unknown, message: string): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw new WateringError('VALIDATION_FAILED', message, {
    cause: result.error,
    issues: result.error.issues.map((issue) => ({
      field: issue.path.map(String).join('.'),
      message: issue.message,
    })),
  });
}

const targetSchema = z.strictObject({ plantId: wateringIdSchema, periodId: wateringIdSchema });

export function parseChangeWateringScheduleInput(plantId: unknown, input: unknown) {
  return parse(
    z.strictObject({ plantId: wateringIdSchema, input: changeWateringScheduleSchema }),
    { plantId, input },
    'Check the supplied watering schedule.',
  );
}

export function parseCorrectWateringSchedulePeriodInput(
  plantId: unknown,
  periodId: unknown,
  input: unknown,
) {
  return parse(
    targetSchema.extend({ input: correctWateringSchedulePeriodSchema }),
    { plantId, periodId, input },
    'Check the supplied watering schedule correction.',
  );
}

export function parseVoidWateringSchedulePeriodInput(
  plantId: unknown,
  periodId: unknown,
  input: unknown,
) {
  return parse(
    targetSchema.extend({ input: voidWateringSchedulePeriodSchema }),
    { plantId, periodId, input },
    'Check the supplied watering schedule void request.',
  );
}

export function parseWateringScheduleDate(value: unknown): string {
  return parse(calendarDateSchema, value, 'The nursery date is invalid.');
}
