'use client';

import { createPlantAction } from '../plant-actions';
import { PlantForm, type PlantFormOptions } from './plant-form';

export function AddPlantForm(props: PlantFormOptions) {
  return <PlantForm {...props} action={createPlantAction} />;
}
