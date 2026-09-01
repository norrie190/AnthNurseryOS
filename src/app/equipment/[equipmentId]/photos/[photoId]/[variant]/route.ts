import { deliverEquipmentPhoto } from '@/modules/equipment/equipment-photo-http';

export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ equipmentId: string; photoId: string; variant: string }> },
) {
  const { equipmentId, photoId, variant } = await params;
  return deliverEquipmentPhoto(equipmentId, photoId, variant);
}
