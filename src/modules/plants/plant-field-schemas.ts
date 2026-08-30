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
export const plantCostSchema = z.number().int().min(0).max(2_147_483_647);
const currencies = new Set(Intl.supportedValuesOf('currency'));
export const plantCurrencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/)
  .refine(
    (value) => currencies.has(value),
    'Use a currency code recognised by the runtime, such as GBP or EUR.',
  );
export const plantPurchaseDateSchema = z.iso.date().refine((value) => !value.startsWith('0000-'), {
  message: 'Use a calendar date with a year from 0001 to 9999.',
});
