import Link from 'next/link';
import { connection } from 'next/server';
import { notFound } from 'next/navigation';
import {
  getEquipmentById,
  getEquipmentLocationOptions,
} from '@/modules/equipment/equipment-queries';
import { equipmentEditValues } from '@/modules/equipment/equipment-edit-values';
import { EquipmentForm } from '@/modules/equipment/components/equipment-form';
import styles from '@/modules/equipment/components/equipment-management.module.css';

export default async function EditEquipmentPage({
  params,
}: {
  params: Promise<{ equipmentId: string }>;
}) {
  await connection();
  const { equipmentId } = await params;
  const equipment = await getEquipmentById(equipmentId);
  if (!equipment) notFound();
  const locations = await getEquipmentLocationOptions();
  if (equipment.location && !locations.some((location) => location.id === equipment.locationId))
    locations.unshift({
      id: equipment.location.id,
      label: `${equipment.location.name} (archived, current Location)`,
    });
  const currencies = [
    'GBP',
    ...Intl.supportedValuesOf('currency').filter((currency) => currency !== 'GBP'),
  ];
  if (equipment.purchase && !currencies.includes(equipment.purchase.currency))
    currencies.push(equipment.purchase.currency);
  return (
    <div className={styles.page}>
      <Link className={styles.backLink} href={`/equipment/${equipment.id}`}>
        ← Equipment details
      </Link>
      <header className={styles.heading}>
        <p className={styles.eyebrow}>Equipment inventory</p>
        <h1>Editing {equipment.reference}</h1>
        <p>Update the asset identity and context below. Its permanent reference stays the same.</p>
      </header>
      <EquipmentForm
        key={equipment.id}
        locations={locations}
        currencies={currencies}
        initialValues={equipmentEditValues(equipment)}
        edit={{
          equipmentId: equipment.id,
          reference: equipment.reference,
          expectedUpdatedAt: equipment.updatedAt.toISOString(),
        }}
      />
    </div>
  );
}
