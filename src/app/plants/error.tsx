'use client';

import Link from 'next/link';
import styles from '@/modules/plants/components/plant-management.module.css';

export default function PlantErrorPage({ reset }: { reset: () => void }) {
  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <h1>We could not load this Plant page</h1>
        <p>The database may be unavailable. Please try loading the page again.</p>
      </header>
      <div className={styles.actions}>
        <button className={styles.primaryButton} onClick={reset}>
          Try loading again
        </button>
        <Link href="/plants" className={styles.secondaryLink}>
          Back to Plants
        </Link>
      </div>
    </div>
  );
}
