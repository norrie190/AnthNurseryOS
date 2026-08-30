import Link from 'next/link';
import styles from '@/modules/plants/components/plant-management.module.css';

export default function PlantNotFound() {
  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <h1>Plant not found</h1>
        <p>There is no Plant at this address. Check the link or return to Plants.</p>
      </header>
      <Link className={styles.backLink} href="/plants">
        Back to Plants
      </Link>
    </div>
  );
}
