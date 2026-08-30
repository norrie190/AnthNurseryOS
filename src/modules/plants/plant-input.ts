import { z } from 'zod';
import { PlantStatus } from '../../generated/prisma/enums';
import { PlantError } from './plant-errors';

const optionalText = z
  .string()
  .trim()
  .refine((value) => !value.includes('\0'), {
    message: 'Text cannot contain a null character.',
  })
  .nullish()
  .transform((value) => value || null);
const optionalId = z
  .string()
  .trim()
  .uuid()
  .toLowerCase()
  .nullish()
  .transform((value) => value ?? null);
const optionalCost = z
  .number()
  .int()
  .min(0)
  .max(2_147_483_647)
  .nullish()
  .transform((value) => value ?? null);
const currencies = new Set(Intl.supportedValuesOf('currency'));
const currency = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/)
  .refine(
    (value) => currencies.has(value),
    'Use a currency code recognised by the runtime, such as GBP or EUR.',
  )
  .default('GBP');
const purchaseDate = z.iso
  .date()
  .refine((value) => !value.startsWith('0000-'), {
    message: 'Use a calendar date with a year from 0001 to 9999.',
  })
  .nullish()
  .transform((value) => value ?? null);

const parentageSchema = z
  .strictObject({
    seedParentPlantId: optionalId,
    seedParentName: optionalText,
    pollenParentPlantId: optionalId,
    pollenParentName: optionalText,
  })
  .superRefine((parentage, context) => {
    for (const role of ['seed', 'pollen'] as const) {
      if (parentage[`${role}ParentPlantId`] && parentage[`${role}ParentName`]) {
        context.addIssue({
          code: 'custom',
          path: [`${role}ParentName`],
          message: 'Use either a linked Plant or an external parent name, not both.',
          params: { parentConflict: true },
        });
      }
    }
  });

const purchaseSchema = z.strictObject({
  seller: optionalText,
  orderReference: optionalText,
  purchaseDate,
  plantPriceMinor: optionalCost,
  shippingCostMinor: optionalCost,
  otherCostMinor: optionalCost,
  currency,
});

export const createPlantSchema = z.strictObject({
  name: optionalText,
  status: z.enum(PlantStatus).default('GROWING'),
  locationId: optionalId,
  notes: optionalText,
  parentage: parentageSchema
    .nullish()
    .transform((value) =>
      value && Object.values(value).some((field) => field !== null) ? value : null,
    ),
  // An explicit empty purchase means purchased, with details still unknown.
  purchase: purchaseSchema.nullish().transform((value) => value ?? null),
});

export type CreatePlantInput = z.input<typeof createPlantSchema>;
export type ParsedCreatePlantInput = z.output<typeof createPlantSchema>;

export function parseCreatePlantInput(input: unknown): ParsedCreatePlantInput {
  const result = createPlantSchema.safeParse(input);
  if (result.success) return result.data;

  const parentConflict = result.error.issues.some(
    (issue) => issue.code === 'custom' && issue.params?.parentConflict === true,
  );
  throw new PlantError(
    parentConflict ? 'INVALID_PARENT' : 'VALIDATION_FAILED',
    'Check the supplied Plant details.',
    {
      cause: result.error,
      issues: result.error.issues.map((issue) => ({
        field: issue.path.map(String).join('.'),
        message: issue.message,
      })),
    },
  );
}
