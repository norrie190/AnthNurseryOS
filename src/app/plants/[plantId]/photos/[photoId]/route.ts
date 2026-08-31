import { deletePlantPhotoRequest } from '@/modules/plants/plant-photo-http';

export const runtime = 'nodejs';

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ plantId: string; photoId: string }> },
) {
  const { plantId, photoId } = await params;
  return deletePlantPhotoRequest(request, plantId, photoId);
}
