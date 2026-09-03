import { z } from 'zod';
import { WateringError } from './watering-errors';

export const wateringIdSchema = z.string().trim().uuid().toLowerCase();

const timestampSchema = z.iso.datetime({ precision: 3 }).transform((value) => new Date(value));
export const wateringTextSchema = z
  .string()
  .trim()
  .max(10000)
  .refine((value) => !value.includes('\0'), 'Text cannot contain a null character.');
export const wateringNotesSchema = wateringTextSchema
  .transform((value) => value || null)
  .nullable()
  .optional();
export const wateringCorrectionReasonSchema = wateringTextSchema.min(
  1,
  'Explain why this watering record is being corrected or voided.',
);
export const wateringExpectedUpdatedAtSchema = z.iso.datetime({ precision: 3 });

export const recordWateringEventSchema = z.strictObject({
  wateredAt: timestampSchema,
  notes: wateringNotesSchema,
});

export const recordWateringBatchSchema = z.strictObject({
  plantIds: z
    .array(wateringIdSchema)
    .min(1, 'Select at least one Plant.')
    .max(100, 'Select no more than 100 Plants at once.')
    .superRefine((ids, context) => {
      if (new Set(ids).size !== ids.length) {
        context.addIssue({ code: 'custom', message: 'Each Plant may only be selected once.' });
      }
    }),
  notes: wateringNotesSchema,
});

export const correctWateringEventSchema = z
  .strictObject({
    wateredAt: timestampSchema.optional(),
    notes: wateringNotesSchema,
    correctionReason: wateringCorrectionReasonSchema,
    expectedUpdatedAt: wateringExpectedUpdatedAtSchema,
  })
  .refine((input) => input.wateredAt !== undefined || input.notes !== undefined, {
    message: 'Supply a watering time or notes to correct.',
  });

export const voidWateringEventSchema = z.strictObject({
  correctionReason: wateringCorrectionReasonSchema,
  expectedUpdatedAt: wateringExpectedUpdatedAtSchema,
});

export type RecordWateringEventInput = z.input<typeof recordWateringEventSchema>;
export type RecordWateringBatchInput = z.input<typeof recordWateringBatchSchema>;
export type CorrectWateringEventInput = z.input<typeof correctWateringEventSchema>;
export type VoidWateringEventInput = z.input<typeof voidWateringEventSchema>;
export type ParsedRecordWateringEventInput = z.output<typeof recordWateringEventSchema>;
export type ParsedRecordWateringBatchInput = z.output<typeof recordWateringBatchSchema>;
export type ParsedCorrectWateringEventInput = z.output<typeof correctWateringEventSchema>;
export type ParsedVoidWateringEventInput = z.output<typeof voidWateringEventSchema>;

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

const recordRequestSchema = z.strictObject({
  plantId: wateringIdSchema,
  input: recordWateringEventSchema,
});
const eventRequestSchema = z.strictObject({
  plantId: wateringIdSchema,
  eventId: wateringIdSchema,
});

export function parseRecordWateringEventInput(plantId: unknown, input: unknown) {
  return parse(recordRequestSchema, { plantId, input }, 'Check the supplied watering information.');
}

export function parseRecordWateringBatchInput(input: unknown) {
  return {
    input: parse(recordWateringBatchSchema, input, 'Check the selected Plants and watering notes.'),
  };
}

export function parseCorrectWateringEventInput(plantId: unknown, eventId: unknown, input: unknown) {
  return parse(
    eventRequestSchema.extend({ input: correctWateringEventSchema }),
    { plantId, eventId, input },
    'Check the supplied watering correction.',
  );
}

export function parseVoidWateringEventInput(plantId: unknown, eventId: unknown, input: unknown) {
  return parse(
    eventRequestSchema.extend({ input: voidWateringEventSchema }),
    { plantId, eventId, input },
    'Check the supplied watering void request.',
  );
}

export function parseWateringPlantId(plantId: unknown): string {
  return parse(wateringIdSchema, plantId, 'The Plant identifier is invalid.');
}
