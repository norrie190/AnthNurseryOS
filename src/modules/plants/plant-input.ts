import { z } from 'zod';
import { PlantStatus } from '../../generated/prisma/enums';
import { PlantError } from './plant-errors';
import {
  plantTextSchema,
  plantIdSchema,
  plantCostSchema,
  plantCurrencySchema,
  plantPurchaseDateSchema,
} from './plant-field-schemas';

const optionalText = plantTextSchema.nullish().transform((value) => value ?? null);
const optionalId = plantIdSchema.nullish().transform((value) => value ?? null);
const optionalCost = plantCostSchema.nullish().transform((value) => value ?? null);
const currency = plantCurrencySchema.default('GBP');
const purchaseDate = plantPurchaseDateSchema.nullish().transform((value) => value ?? null);

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
