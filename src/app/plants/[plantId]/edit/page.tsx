import Link from 'next/link';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import {
  getPlantById,
  getPlantParentOptions,
  getUsableLocationOptions,
} from '@/modules/plants/plant-queries';
import { plantEditValues } from '@/modules/plants/plant-edit-values';
import { EditPlantForm } from '@/modules/plants/components/edit-plant-form';
import styles from '@/modules/plants/components/plant-management.module.css';

export default async function EditPlantPage({ params }: { params: Promise<{ plantId: string }> }) {
  await connection();
  const { plantId } = await params;
  const plant = await getPlantById(plantId);
  if (!plant) notFound();
  const [parents, locations] = await Promise.all([
    getPlantParentOptions(),
    getUsableLocationOptions(),
  ]);
  if (plant.location && !locations.some((option) => option.id === plant.locationId)) {
    locations.unshift({
      id: plant.location.id,
      label: `${plant.location.name} (archived, current Location)`,
    });
  }
  const currencies = [
    'GBP',
    ...Intl.supportedValuesOf('currency').filter((currency) => currency !== 'GBP'),
  ];
  if (plant.purchase && !currencies.includes(plant.purchase.currency))
    currencies.push(plant.purchase.currency);
  return (
    <div className={styles.page}>
      <Link href={`/plants/${plant.id}`} className={styles.backLink}>
        ← Plant details
      </Link>
      <header className={styles.heading}>
        <p className={styles.eyebrow}>Plant Management</p>
        <h1>Editing {plant.reference}</h1>
        <p>Update the details below. This Plant keeps its permanent reference.</p>
      </header>
      <EditPlantForm
        key={plant.id}
        plantId={plant.id}
        reference={plant.reference}
        expectedUpdatedAt={plant.updatedAt.toISOString()}
        initialValues={plantEditValues(plant)}
        parents={parents.filter((parent) => parent.id !== plant.id)}
        locations={locations}
        currencies={currencies}
        parentageLocked={plant.originSeedBatchId !== null}
      />
    </div>
  );
}
