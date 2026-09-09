import Link from 'next/link';
import { ArrowUpRight, Bolt, CalendarDays, MapPin } from 'lucide-react';
import { EmptyState } from '../../../components/ui/empty-state';
import type { EquipmentListItem } from '../equipment-queries';
import { equipmentPhotoImagePath } from '../equipment-photo-browser';
import { EquipmentPhotoImage } from './equipment-photo-image';
import styles from './equipment-management.module.css';

const dateFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'Europe/London',
});
export function EquipmentList({
  equipment,
  archived = false,
}: {
  equipment: readonly (Omit<EquipmentListItem, 'photos'> & {
    photos?: EquipmentListItem['photos'];
  })[];
  archived?: boolean;
}) {
  if (!equipment.length)
    return (
      <EmptyState
        title={archived ? 'No archived equipment.' : 'No equipment recorded yet.'}
        description={
          archived
            ? 'Archived equipment remains available with its details and history.'
            : 'Add your first item to start building your equipment inventory.'
        }
        action={
          <Link className={styles.primaryButton} href={archived ? '/equipment' : '/equipment/new'}>
            {archived ? 'Back to active Equipment' : 'Add Equipment'}
          </Link>
        }
      />
    );
  const dateLabel = archived ? 'Archived' : 'Added';
  return (
    <div className={styles.collection}>
      <ul className={styles.list} aria-label={archived ? 'Archived Equipment' : 'Equipment'}>
        {equipment.map((item) => {
          const date = archived ? item.archivedAt : item.createdAt;
          return (
            <li key={item.id}>
              <Link className={styles.row} href={`/equipment/${item.id}`}>
                <span className={styles.listPhoto}>
                  <EquipmentPhotoImage
                    src={
                      item.photos?.[0]
                        ? equipmentPhotoImagePath(
                            item.id,
                            item.photos[0].id,
                            'thumbnail',
                            item.photos[0].derivativeRevision,
                          )
                        : undefined
                    }
                    alt={`${item.reference} primary photo`}
                  />
                  <span className={styles.powerBadge} data-powered={item.usesPower || undefined}>
                    <Bolt aria-hidden="true" size={14} />
                    Energy tracking: {item.usesPower ? 'Supported' : 'Not enabled'}
                  </span>
                </span>
                <span className={styles.cardBody}>
                  <span className={styles.cardHeading}>
                    <strong className={styles.reference}>{item.reference}</strong>
                    <ArrowUpRight aria-hidden="true" size={18} />
                  </span>
                  <strong className={styles.name}>{item.name}</strong>
                  <span className={styles.category}>{item.category}</span>
                  {(item.brand || item.model) && (
                    <span className={styles.manufacturer}>
                      {[item.brand, item.model].filter(Boolean).join(' · ')}
                    </span>
                  )}
                  <span className={styles.cardMeta}>
                    <span>
                      <MapPin aria-hidden="true" size={15} />
                      <span className={styles.mobileLabel}>Location: </span>
                      {item.location?.name ?? 'No location'}
                      {item.location?.archivedAt ? ' (archived)' : ''}
                    </span>
                    <span>
                      <CalendarDays aria-hidden="true" size={15} />
                      <span className={styles.mobileLabel}>{dateLabel}: </span>
                      {date ? (
                        <time dateTime={date.toISOString()}>{dateFormat.format(date)}</time>
                      ) : (
                        'Not recorded'
                      )}
                    </span>
                  </span>
                  {archived && <span className={styles.restoreHint}>View details to restore</span>}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
