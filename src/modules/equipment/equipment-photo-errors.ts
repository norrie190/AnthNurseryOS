import { PhotoValidationError } from '../../lib/photos/photo-error';
import { EquipmentError } from './equipment-errors';

export function rethrowEquipmentPhotoValidation(error: unknown): never {
  if (error instanceof PhotoValidationError)
    throw new EquipmentError('VALIDATION_FAILED', error.message, {
      cause: error.cause,
      issues: error.issues,
    });
  throw error;
}
