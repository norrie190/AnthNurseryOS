'use server';

import { redirect } from 'next/navigation';
import { createPlant } from './plant-service';
import { updatePlant } from './plant-update-service';
import { PlantError } from './plant-errors';
import { parsePlantFormData, parsePlantEditFormData } from './plant-form-data';
import type { PlantFormField, PlantFormState } from './plant-form-state';

const serviceFields: Record<string, PlantFormField> = {
  name: 'name',
  status: 'status',
  locationId: 'locationId',
  notes: 'notes',
  'parentage.seedParentPlantId': 'seedParentPlantId',
  'parentage.seedParentName': 'seedParentName',
  'parentage.pollenParentPlantId': 'pollenParentPlantId',
  'parentage.pollenParentName': 'pollenParentName',
  'parentage.seedParent.plantId': 'seedParentPlantId',
  'parentage.seedParent.name': 'seedParentName',
  'parentage.seedParent.kind': 'seedParentMode',
  'parentage.pollenParent.plantId': 'pollenParentPlantId',
  'parentage.pollenParent.name': 'pollenParentName',
  'parentage.pollenParent.kind': 'pollenParentMode',
  'purchase.seller': 'seller',
  'purchase.orderReference': 'orderReference',
  'purchase.purchaseDate': 'purchaseDate',
  'purchase.plantPriceMinor': 'plantPrice',
  'purchase.shippingCostMinor': 'shippingCost',
  'purchase.otherCostMinor': 'otherCost',
  'purchase.currency': 'currency',
};

export async function createPlantAction(
  _previous: PlantFormState,
  formData: FormData,
): Promise<PlantFormState> {
  const intents = formData.getAll('submitIntent');
  // Pressing Enter may submit without a button value, so the safe default is the
  // established create-and-view behaviour.
  const intent = intents.length === 0 ? 'view' : intents[0];
  if (
    intents.length > 1 ||
    typeof intent !== 'string' ||
    !['view', 'addAnother'].includes(intent)
  ) {
    return {
      message: 'Choose how you would like to continue after saving.',
      fieldErrors: {},
    };
  }
  formData.delete('submitIntent');
  const parsed = parsePlantFormData(formData);
  if (!parsed.success) return parsed.state;

  let plant: Awaited<ReturnType<typeof createPlant>>;
  try {
    plant = await createPlant(parsed.input);
  } catch (error) {
    if (error instanceof PlantError) {
      const fieldErrors: PlantFormState['fieldErrors'] = {};
      for (const issue of error.issues) {
        const field = serviceFields[issue.field];
        if (field) fieldErrors[field] = issue.message;
      }
      if (error.code === 'CONFLICT') {
        console.error('Plant creation database conflict', error);
        return {
          message:
            'The Plant could not be saved because of conflicting data. Your entries have been kept.',
          fieldErrors: {},
        };
      }
      return { message: error.message, fieldErrors };
    }
    console.error('Unexpected Plant creation failure', error);
    return {
      message:
        'We could not confirm that your Plant was saved. Your entries have been kept. Check before submitting again.',
      fieldErrors: {},
    };
  }
  if (intent === 'addAnother') {
    return {
      message: `${plant.reference} was added. You can enter the next Plant now.`,
      fieldErrors: {},
      createdPlant: { id: plant.id, reference: plant.reference, name: plant.name },
    };
  }
  // Redirect throws a framework signal, so it must stay outside the error handler.
  redirect(`/plants/${plant.id}`);
}

export async function updatePlantAction(
  plantId: string,
  expectedUpdatedAt: string,
  _previous: PlantFormState,
  formData: FormData,
): Promise<PlantFormState> {
  const parsed = parsePlantEditFormData(formData, expectedUpdatedAt);
  if (!parsed.success) return parsed.state;
  let savedId: string;
  try {
    const plant = await updatePlant(plantId, parsed.input);
    savedId = plant.id;
  } catch (error) {
    if (error instanceof PlantError && error.code !== 'CONFLICT') {
      const fieldErrors: PlantFormState['fieldErrors'] = {};
      for (const issue of error.issues) {
        const field = serviceFields[issue.field];
        if (field) fieldErrors[field] = issue.message;
      }
      return {
        message: error.message,
        fieldErrors,
        ...(error.code === 'STALE_UPDATE' ? { stale: true } : {}),
      };
    }
    console.error('Plant update failed', error);
    return {
      message:
        'We could not confirm that your changes were saved. Your entries have been kept. Check the Plant details before submitting again.',
      fieldErrors: {},
    };
  }
  redirect(`/plants/${savedId}`);
}
