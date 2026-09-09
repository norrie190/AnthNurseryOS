import Link from 'next/link';
import { Camera, Check, Sprout } from 'lucide-react';
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
        <p className={styles.eyebrow}>New arrival</p>
        <h1>Add Plant</h1>
        <p>Save the essentials now. Parentage, purchase details and notes can be added later.</p>
      </header>
      <div className={styles.createLayout}>
        <AddPlantForm parents={parents} locations={locations} currencies={currencies} />
        <aside className={styles.createAside} aria-label="What happens after saving">
          <span className={styles.createAsideIcon} aria-hidden="true">
            <Sprout size={25} />
          </span>
          <h2>Your Plant profile</h2>
          <p>When you save, Anth Nursery OS will:</p>
          <ul>
            <li>
              <Check aria-hidden="true" size={16} /> Assign the next ANT reference
            </li>
            <li>
              <Check aria-hidden="true" size={16} /> Create its permanent nursery record
            </li>
            <li>
              <Camera aria-hidden="true" size={16} /> Take you to its profile to add photos
            </li>
          </ul>
        </aside>
      </div>
    </div>
  );
}
