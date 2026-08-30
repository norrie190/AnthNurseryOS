import Link from 'next/link';
import { connection } from 'next/server';
import { AddPlantForm } from '@/modules/plants/components/add-plant-form';
import { getPlantParentOptions, getUsableLocationOptions } from '@/modules/plants/plant-queries';
import styles from '@/modules/plants/components/plant-management.module.css';

export default async function AddPlantPage() {
  await connection();
  const [parents, locations] = await Promise.all([
    getPlantParentOptions(),
    getUsableLocationOptions(),
  ]);
  const currencies = [
    'GBP',
    ...Intl.supportedValuesOf('currency').filter((currency) => currency !== 'GBP'),
  ];
  return (
    <div className={styles.page}>
      <Link href="/plants" className={styles.backLink}>
        ← Plants
      </Link>
      <header className={styles.heading}>
        <p className={styles.eyebrow}>Plant Management</p>
        <h1>Add Plant</h1>
        <p>
          Record a Plant in your nursery. Its permanent ANT reference is assigned when you save.
        </p>
      </header>
      <AddPlantForm parents={parents} locations={locations} currencies={currencies} />
    </div>
  );
}
