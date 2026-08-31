'use server';

import { redirect } from 'next/navigation';
import { createEquipment, updateEquipment } from './equipment-service';
import { EquipmentError } from './equipment-errors';
import { parseEquipmentCreateForm, parseEquipmentEditForm } from './equipment-form-data';
import {
  equipmentFieldLabels,
  type EquipmentFormField,
  type EquipmentFormState,
} from './equipment-form-state';

function safeError(error: unknown): EquipmentFormState {
  if (error instanceof EquipmentError && error.code !== 'CONFLICT') {
    const fieldErrors: EquipmentFormState['fieldErrors'] = {};
    const purchaseFields: Record<string, EquipmentFormField> = {
      equipmentPriceMinor: 'equipmentPrice',
      shippingCostMinor: 'shippingCost',
      otherCostMinor: 'otherCost',
    };
    for (const issue of error.issues) {
      const property = issue.field.replace(/^purchase\./, '');
      const field = purchaseFields[property] ?? property;
      if (Object.hasOwn(equipmentFieldLabels, field))
        fieldErrors[field as EquipmentFormField] = issue.message;
    }
    return {
      message: error.message,
      fieldErrors,
      ...(error.code === 'STALE_UPDATE' ? { stale: true } : {}),
    };
  }
  console.error('Equipment save failed', error);
  return {
    message:
      'We could not confirm that your Equipment was saved. Your entries have been kept. Check the Equipment list or details before trying again.',
    fieldErrors: {},
  };
}
export async function createEquipmentAction(
  _previous: EquipmentFormState,
  formData: FormData,
): Promise<EquipmentFormState> {
  const parsed = parseEquipmentCreateForm(formData);
  if (!parsed.success) return parsed.state;
  let id: string;
  try {
    id = (await createEquipment(parsed.input)).id;
  } catch (error) {
    return safeError(error);
  }
  redirect(`/equipment/${id}`);
}
export async function updateEquipmentAction(
  equipmentId: string,
  expectedUpdatedAt: string,
  _previous: EquipmentFormState,
  formData: FormData,
): Promise<EquipmentFormState> {
  const parsed = parseEquipmentEditForm(formData, expectedUpdatedAt);
  if (!parsed.success) return parsed.state;
  let id: string;
  try {
    id = (await updateEquipment(equipmentId, parsed.input)).id;
  } catch (error) {
    return safeError(error);
  }
  redirect(`/equipment/${id}`);
}
