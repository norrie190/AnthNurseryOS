import { uploadPlantPhotoRequest } from '@/modules/plants/plant-photo-http';

export const runtime = 'nodejs';

export async function POST(request: Request, { params }: { params: Promise<{ plantId: string }> }) {
  const { plantId } = await params;
  return uploadPlantPhotoRequest(request, plantId);
}
