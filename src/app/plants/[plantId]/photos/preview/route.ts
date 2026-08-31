import { uploadPlantPhotoRequest } from '@/modules/plants/plant-photo-http';

export const runtime = 'nodejs';
export async function POST(request: Request, context: { params: Promise<{ plantId: string }> }) {
  const { plantId } = await context.params;
  return uploadPlantPhotoRequest(request, plantId, true);
}
