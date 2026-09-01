import { setPrimaryEquipmentPhotoRequest } from '@/modules/equipment/equipment-photo-http';

export const runtime = 'nodejs';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ equipmentId: string; photoId: string }> },
) {
  const { equipmentId, photoId } = await params;
  return setPrimaryEquipmentPhotoRequest(request, equipmentId, photoId);
}
