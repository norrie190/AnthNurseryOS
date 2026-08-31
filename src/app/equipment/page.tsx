import Link from 'next/link';
import { connection } from 'next/server';
import { EquipmentList } from '@/modules/equipment/components/equipment-list';
import { getEquipmentList } from '@/modules/equipment/equipment-queries';
import styles from '@/modules/equipment/components/equipment-management.module.css';

export default async function EquipmentPage() {
  await connection();
  const equipment = await getEquipmentList();
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.heading}>
          <p className={styles.eyebrow}>Your inventory</p>
          <h1>Equipment</h1>
          <p>Manage and view your nursery equipment</p>
        </div>
        <div className={styles.actions}>
          <Link className={styles.secondaryLink} href="/equipment/archived">
            Archived Equipment
          </Link>
          <Link className={styles.primaryButton} href="/equipment/new">
            Add Equipment
          </Link>
        </div>
      </header>
      <EquipmentList equipment={equipment} />
    </div>
  );
}
