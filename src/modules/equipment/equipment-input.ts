import { z } from 'zod';
import {
  purchaseCostSchema,
  purchaseCurrencySchema,
  purchaseDateSchema,
} from '../../lib/purchase-field-schemas';
import { EquipmentError } from './equipment-errors';

export const suggestedEquipmentCategories = [
  'Grow Light',
  'Extraction Fan',
  'Circulation Fan',
  'Humidifier',
  'Controller',
  'Sensor / Meter',
  'Grow Tent',
  'Shelving / Rack',
  'Heating',
  'Cooling',
  'Watering',
  'Other',
] as const;

function text(max: number) {
  return z
    .string()
    .trim()
    .max(max)
    .refine((value) => !value.includes('\0'), 'Text cannot contain a null character.');
}
const optionalText = (max: number) =>
  text(max)
    .transform((value) => value || null)
    .nullable()
    .optional();
export const equipmentIdSchema = z.string().trim().uuid().toLowerCase();
const categorySchema = text(80)
  .transform((value) => value.replace(/\s+/g, ' '))
  .pipe(z.string().min(1))
  .transform(
    (value) =>
      suggestedEquipmentCategories.find(
        (category) =>
          category.toLowerCase().replace(/\s/g, '') === value.toLowerCase().replace(/\s/g, ''),
      ) ?? value,
  );

const fields = {
  name: text(200).min(1),
  category: categorySchema,
  brand: optionalText(200),
  model: optionalText(200),
  serialNumber: optionalText(200),
  notes: optionalText(10_000),
  usesPower: z.boolean(),
  locationId: equipmentIdSchema.nullable().optional(),
};
const purchaseSchema = z.strictObject({
  seller: optionalText(200),
  orderReference: optionalText(200),
  purchaseDate: purchaseDateSchema.nullable().optional(),
  equipmentPriceMinor: purchaseCostSchema.nullable().optional(),
  shippingCostMinor: purchaseCostSchema.nullable().optional(),
  otherCostMinor: purchaseCostSchema.nullable().optional(),
  currency: purchaseCurrencySchema.optional(),
});
export const createEquipmentSchema = z.strictObject({
  ...fields,
  category: categorySchema.default('Other'),
  purchase: purchaseSchema.optional(),
});
export const updateEquipmentSchema = z.strictObject({
  ...fields,
  name: fields.name.optional(),
  category: categorySchema.optional(),
  usesPower: fields.usesPower.optional(),
  purchase: purchaseSchema.optional(),
  expectedUpdatedAt: z.iso.datetime({ precision: 3 }),
});
export const equipmentArchiveSchema = z.strictObject({
  expectedUpdatedAt: z.iso.datetime({ precision: 3 }),
});
export type CreateEquipmentInput = z.input<typeof createEquipmentSchema>;
export type UpdateEquipmentInput = z.input<typeof updateEquipmentSchema>;
export type EquipmentArchiveInput = z.input<typeof equipmentArchiveSchema>;
export type EquipmentPurchasePatch = z.output<typeof purchaseSchema>;

export function parseCreateEquipmentInput(input: unknown) {
  const result = createEquipmentSchema.safeParse(input);
  if (!result.success) throw validationError(result.error);
  return result.data;
}
export function parseUpdateEquipmentInput(equipmentId: unknown, input: unknown) {
  const result = z
    .strictObject({ equipmentId: equipmentIdSchema, input: updateEquipmentSchema })
    .safeParse({ equipmentId, input });
  if (!result.success) throw validationError(result.error);
  return result.data;
}
export function parseEquipmentArchiveInput(equipmentId: unknown, input: unknown) {
  const result = z
    .strictObject({ equipmentId: equipmentIdSchema, input: equipmentArchiveSchema })
    .safeParse({ equipmentId, input });
  if (!result.success) throw validationError(result.error);
  return result.data;
}
function validationError(error: z.ZodError) {
  return new EquipmentError('VALIDATION_FAILED', 'Check the supplied Equipment details.', {
    cause: error,
    issues: error.issues.map((issue) => ({
      field: issue.path
        .filter((part, index) => !(index === 0 && part === 'input'))
        .map(String)
        .join('.'),
      message: issue.message,
    })),
  });
}
