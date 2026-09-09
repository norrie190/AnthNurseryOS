'use client';

import Link from 'next/link';

import styles from '@/modules/energy/components/energy.module.css';

export default function EnergyError({ reset }: { reset: () => void }) {
  return (
    <div className={styles.page} role="alert">
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>Energy</p>
          <h1>Energy estimates are unavailable</h1>
          <p>We could not load the latest Equipment and tariff information.</p>
        </div>
      </header>
      <div className={styles.actions}>
        <button className={styles.primary} type="button" onClick={reset}>
          Try again
        </button>
        <Link className={styles.secondary} href="/equipment">
          View Equipment
        </Link>
      </div>
    </div>
  );
}
