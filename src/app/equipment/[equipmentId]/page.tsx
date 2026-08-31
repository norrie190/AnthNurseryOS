import { connection } from 'next/server';
import { notFound } from 'next/navigation';
import { getEquipmentById } from '@/modules/equipment/equipment-queries';
import { EquipmentDetail } from '@/modules/equipment/components/equipment-detail';
import { loadEquipmentEnergyView } from '@/modules/energy/energy-page-data';
import { EquipmentEnergy } from '@/modules/energy/components/equipment-energy';

export default async function EquipmentDetailPage({
  params,
}: {
  params: Promise<{ equipmentId: string }>;
}) {
  await connection();
  const { equipmentId } = await params;
  const equipment = await getEquipmentById(equipmentId);
  if (!equipment) notFound();
  const energy = await loadEquipmentEnergyView(equipmentId);
  return (
    <EquipmentDetail
      equipment={equipment}
      energy={<EquipmentEnergy view={energy} />}
      hasOngoingPowerPeriod={energy.hasOngoingPowerPeriod}
    />
  );
}
