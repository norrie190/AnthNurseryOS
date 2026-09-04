import Link from 'next/link';
import { connection } from 'next/server';
import { PlantList } from '@/modules/plants/components/plant-list';
import { getPlantList } from '@/modules/plants/plant-queries';
import styles from '@/modules/plants/components/plant-management.module.css';
import listStyles from '@/modules/plants/components/plant-list.module.css';

export default async function PlantsPage() {
  await connection();
  const plants = await getPlantList();
  return (
    <div className={styles.page}>
      <header className={listStyles.header}>
        <div className={styles.heading}>
          <p className={styles.eyebrow}>Your collection</p>
          <h1>Plants</h1>
          <p>Manage and view your nursery collection</p>
        </div>
        <div className={styles.actions}>
          <Link href="/plants/archived" className={styles.secondaryLink}>
            Archived Plants
          </Link>
          <Link href="/plants/new" className={styles.primaryButton}>
            Add Plant
          </Link>
        </div>
      </header>
      <PlantList plants={plants} />
    </div>
  );
}
