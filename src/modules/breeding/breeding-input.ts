import { z } from 'zod';
import { calendarDateSchema } from '../../lib/calendar-date';
import { plantIdSchema, plantTextSchema } from '../plants/plant-field-schemas';
import { BreedingError } from './breeding-errors';

const optionalDate = calendarDateSchema.nullish().transform((value) => value ?? null);
const optionalText = plantTextSchema.nullish().transform((value) => value ?? null);
const token = z.iso.datetime({ precision: 3 });
const reason = plantTextSchema.refine(
  (value) => value !== null,
  'A correction reason is required.',
);
export const breedingIdSchema = plantIdSchema;

export const createInflorescenceSchema = z.strictObject({
  emergedOn: optionalDate,
  openedOn: optionalDate,
  notes: optionalText,
});

export const inflorescenceStatusSchema = z.enum(['OBSERVED', 'OPEN', 'FINISHED', 'ABORTED']);

const pollenSource = z.discriminatedUnion('mode', [
  z.strictObject({ mode: z.literal('INTERNAL'), pollenParentPlantId: plantIdSchema }),
  z.strictObject({
    mode: z.literal('EXTERNAL'),
    pollenParentName: plantTextSchema.refine(
      (value) => value !== null,
      'Enter an external pollen parent.',
    ),
    pollenBreeder: optionalText,
    pollenCultivar: optionalText,
  }),
  z.strictObject({ mode: z.literal('UNKNOWN') }),
]);

export const createPollinationAttemptSchema = z.strictObject({
  pollinatedOn: calendarDateSchema,
  pollenSource,
  notes: optionalText,
});

export const changeInflorescenceStatusSchema = z.strictObject({
  status: inflorescenceStatusSchema,
  expectedUpdatedAt: token,
});

export const correctInflorescenceSchema = z.strictObject({
  emergedOn: optionalDate.optional(),
  openedOn: optionalDate.optional(),
  notes: optionalText.optional(),
  status: inflorescenceStatusSchema.optional(),
  correctionReason: reason,
  expectedUpdatedAt: token,
});

export const voidInflorescenceSchema = z.strictObject({
  correctionReason: reason,
  expectedUpdatedAt: token,
});

export const changePollinationAttemptStatusSchema = z.strictObject({
  status: z.enum(['PENDING', 'DEVELOPING', 'FAILED']),
  expectedUpdatedAt: token,
});

export const correctPollinationAttemptSchema = z.strictObject({
  pollinatedOn: calendarDateSchema.optional(),
  pollenSource: pollenSource.optional(),
  notes: optionalText.optional(),
  status: z.enum(['PENDING', 'DEVELOPING', 'FAILED', 'HARVESTED']).optional(),
  correctionReason: reason,
  expectedUpdatedAt: token,
});

export const voidPollinationAttemptSchema = z.strictObject({
  correctionReason: reason,
  expectedUpdatedAt: token,
});

export type CreateInflorescenceInput = z.input<typeof createInflorescenceSchema>;
export type ParsedCreateInflorescenceInput = z.output<typeof createInflorescenceSchema>;
export type CreatePollinationAttemptInput = z.input<typeof createPollinationAttemptSchema>;
export type ParsedCreatePollinationAttemptInput = z.output<typeof createPollinationAttemptSchema>;
export type ChangeInflorescenceStatusInput = z.input<typeof changeInflorescenceStatusSchema>;
export type CorrectInflorescenceInput = z.input<typeof correctInflorescenceSchema>;
export type VoidInflorescenceInput = z.input<typeof voidInflorescenceSchema>;
export type ChangePollinationAttemptStatusInput = z.input<
  typeof changePollinationAttemptStatusSchema
>;
export type CorrectPollinationAttemptInput = z.input<typeof correctPollinationAttemptSchema>;
export type VoidPollinationAttemptInput = z.input<typeof voidPollinationAttemptSchema>;
export type PollenSource = z.output<typeof pollenSource>;

function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  throw new BreedingError('VALIDATION_FAILED', 'Check the supplied breeding information.', {
    cause: result.error,
    issues: result.error.issues.map((issue) => ({
      field: issue.path.map(String).join('.'),
      message: issue.message,
    })),
  });
}

export function parseCreateInflorescenceInput(input: unknown): ParsedCreateInflorescenceInput {
  return parse(createInflorescenceSchema, input);
}

export function parseBreedingId(input: unknown): string {
  return parse(breedingIdSchema, input);
}
export function parseCreatePollinationAttemptInput(
  input: unknown,
): ParsedCreatePollinationAttemptInput {
  return parse(createPollinationAttemptSchema, input);
}
export function parseBreedingInput<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  return parse(schema, input);
}

const seedCount = z.number().int().min(0).nullable().optional();
const germinatedCount = z.number().int().min(0).nullable().optional();
const seedBatchStatusSchema = z.enum([
  'HARVESTED',
  'AWAITING_GERMINATION',
  'GERMINATING',
  'EXHAUSTED',
  'FAILED',
]);

export const recordSeedBatchHarvestSchema = z.strictObject({
  harvestedOn: calendarDateSchema,
  seedCount,
  notes: optionalText,
  expectedPollinationUpdatedAt: token,
});
export const recordSeedBatchSowingSchema = z.strictObject({
  sownOn: calendarDateSchema,
  expectedUpdatedAt: token,
});
export const recordSeedBatchGerminationSchema = z.strictObject({
  germinatedCount: z.number().int().min(0),
  expectedUpdatedAt: token,
});
export const closeSeedBatchSchema = z.strictObject({
  status: z.enum(['EXHAUSTED', 'FAILED']),
  expectedUpdatedAt: token,
});
export const correctSeedBatchSchema = z.strictObject({
  harvestedOn: calendarDateSchema.optional(),
  sownOn: optionalDate.optional(),
  seedCount,
  germinatedCount,
  notes: optionalText.optional(),
  status: seedBatchStatusSchema.optional(),
  correctionReason: reason,
  expectedUpdatedAt: token,
});
export const voidSeedBatchSchema = z.strictObject({
  correctionReason: reason,
  expectedUpdatedAt: token,
});

export type RecordSeedBatchHarvestInput = z.input<typeof recordSeedBatchHarvestSchema>;
export type RecordSeedBatchSowingInput = z.input<typeof recordSeedBatchSowingSchema>;
export type RecordSeedBatchGerminationInput = z.input<typeof recordSeedBatchGerminationSchema>;
export type CloseSeedBatchInput = z.input<typeof closeSeedBatchSchema>;
export type CorrectSeedBatchInput = z.input<typeof correctSeedBatchSchema>;
export type VoidSeedBatchInput = z.input<typeof voidSeedBatchSchema>;
