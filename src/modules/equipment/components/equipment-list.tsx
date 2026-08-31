import Link from 'next/link';
import type { EquipmentListItem } from '../equipment-queries';
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
  equipment: readonly EquipmentListItem[];
  archived?: boolean;
}) {
  if (!equipment.length)
    return (
      <section className={styles.card} aria-labelledby="empty-equipment-heading">
        <h2 id="empty-equipment-heading">
          {archived ? 'No archived Equipment' : 'No active Equipment'}
        </h2>
        <p className={styles.sectionIntro}>
          {archived
            ? 'Equipment you archive will appear here. Its details remain available.'
            : 'Add your first item to start building your Equipment inventory, or restore an archived item.'}
        </p>
        <Link className={styles.primaryButton} href={archived ? '/equipment' : '/equipment/new'}>
          {archived ? 'Back to active Equipment' : 'Add Equipment'}
        </Link>
      </section>
    );
  const dateLabel = archived ? 'Archived' : 'Added';
  return (
    <div className={styles.collection}>
      <div className={styles.columns} aria-hidden="true">
        <span>Reference</span>
        <span>Equipment</span>
        <span>Category</span>
        <span>Uses power</span>
        <span>Location</span>
        <span>{dateLabel}</span>
      </div>
      <ul className={styles.list} aria-label={archived ? 'Archived Equipment' : 'Equipment'}>
        {equipment.map((item) => {
          const date = archived ? item.archivedAt : item.createdAt;
          return (
            <li key={item.id}>
              <Link className={styles.row} href={`/equipment/${item.id}`}>
                <strong className={styles.reference}>{item.reference}</strong>
                <span>
                  {item.name}
                  {(item.brand || item.model) && (
                    <span className={styles.manufacturer}>
                      {[item.brand, item.model].filter(Boolean).join(' · ')}
                    </span>
                  )}
                </span>
                <span>
                  <span className={styles.mobileLabel}>Category: </span>
                  {item.category}
                </span>
                <span>
                  <span className={styles.mobileLabel}>Uses power: </span>
                  {item.usesPower ? 'Yes' : 'No'}
                </span>
                <span>
                  <span className={styles.mobileLabel}>Location: </span>
                  {item.location?.name ?? 'No location'}
                  {item.location?.archivedAt ? ' (archived)' : ''}
                </span>
                <span>
                  <span className={styles.mobileLabel}>{dateLabel}: </span>
                  {date ? (
                    <time dateTime={date.toISOString()}>{dateFormat.format(date)}</time>
                  ) : (
                    'Not recorded'
                  )}
                  {archived && <span className={styles.manufacturer}>View details to restore</span>}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
