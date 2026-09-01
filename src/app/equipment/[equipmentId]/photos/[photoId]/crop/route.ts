import {
  cropEquipmentPhotoPreviewRequest,
  cropEquipmentPhotoRequest,
} from '@/modules/equipment/equipment-photo-http';

export const runtime = 'nodejs';
type Context = { params: Promise<{ equipmentId: string; photoId: string }> };

export async function POST(request: Request, context: Context) {
  const { equipmentId, photoId } = await context.params;
  return cropEquipmentPhotoRequest(request, equipmentId, photoId);
}

export async function GET(_request: Request, context: Context) {
  const { equipmentId, photoId } = await context.params;
  return cropEquipmentPhotoPreviewRequest(equipmentId, photoId);
}
