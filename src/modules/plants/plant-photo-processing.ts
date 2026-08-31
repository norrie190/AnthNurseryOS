import 'server-only';
import {
  processPhoto,
  processPhotoThumbnail,
  processPhotoPreview,
  readPhotoDimensions,
} from '../../lib/photos/photo-processing';
import type { PhotoCrop } from './plant-photo-crop';
import { rethrowPlantPhotoValidation } from './plant-photo-errors';

export async function processPlantPhoto(bytes: Buffer, selectedCrop?: PhotoCrop) {
  try {
    return await processPhoto(bytes, selectedCrop);
  } catch (error) {
    rethrowPlantPhotoValidation(error);
  }
}
export async function processPlantPhotoThumbnail(bytes: Buffer, crop: PhotoCrop) {
  try {
    return await processPhotoThumbnail(bytes, crop);
  } catch (error) {
    rethrowPlantPhotoValidation(error);
  }
}
export async function processPlantPhotoPreview(bytes: Buffer) {
  try {
    return await processPhotoPreview(bytes);
  } catch (error) {
    rethrowPlantPhotoValidation(error);
  }
}
export async function readPlantPhotoDimensions(bytes: Buffer) {
  try {
    return await readPhotoDimensions(bytes);
  } catch (error) {
    rethrowPlantPhotoValidation(error);
  }
}
