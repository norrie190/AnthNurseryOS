import { z } from 'zod';
import { calendarDateSchema } from '../../lib/calendar-date';
import { EnergyError } from './energy-errors';

export function decimalToScaled(value: string, places: number): bigint {
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole + fraction.padEnd(places, '0'));
}
export function formatScaled(value: bigint, places: number): string {
  const digits = value.toString().padStart(places + 1, '0');
  if (places === 0) return digits;
  return `${digits.slice(0, -places)}.${digits.slice(-places)}`;
}
function decimal(places: number, maximum: bigint) {
  return z
    .string()
    .trim()
    .max(32)
    .regex(
      new RegExp(`^\\d+(?:\\.\\d{1,${places}})?$`),
      `Use a decimal with at most ${places} decimal places.`,
    )
    .superRefine((value, context) => {
      if (!new RegExp(`^\\d+(?:\\.\\d{1,${places}})?$`).test(value) || value.length > 32) return;
      if (decimalToScaled(value, places) > maximum * 10n ** BigInt(places))
        context.addIssue({ code: 'custom', message: `Must be between zero and ${maximum}.` });
    })
    .transform((value) => formatScaled(decimalToScaled(value, places), places));
}
export const powerWattsSchema = decimal(2, 100000n);
export const hoursPerDaySchema = decimal(2, 24n);
export const tariffRateSchema = decimal(5, 1000n);
export const energyIdSchema = z.string().uuid().toLowerCase();
const text = z
  .string()
  .trim()
  .max(10000)
  .refine((value) => !value.includes('\0'), 'Text cannot contain a null character.');
const notes = text
  .transform((value) => value || null)
  .nullable()
  .optional();
const reason = text.min(1, 'Explain why this record is being corrected or voided.');
const interval = {
  effectiveFrom: calendarDateSchema,
  effectiveTo: calendarDateSchema.nullable().optional(),
};
const power = { powerWatts: powerWattsSchema, hoursPerDay: hoursPerDaySchema };
const tariff = { unitRateMinorPerKwh: tariffRateSchema, currency: z.literal('GBP').optional() };
const equipmentToken = { expectedUpdatedAt: z.iso.datetime({ precision: 3 }) };
const tariffToken = { expectedTimelineToken: z.string().regex(/^[a-f0-9]{64}$/) };
// Only reviewed shared boundaries may be changed alongside a correction. No arbitrary nested data.
const adjacentAdjustments = z
  .array(
    z.strictObject({
      periodId: energyIdSchema,
      effectiveFrom: calendarDateSchema.optional(),
      effectiveTo: calendarDateSchema.optional(),
    }),
  )
  .max(2)
  .optional();

export const recordPowerSchema = z.strictObject({
  ...power,
  ...interval,
  notes,
  ...equipmentToken,
});
export const changePowerSchema = z.strictObject({
  ...power,
  effectiveFrom: calendarDateSchema,
  notes,
  ...equipmentToken,
});
export const correctPowerSchema = z.strictObject({
  powerWatts: powerWattsSchema.optional(),
  hoursPerDay: hoursPerDaySchema.optional(),
  effectiveFrom: calendarDateSchema.optional(),
  effectiveTo: calendarDateSchema.nullable().optional(),
  notes,
  correctionReason: reason,
  adjacentAdjustments,
  ...equipmentToken,
});
export const voidPowerSchema = z.strictObject({ correctionReason: reason, ...equipmentToken });
export const recordTariffSchema = z.strictObject({ ...tariff, ...interval, notes, ...tariffToken });
export const changeTariffSchema = z.strictObject({
  ...tariff,
  effectiveFrom: calendarDateSchema,
  notes,
  ...tariffToken,
});
export const correctTariffSchema = z.strictObject({
  unitRateMinorPerKwh: tariffRateSchema.optional(),
  currency: z.literal('GBP').optional(),
  effectiveFrom: calendarDateSchema.optional(),
  effectiveTo: calendarDateSchema.nullable().optional(),
  notes,
  correctionReason: reason,
  adjacentAdjustments,
  ...tariffToken,
});
export const voidTariffSchema = z.strictObject({ correctionReason: reason, ...tariffToken });
export const reportRangeSchema = z
  .strictObject({ from: calendarDateSchema, to: calendarDateSchema })
  .refine((value) => value.to > value.from, 'The report end must be after its start.');
export type ReportRange = z.infer<typeof reportRangeSchema>;
export type RecordPowerInput = z.input<typeof recordPowerSchema>;
export type ChangePowerInput = z.input<typeof changePowerSchema>;
export type CorrectPowerInput = z.input<typeof correctPowerSchema>;
export type VoidPowerInput = z.input<typeof voidPowerSchema>;
export type RecordTariffInput = z.input<typeof recordTariffSchema>;
export type ChangeTariffInput = z.input<typeof changeTariffSchema>;
export type CorrectTariffInput = z.input<typeof correctTariffSchema>;
export type VoidTariffInput = z.input<typeof voidTariffSchema>;

export function parseEnergy<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success)
    throw new EnergyError('VALIDATION_FAILED', 'Check the energy information and try again.', {
      cause: result.error,
      issues: result.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      })),
    });
  return result.data;
}
