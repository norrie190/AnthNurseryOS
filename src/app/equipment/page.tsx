import Link from 'next/link';
import { Archive, Plus, Zap } from 'lucide-react';
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
          <p>
            {equipment.length === 0
              ? 'Build the physical setup behind your nursery.'
              : `${equipment.length} active ${equipment.length === 1 ? 'item' : 'items'} in your nursery setup.`}
          </p>
        </div>
        <div className={styles.actions}>
          <Link className={styles.secondaryButton} href="/energy/tariffs">
            <Zap aria-hidden="true" size={17} />
            Electricity tariffs
          </Link>
          <Link className={styles.secondaryLink} href="/equipment/archived">
            <Archive aria-hidden="true" size={17} />
            Archived Equipment
          </Link>
          <Link className={styles.primaryButton} href="/equipment/new">
            <Plus aria-hidden="true" size={18} />
            Add Equipment
          </Link>
        </div>
      </header>
      <EquipmentList equipment={equipment} />
    </div>
  );
}
