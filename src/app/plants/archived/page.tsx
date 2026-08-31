import Link from 'next/link';
import { connection } from 'next/server';
import { PlantList } from '@/modules/plants/components/plant-list';
import { getArchivedPlantList } from '@/modules/plants/plant-queries';
import styles from '@/modules/plants/components/plant-management.module.css';
import listStyles from '@/modules/plants/components/plant-list.module.css';

export default async function ArchivedPlantsPage() {
  await connection();
  const plants = await getArchivedPlantList();
  return (
    <div className={styles.page}>
      <header className={listStyles.header}>
        <div className={styles.heading}>
          <p className={styles.eyebrow}>Your collection</p>
          <h1>Archived Plants</h1>
          <p>Preserved Plant records. Open a Plant to view its details or restore it.</p>
        </div>
        <Link href="/plants" className={styles.secondaryLink}>
          View active Plants
        </Link>
      </header>
      <PlantList plants={plants} archived />
    </div>
  );
}
