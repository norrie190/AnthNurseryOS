import 'server-only';
import { getPhotoStorage } from '../../lib/photos/photo-storage';
export {
  readR2Configuration,
  type PhotoObject,
  type PhotoObjectInfo,
  type PhotoCleanupResult,
  type PhotoStorage as PlantPhotoStorage,
} from '../../lib/photos/photo-storage';

export function getPlantPhotoStorage() {
  return getPhotoStorage('plants');
}
