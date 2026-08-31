import {
  photoCropPixels as sharedCropPixels,
  type PhotoCrop,
  type PhotoDimensions,
} from '../../lib/photos/photo-crop';
import { rethrowPlantPhotoValidation } from './plant-photo-errors';

export {
  photoCropSchema,
  centredPhotoCrop,
  fitPhotoCrop,
  type PhotoCrop,
  type PhotoDimensions,
} from '../../lib/photos/photo-crop';
export function photoCropPixels(input: PhotoCrop, dimensions: PhotoDimensions) {
  try {
    return sharedCropPixels(input, dimensions);
  } catch (error) {
    rethrowPlantPhotoValidation(error);
  }
}
