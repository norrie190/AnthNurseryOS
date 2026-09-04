import Link from 'next/link';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusBadge, type StatusBadgeVariant } from '@/components/ui/status-badge';
import type { PlantListItem, ArchivedPlantListItem } from '../plant-queries';
import { plantStatusLabels } from '../plant-form-state';
import { photoImagePath } from '../plant-photo-browser';
import { PlantPhotoImage } from './plant-photo-image';
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
      <EmptyState
        title={archived ? 'No archived Plants' : 'No active Plants'}
        description={
          archived
            ? 'Plants you archive will appear here. Their details remain available.'
            : 'Add a Plant to your collection, or restore one from Archived Plants.'
        }
        action={
          <Link href={archived ? '/plants' : '/plants/new'} className={shared.primaryButton}>
            {archived ? 'Back to active Plants' : 'Add Plant'}
          </Link>
        }
      />
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
              <span className={styles.name}>
                <span className={styles.photo}>
                  <PlantPhotoImage
                    src={
                      plant.photos[0]
                        ? photoImagePath(
                            plant.id,
                            plant.photos[0].id,
                            'thumbnail',
                            plant.photos[0].derivativeRevision,
                          )
                        : undefined
                    }
                    alt={`${plant.reference} primary photo`}
                  />
                </span>
                <span>{plant.name || 'Unnamed Plant'}</span>
              </span>
              <span className={styles.status}>
                <StatusBadge variant={plantStatusVariant(plant.status)}>
                  {plantStatusLabels[plant.status]}
                </StatusBadge>
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

function plantStatusVariant(status: keyof typeof plantStatusLabels): StatusBadgeVariant {
  if (status === 'GROWING') return 'success';
  if (status === 'QUARANTINE') return 'attention';
  return 'neutral';
}
