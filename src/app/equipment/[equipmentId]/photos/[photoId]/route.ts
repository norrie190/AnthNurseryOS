import { deleteEquipmentPhotoRequest } from '@/modules/equipment/equipment-photo-http';

export const runtime = 'nodejs';

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ equipmentId: string; photoId: string }> },
) {
  const { equipmentId, photoId } = await params;
  return deleteEquipmentPhotoRequest(request, equipmentId, photoId);
}
