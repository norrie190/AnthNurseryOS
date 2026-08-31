import { setPrimaryPlantPhotoRequest } from '@/modules/plants/plant-photo-http';

export const runtime = 'nodejs';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ plantId: string; photoId: string }> },
) {
  const { plantId, photoId } = await params;
  return setPrimaryPlantPhotoRequest(request, plantId, photoId);
}
