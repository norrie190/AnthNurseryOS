import { connection } from 'next/server';
import { notFound } from 'next/navigation';
import { getEquipmentById } from '@/modules/equipment/equipment-queries';
import { EquipmentDetail } from '@/modules/equipment/components/equipment-detail';
import { loadEquipmentEnergyView } from '@/modules/energy/energy-page-data';
import { EquipmentEnergy } from '@/modules/energy/components/equipment-energy';
import { getEquipmentPhotoGallery } from '@/modules/equipment/equipment-photo-queries';
import { EquipmentPhotos } from '@/modules/equipment/components/equipment-photos';

export default async function EquipmentDetailPage({
  params,
}: {
  params: Promise<{ equipmentId: string }>;
}) {
  await connection();
  const { equipmentId } = await params;
  const equipment = await getEquipmentById(equipmentId);
  if (!equipment) notFound();
  const [energy, photoRecords] = await Promise.all([
    loadEquipmentEnergyView(equipmentId),
    getEquipmentPhotoGallery(equipmentId),
  ]);
  const photos = photoRecords.map((photo) => ({
    ...photo,
    takenAt: photo.takenAt?.toISOString() ?? null,
    createdAt: photo.createdAt.toISOString(),
    updatedAt: photo.updatedAt.toISOString(),
  }));
  return (
    <EquipmentDetail
      equipment={equipment}
      photos={
        <EquipmentPhotos
          equipmentId={equipment.id}
          reference={equipment.reference}
          archived={equipment.archivedAt !== null}
          expectedUpdatedAt={equipment.updatedAt.toISOString()}
          photos={photos}
        />
      }
      energy={<EquipmentEnergy view={energy} />}
      hasOngoingPowerPeriod={energy.hasOngoingPowerPeriod}
    />
  );
}
