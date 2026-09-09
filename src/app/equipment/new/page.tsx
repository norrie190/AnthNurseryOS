import Link from 'next/link';
import { Camera, Check, Wrench } from 'lucide-react';
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
        <p className={styles.eyebrow}>New nursery asset</p>
        <h1>Add Equipment</h1>
        <p>Save the essentials now. Manufacturer, purchase details and notes can be added later.</p>
      </header>
      <div className={styles.createLayout}>
        <EquipmentForm locations={locations} currencies={currencies} />
        <aside className={styles.createAside} aria-label="What happens after saving">
          <span className={styles.createAsideIcon} aria-hidden="true">
            <Wrench size={24} />
          </span>
          <h2>Your Equipment profile</h2>
          <p>When you save, Anth Nursery OS will:</p>
          <ul>
            <li>
              <Check aria-hidden="true" size={16} /> Assign the next EQP reference
            </li>
            <li>
              <Check aria-hidden="true" size={16} /> Create the permanent inventory record
            </li>
            <li>
              <Camera aria-hidden="true" size={16} /> Let you add photos and power settings
            </li>
          </ul>
        </aside>
      </div>
    </div>
  );
}
