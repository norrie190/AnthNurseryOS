'use client';

import { updatePlantAction } from '../plant-actions';
import { useState } from 'react';
import type { PlantFormValues } from '../plant-form-state';
import { PlantForm, type PlantFormOptions } from './plant-form';

type EditPlantFormProps = PlantFormOptions & {
  plantId: string;
  reference: string;
  expectedUpdatedAt: string;
  initialValues: PlantFormValues;
};

export function EditPlantForm({
  plantId,
  reference,
  expectedUpdatedAt,
  initialValues,
  ...options
}: EditPlantFormProps) {
  // Keep the concurrency token paired with the values originally opened. A server
  // rerender must not refresh the token beneath retained, potentially stale input.
  const [opened] = useState({ expectedUpdatedAt, initialValues });
  const action = updatePlantAction.bind(null, plantId, opened.expectedUpdatedAt);
  return (
    <PlantForm
      {...options}
      action={action}
      initialValues={opened.initialValues}
      edit={{ plantId, reference, hasPurchase: opened.initialValues.recordPurchase === 'on' }}
    />
  );
}
