import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { getPlantById } from '@/modules/plants/plant-queries';
import { PlantDetail } from '@/modules/plants/components/plant-detail';

export default async function PlantPage({ params }: { params: Promise<{ plantId: string }> }) {
  await connection();
  const { plantId } = await params;
  const plant = await getPlantById(plantId);
  if (!plant) notFound();
  return <PlantDetail plant={plant} />;
}
