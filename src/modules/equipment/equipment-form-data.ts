import { currencyDecimalPlaces, parseMoneyInput } from '../../lib/purchase-money';
import type { CreateEquipmentInput, UpdateEquipmentInput } from './equipment-input';
import {
  equipmentFieldLabels,
  type EquipmentFormField,
  type EquipmentFormState,
} from './equipment-form-state';

type ParsedForm =
  | { success: true; input: Omit<UpdateEquipmentInput, 'expectedUpdatedAt'> }
  | { success: false; state: EquipmentFormState };

// Interpret only the browser transport here. Equipment rules stay in the service.
function parseEquipmentForm(formData: FormData, creating: boolean): ParsedForm {
  const state: EquipmentFormState = { message: '', fieldErrors: {} };
  if (!(formData instanceof FormData))
    return {
      success: false,
      state: { message: 'The Equipment form was invalid.', fieldErrors: {} },
    };
  const values: Partial<Record<EquipmentFormField, string>> = {};
  for (const key of formData.keys()) {
    if (!Object.hasOwn(equipmentFieldLabels, key) && !key.startsWith('$ACTION_'))
      state.message = 'The form contained unsupported fields. Reload the page and try again.';
  }
  for (const field of Object.keys(equipmentFieldLabels) as EquipmentFormField[]) {
    const entries = formData.getAll(field);
    if (entries.length > 1 || entries.some((entry) => typeof entry !== 'string'))
      state.fieldErrors[field] = 'Supply one text value for this field.';
    else if (entries.length === 1) values[field] = entries[0] as string;
  }
  const input: Omit<UpdateEquipmentInput, 'expectedUpdatedAt'> = {};
  for (const field of ['name', 'category', 'brand', 'model', 'serialNumber', 'notes'] as const) {
    if (values[field] !== undefined) input[field] = values[field];
  }
  if (values.locationId !== undefined) input.locationId = values.locationId || null;
  if (creating && values.name === undefined) state.fieldErrors.name = 'Enter a name.';
  if (creating || values.usesPower !== undefined) {
    if (values.usesPower !== 'true' && values.usesPower !== 'false')
      state.fieldErrors.usesPower = 'Choose Yes or No.';
    else input.usesPower = values.usesPower === 'true';
  }
  if (values.recordPurchase !== undefined && !['', 'on'].includes(values.recordPurchase))
    state.fieldErrors.recordPurchase = 'Choose whether to record purchase information.';
  if (values.recordPurchase === 'on') {
    const purchase: NonNullable<UpdateEquipmentInput['purchase']> = {};
    for (const field of ['seller', 'orderReference'] as const) {
      if (values[field] !== undefined) purchase[field] = values[field];
    }
    if (values.purchaseDate !== undefined) purchase.purchaseDate = values.purchaseDate || null;
    if (values.currency !== undefined) purchase.currency = values.currency.trim().toUpperCase();
    for (const [field, target] of [
      ['equipmentPrice', 'equipmentPriceMinor'],
      ['shippingCost', 'shippingCostMinor'],
      ['otherCost', 'otherCostMinor'],
    ] as const) {
      if (values[field] === undefined) continue;
      if (!values[field].trim()) {
        purchase[target] = null;
        continue;
      }
      if (!purchase.currency) {
        state.fieldErrors.currency = 'Choose a currency for these amounts.';
        continue;
      }
      try {
        currencyDecimalPlaces(purchase.currency);
      } catch {
        state.fieldErrors.currency = 'Choose a three letter currency code, such as GBP.';
        continue;
      }
      try {
        purchase[target] = parseMoneyInput(values[field], purchase.currency);
      } catch (error) {
        state.fieldErrors[field] = error instanceof Error ? error.message : 'Check this amount.';
      }
    }
    input.purchase = purchase;
  }
  if (state.message || Object.keys(state.fieldErrors).length) {
    state.message ||= 'Check the highlighted fields.';
    return { success: false, state };
  }
  return { success: true, input };
}
export function parseEquipmentCreateForm(
  formData: FormData,
): { success: true; input: CreateEquipmentInput } | { success: false; state: EquipmentFormState } {
  const parsed = parseEquipmentForm(formData, true);
  if (!parsed.success) return parsed;
  // Required transport fields were checked above; domain rules remain in createEquipment.
  return {
    success: true,
    input: { ...parsed.input, name: parsed.input.name!, usesPower: parsed.input.usesPower! },
  };
}
export function parseEquipmentEditForm(
  formData: FormData,
  expectedUpdatedAt: string,
): { success: true; input: UpdateEquipmentInput } | { success: false; state: EquipmentFormState } {
  const parsed = parseEquipmentForm(formData, false);
  return parsed.success ? { success: true, input: { ...parsed.input, expectedUpdatedAt } } : parsed;
}
