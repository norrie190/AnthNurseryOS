import { uploadEquipmentPhotoRequest } from '@/modules/equipment/equipment-photo-http';

export const runtime = 'nodejs';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ equipmentId: string }> },
) {
  const { equipmentId } = await params;
  return uploadEquipmentPhotoRequest(request, equipmentId, true);
}
