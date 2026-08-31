import { z } from 'zod';

// Shared scalar rules. Creation and editing apply their own omission/default semantics.
export const plantTextSchema = z
  .string()
  .trim()
  .refine((value) => !value.includes('\0'), {
    message: 'Text cannot contain a null character.',
  })
  .transform((value) => value || null);
export const plantIdSchema = z.string().trim().uuid().toLowerCase();
export {
  purchaseCostSchema as plantCostSchema,
  purchaseCurrencySchema as plantCurrencySchema,
  purchaseDateSchema as plantPurchaseDateSchema,
} from '../../lib/purchase-field-schemas';
