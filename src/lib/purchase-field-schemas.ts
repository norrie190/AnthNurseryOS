import { z } from 'zod';

// Scalar purchase rules shared by inventory domains, not their omission semantics.
export const purchaseCostSchema = z.number().int().min(0).max(2_147_483_647);
const currencies = new Set(Intl.supportedValuesOf('currency'));
export const purchaseCurrencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/)
  .refine(
    (value) => currencies.has(value),
    'Use a currency code recognised by the runtime, such as GBP or EUR.',
  );
export const purchaseDateSchema = z.iso.date().refine((value) => !value.startsWith('0000-'), {
  message: 'Use a calendar date with a year from 0001 to 9999.',
});
