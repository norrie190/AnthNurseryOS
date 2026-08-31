import Link from 'next/link';
import type { PlantListItem, ArchivedPlantListItem } from '../plant-queries';
import { plantStatusLabels } from '../plant-form-state';
import shared from './plant-management.module.css';
import styles from './plant-list.module.css';

const addedDate = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'Europe/London',
});

type PlantListProps =
  | { plants: readonly PlantListItem[]; archived?: false }
  | { plants: readonly ArchivedPlantListItem[]; archived: true };

export function PlantList(props: PlantListProps) {
  const archived = props.archived === true;
  const dateLabel = archived ? 'Archived' : 'Added';
  const rows = props.archived
    ? props.plants.map((plant) => ({ ...plant, date: plant.archivedAt }))
    : props.plants.map((plant) => ({ ...plant, date: plant.createdAt }));
  if (rows.length === 0) {
    return (
      <section className={shared.card} aria-labelledby="empty-plants-heading">
        <h2 id="empty-plants-heading">{archived ? 'No archived Plants' : 'No active Plants'}</h2>
        <p className={shared.sectionIntro}>
          {archived
            ? 'Plants you archive will appear here. Their details remain available.'
            : 'Add a Plant to your collection, or restore one from Archived Plants.'}
        </p>
        <Link href={archived ? '/plants' : '/plants/new'} className={shared.primaryButton}>
          {archived ? 'Back to active Plants' : 'Add Plant'}
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
        <span>{dateLabel}</span>
      </div>
      <ul className={styles.list} aria-label={archived ? 'Archived Plants' : 'Plants'}>
        {rows.map((plant) => (
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
                <span className={styles.mobileLabel}>{dateLabel}: </span>
                {plant.date ? (
                  <time dateTime={plant.date.toISOString()}>{addedDate.format(plant.date)}</time>
                ) : (
                  'Not recorded'
                )}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
