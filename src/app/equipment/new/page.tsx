import Link from 'next/link';
import { connection } from 'next/server';
import { EquipmentForm } from '@/modules/equipment/components/equipment-form';
import { getEquipmentLocationOptions } from '@/modules/equipment/equipment-queries';
import styles from '@/modules/equipment/components/equipment-management.module.css';

export default async function AddEquipmentPage() {
  await connection();
  const locations = await getEquipmentLocationOptions();
  const currencies = [
    'GBP',
    ...Intl.supportedValuesOf('currency').filter((currency) => currency !== 'GBP'),
  ];
  return (
    <div className={styles.page}>
      <Link className={styles.backLink} href="/equipment">
        ← Equipment
      </Link>
      <header className={styles.heading}>
        <p className={styles.eyebrow}>Equipment inventory</p>
        <h1>Add Equipment</h1>
        <p>
          Start with the asset identity, then add location, energy tracking, purchase, and notes.
        </p>
      </header>
      <EquipmentForm locations={locations} currencies={currencies} />
    </div>
  );
}
