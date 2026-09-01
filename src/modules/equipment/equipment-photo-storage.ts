import 'server-only';
import { getPhotoStorage } from '../../lib/photos/photo-storage';

export {
  type PhotoObject,
  type PhotoObjectInfo,
  type PhotoCleanupResult,
  type PhotoStorage as EquipmentPhotoStorage,
} from '../../lib/photos/photo-storage';

export function getEquipmentPhotoStorage() {
  return getPhotoStorage('equipment');
}
