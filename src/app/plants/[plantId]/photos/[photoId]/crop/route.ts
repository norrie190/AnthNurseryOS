import {
  cropPlantPhotoRequest,
  cropPlantPhotoPreviewRequest,
} from '@/modules/plants/plant-photo-http';

export const runtime = 'nodejs';
type Context = { params: Promise<{ plantId: string; photoId: string }> };
export async function POST(request: Request, context: Context) {
  const { plantId, photoId } = await context.params;
  return cropPlantPhotoRequest(request, plantId, photoId);
}
export async function GET(_request: Request, context: Context) {
  const { plantId, photoId } = await context.params;
  return cropPlantPhotoPreviewRequest(plantId, photoId);
}
