import Link from 'next/link';
import type { PlantListItem } from '../plant-queries';
import { plantStatusLabels } from '../plant-form-state';
import shared from './plant-management.module.css';
import styles from './plant-list.module.css';

const addedDate = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'Europe/London',
});

export function PlantList({ plants }: { plants: readonly PlantListItem[] }) {
  if (plants.length === 0) {
    return (
      <section className={shared.card} aria-labelledby="empty-plants-heading">
        <h2 id="empty-plants-heading">No Plants yet</h2>
        <p className={shared.sectionIntro}>
          Add your first Plant to start building your nursery collection.
        </p>
        <Link href="/plants/new" className={shared.primaryButton}>
          Add Plant
        </Link>
      </section>
    );
  }

  return (
    <div className={styles.collection}>
      <div className={styles.columns} aria-hidden="true">
        <span>Reference</span>
        <span>Plant</span>
        <span>Status</span>
        <span>Location</span>
        <span>Added</span>
      </div>
      <ul className={styles.list} aria-label="Plants">
        {plants.map((plant) => (
          <li key={plant.id}>
            <Link className={styles.row} href={`/plants/${plant.id}`}>
              <strong className={styles.reference}>{plant.reference}</strong>
              <span className={styles.name}>{plant.name || 'Unnamed Plant'}</span>
              <span className={styles.status}>
                <span className={shared.badge}>{plantStatusLabels[plant.status]}</span>
              </span>
              <span className={styles.location}>
                <span className={styles.mobileLabel}>Location: </span>
                {plant.location?.name || 'No location'}
              </span>
              <span className={styles.added}>
                <span className={styles.mobileLabel}>Added: </span>
                <time dateTime={plant.createdAt.toISOString()}>
                  {addedDate.format(plant.createdAt)}
                </time>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
