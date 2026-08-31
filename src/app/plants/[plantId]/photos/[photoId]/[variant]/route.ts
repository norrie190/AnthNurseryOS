import { deliverPlantPhoto } from '@/modules/plants/plant-photo-http';

export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ plantId: string; photoId: string; variant: string }> },
) {
  const { plantId, photoId, variant } = await params;
  return deliverPlantPhoto(plantId, photoId, variant);
}
