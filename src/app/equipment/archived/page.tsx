import Link from 'next/link';
import { connection } from 'next/server';
import { EquipmentList } from '@/modules/equipment/components/equipment-list';
import { getArchivedEquipmentList } from '@/modules/equipment/equipment-queries';
import styles from '@/modules/equipment/components/equipment-management.module.css';

export default async function ArchivedEquipmentPage() {
  await connection();
  const equipment = await getArchivedEquipmentList();
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.heading}>
          <p className={styles.eyebrow}>Your inventory</p>
          <h1>Archived Equipment</h1>
          <p>Retained equipment records. Open an item to view its details or restore it.</p>
        </div>
        <Link className={styles.secondaryLink} href="/equipment">
          Back to active Equipment
        </Link>
      </header>
      <EquipmentList equipment={equipment} archived />
    </div>
  );
}
