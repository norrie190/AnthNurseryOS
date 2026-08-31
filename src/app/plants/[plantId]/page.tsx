import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { getPlantById } from '@/modules/plants/plant-queries';
import { PlantDetail } from '@/modules/plants/components/plant-detail';
import { getPlantPhotoGallery } from '@/modules/plants/plant-photo-queries';

export default async function PlantPage({ params }: { params: Promise<{ plantId: string }> }) {
  await connection();
  const { plantId } = await params;
  const plant = await getPlantById(plantId);
  if (!plant) notFound();
  const photos = await getPlantPhotoGallery(plantId);
  return (
    <PlantDetail
      plant={plant}
      photos={photos.map(({ id, caption, takenAt, isPrimary, derivativeRevision }) => ({
        id,
        caption,
        takenAt: takenAt?.toISOString() ?? null,
        isPrimary,
        derivativeRevision,
      }))}
    />
  );
}
