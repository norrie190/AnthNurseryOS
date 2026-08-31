import { connection } from 'next/server';
import { notFound } from 'next/navigation';
import { getEquipmentById } from '@/modules/equipment/equipment-queries';
import { EquipmentDetail } from '@/modules/equipment/components/equipment-detail';

export default async function EquipmentDetailPage({
  params,
}: {
  params: Promise<{ equipmentId: string }>;
}) {
  await connection();
  const { equipmentId } = await params;
  const equipment = await getEquipmentById(equipmentId);
  if (!equipment) notFound();
  return <EquipmentDetail equipment={equipment} />;
}
