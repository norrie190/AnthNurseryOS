import { z } from 'zod';
import type { CreatePlantInput } from './plant-input';
import { parseMoneyInput, currencyDecimalPlaces } from './plant-money';
import {
  initialPlantFormValues,
  type PlantFormField,
  type PlantFormState,
  type PlantFormValues,
} from './plant-form-state';

const parentMode = z.enum(['unknown', 'existing', 'external']);
const formFields = Object.keys(initialPlantFormValues) as PlantFormField[];

export function parsePlantFormData(
  formData: FormData,
): { success: true; input: CreatePlantInput } | { success: false; state: PlantFormState } {
  const values: PlantFormValues = { ...initialPlantFormValues };
  const fieldErrors: PlantFormState['fieldErrors'] = {};
  let message = '';
  for (const key of formData.keys()) {
    // Next supplies its own action metadata. None of it is passed to the service.
    if (!formFields.includes(key as PlantFormField) && !key.startsWith('$ACTION_')) {
      message = 'The form contained unsupported fields. Reload the page and try again.';
    }
  }
  for (const field of formFields) {
    const entries = formData.getAll(field);
    if (entries.length > 1 || entries.some((entry) => typeof entry !== 'string')) {
      fieldErrors[field] = 'Supply one text value for this field.';
    } else if (entries.length === 1) values[field] = entries[0] as string;
  }

  const parentage: NonNullable<CreatePlantInput['parentage']> = {};
  for (const role of ['seed', 'pollen'] as const) {
    const modeField = `${role}ParentMode` as const;
    const idField = `${role}ParentPlantId` as const;
    const nameField = `${role}ParentName` as const;
    const mode = parentMode.safeParse(values[modeField]);
    if (!mode.success) {
      fieldErrors[modeField] = 'Choose Unknown, Existing Plant or External name.';
    } else if (mode.data === 'existing') {
      if (!values[idField].trim()) fieldErrors[idField] = 'Choose an existing Plant.';
      parentage[idField] = values[idField];
    } else if (mode.data === 'external') {
      if (!values[nameField].trim())
        fieldErrors[nameField] = 'Enter an external parent name, or choose Unknown.';
      parentage[nameField] = values[nameField];
    }
    // Inactive mode values are intentionally not part of the service input.
  }

  let purchase: CreatePlantInput['purchase'];
  if (!['', 'on'].includes(values.recordPurchase))
    fieldErrors.recordPurchase = 'Choose whether to record purchase information.';
  if (values.recordPurchase === 'on') {
    const currency = values.currency.trim().toUpperCase();
    purchase = {
      seller: values.seller,
      orderReference: values.orderReference,
      purchaseDate: values.purchaseDate || null,
      currency,
    };
    try {
      currencyDecimalPlaces(currency);
    } catch {
      fieldErrors.currency = 'Enter a three letter currency code such as GBP.';
    }
    if (!fieldErrors.currency) {
      for (const [field, property] of [
        ['plantPrice', 'plantPriceMinor'],
        ['shippingCost', 'shippingCostMinor'],
        ['otherCost', 'otherCostMinor'],
      ] as const) {
        try {
          purchase[property] = parseMoneyInput(values[field], currency);
        } catch (error) {
          fieldErrors[field] = error instanceof Error ? error.message : 'Check this amount.';
        }
      }
    }
  }
  if (message || Object.keys(fieldErrors).length)
    return {
      success: false,
      state: { message: message || 'Check the highlighted fields.', fieldErrors },
    };
  return {
    success: true,
    input: {
      name: values.name,
      // The service's existing Zod schema validates the status, IDs and nursery rules.
      status: values.status as CreatePlantInput['status'],
      locationId: values.locationId || null,
      notes: values.notes,
      parentage,
      purchase,
    },
  };
}
