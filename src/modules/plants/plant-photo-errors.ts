import { PhotoValidationError } from '../../lib/photos/photo-error';
import { PlantError } from './plant-errors';

export function rethrowPlantPhotoValidation(error: unknown): never {
  if (error instanceof PhotoValidationError)
    throw new PlantError('VALIDATION_FAILED', error.message, {
      cause: error.cause,
      issues: error.issues,
    });
  throw error;
}
