import 'server-only';
import {
  processPhoto,
  processPhotoPreview,
  processPhotoThumbnail,
  readPhotoDimensions,
} from '../../lib/photos/photo-processing';
import type { PhotoCrop } from '../../lib/photos/photo-crop';
import { rethrowEquipmentPhotoValidation } from './equipment-photo-errors';

export async function processEquipmentPhoto(bytes: Buffer, selectedCrop?: PhotoCrop) {
  try {
    return await processPhoto(bytes, selectedCrop);
  } catch (error) {
    rethrowEquipmentPhotoValidation(error);
  }
}

export async function processEquipmentPhotoThumbnail(bytes: Buffer, crop: PhotoCrop) {
  try {
    return await processPhotoThumbnail(bytes, crop);
  } catch (error) {
    rethrowEquipmentPhotoValidation(error);
  }
}

export async function processEquipmentPhotoPreview(bytes: Buffer) {
  try {
    return await processPhotoPreview(bytes);
  } catch (error) {
    rethrowEquipmentPhotoValidation(error);
  }
}

export async function readEquipmentPhotoDimensions(bytes: Buffer) {
  try {
    return await readPhotoDimensions(bytes);
  } catch (error) {
    rethrowEquipmentPhotoValidation(error);
  }
}
