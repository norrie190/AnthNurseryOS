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

const parentChoiceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('unknown') }),
  z.strictObject({ kind: z.literal('plant'), plantId: plantIdSchema }),
  z.strictObject({
    kind: z.literal('external'),
    name: plantTextSchema.refine(
      (name) => name !== null,
      'Enter an external parent name, or choose Unknown.',
    ),
  }),
]);

export const updatePlantSchema = z.strictObject({
  expectedUpdatedAt: z.iso.datetime({ precision: 3 }),
  name: plantTextSchema.nullable().optional(),
  status: z.enum(PlantStatus).optional(),
  locationId: plantIdSchema.nullable().optional(),
  notes: plantTextSchema.nullable().optional(),
  parentage: z
    .strictObject({
      seedParent: parentChoiceSchema.optional(),
      pollenParent: parentChoiceSchema.optional(),
    })
    .optional(),
  purchase: z
    .strictObject({
      seller: plantTextSchema.nullable().optional(),
      orderReference: plantTextSchema.nullable().optional(),
      purchaseDate: plantPurchaseDateSchema.nullable().optional(),
      plantPriceMinor: plantCostSchema.nullable().optional(),
      shippingCostMinor: plantCostSchema.nullable().optional(),
      otherCostMinor: plantCostSchema.nullable().optional(),
      currency: plantCurrencySchema.optional(),
    })
    .optional(),
});

export type UpdatePlantInput = z.input<typeof updatePlantSchema>;
export type ParsedUpdatePlantInput = z.output<typeof updatePlantSchema>;

export function parseUpdatePlantInput(plantId: unknown, input: unknown) {
  const result = z
    .strictObject({ plantId: plantIdSchema, input: updatePlantSchema })
    .safeParse({ plantId, input });
  if (result.success) return result.data;
  throw new PlantError('VALIDATION_FAILED', 'Check the supplied Plant details.', {
    cause: result.error,
    issues: result.error.issues.map((issue) => ({
      field: issue.path
        .filter((part, index) => !(index === 0 && part === 'input'))
        .map(String)
        .join('.'),
      message: issue.message,
    })),
  });
}
