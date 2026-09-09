import Link from 'next/link';
import { Archive, Plus } from 'lucide-react';
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
          <p>
            {plants.length === 0
              ? 'Your living collection starts here.'
              : `${plants.length} active ${plants.length === 1 ? 'Plant' : 'Plants'} in your nursery.`}
          </p>
        </div>
        <div className={styles.actions}>
          <Link href="/plants/archived" className={styles.secondaryLink}>
            <Archive aria-hidden="true" size={17} />
            Archived Plants
          </Link>
          <Link href="/plants/new" className={styles.primaryButton}>
            <Plus aria-hidden="true" size={18} />
            Add Plant
          </Link>
        </div>
      </header>
      <PlantList plants={plants} />
    </div>
  );
}
