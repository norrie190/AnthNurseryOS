import Link from 'next/link';
import { photoImagePath } from '../../plants/plant-photo-browser';
import { PlantPhotoImage } from '../../plants/components/plant-photo-image';
import { plantStatusLabels } from '../../plants/plant-form-state';
import type { WateringQueue } from '../watering-queue-queries';
import type { WateringQueueEntry } from '../watering-queue';
import styles from './watering-queue-page.module.css';

const categories = [
  ['OVERDUE', 'Overdue'],
  ['DUE_TODAY', 'Due today'],
  ['NEEDS_FIRST_WATERING', 'Needs first watering'],
  ['DUE_SOON', 'Due soon'],
  ['UPCOMING', 'Upcoming'],
  ['NOT_CONFIGURED', 'Not configured'],
] as const;
const dateFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'Europe/London',
});
const countKeys = {
  OVERDUE: 'overdue',
  DUE_TODAY: 'dueToday',
  NEEDS_FIRST_WATERING: 'needsFirstWatering',
  DUE_SOON: 'dueSoon',
  UPCOMING: 'upcoming',
  NOT_CONFIGURED: 'notConfigured',
} as const;

function dueLabel(entry: WateringQueueEntry) {
  const { due } = entry;
  if (due.status === 'OVERDUE') return `${Math.abs(due.daysUntilDue ?? 0)} days overdue`;
  if (due.status === 'DUE_TODAY') return 'Due today';
  if (due.status === 'NEEDS_FIRST_WATERING') return 'First watering not recorded';
  if (due.status === 'DUE_SOON' || due.status === 'UPCOMING')
    return `Due in ${due.daysUntilDue} days`;
  return 'No watering schedule';
}

function QueueEntry({ entry }: { entry: WateringQueueEntry }) {
  const { plant, due } = entry;
  const photo = plant.primaryPhoto;
  return (
    <li className={styles.entry}>
      <span className={styles.photo}>
        <PlantPhotoImage
          src={
            photo
              ? photoImagePath(plant.id, photo.id, 'thumbnail', photo.derivativeRevision)
              : undefined
          }
          alt={`${plant.name || plant.reference} primary photo`}
        />
      </span>
      <div className={styles.details}>
        <div className={styles.titleLine}>
          <Link href={`/plants/${plant.id}`} className={styles.name}>
            {plant.name || 'Unnamed Plant'}
          </Link>
          <span className={styles.badge}>{plantStatusLabels[plant.status]}</span>
        </div>
        <p className={styles.meta}>
          {plant.reference} · {plant.location?.name || 'No location'}
        </p>
        <p className={styles.due}>
          <strong>{dueLabel(entry)}</strong>
          {due.latestWateredDate ? (
            <>
              {' '}
              · Last watered{' '}
              <time dateTime={due.latestWateredDate}>
                {dateFormat.format(new Date(`${due.latestWateredDate}T00:00:00Z`))}
              </time>
            </>
          ) : null}
        </p>
        <p className={styles.meta}>
          {due.intervalDays ? `Every ${due.intervalDays} days` : null}
          {due.nextDueDate ? (
            <>
              {' '}
              · Next due{' '}
              <time dateTime={due.nextDueDate}>
                {dateFormat.format(new Date(`${due.nextDueDate}T00:00:00Z`))}
              </time>
            </>
          ) : null}
        </p>
        <Link href={`/plants/${plant.id}`} className={styles.action}>
          Manage watering
        </Link>
      </div>
    </li>
  );
}

export function WateringQueuePage({ queue }: { queue: WateringQueue }) {
  const grouped = new Map(
    categories.map(([status]) => [
      status,
      queue.entries.filter((entry) => entry.due.status === status),
    ]),
  );
  const urgent = queue.counts.overdue + queue.counts.dueToday;
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Nursery care</p>
          <h1>Watering</h1>
          <p>Review active Plants and decide which need attention today.</p>
        </div>
      </header>
      <section aria-labelledby="watering-summary-heading" className={styles.summary}>
        <h2 id="watering-summary-heading" className="visually-hidden">
          Watering summary
        </h2>
        <p className={styles.total}>
          <strong>{queue.counts.totalEligible}</strong> active-care Plants in queue
        </p>
        <dl>
          {categories.map(([status, label]) => (
            <div key={status}>
              <dt>{label}</dt>
              <dd>{queue.counts[countKeys[status]]}</dd>
            </div>
          ))}
        </dl>
      </section>
      {queue.entries.length === 0 ? (
        <section className={styles.empty}>
          <h2>No active Plants currently need watering tracking.</h2>
          <p>Add or restore a Plant to begin.</p>
          <Link href="/plants">View Plants</Link>
        </section>
      ) : (
        <>
          {urgent === 0 ? (
            <p className={styles.quiet} role="status">
              No urgent watering tasks today.
            </p>
          ) : null}
          {categories.map(([status, label]) => {
            const entries = grouped.get(status)!;
            return entries.length ? (
              <section
                className={styles.category}
                key={status}
                aria-labelledby={`watering-${status.toLowerCase()}`}
              >
                <h2 id={`watering-${status.toLowerCase()}`}>
                  {label} <span>({entries.length})</span>
                </h2>
                <ul>
                  {entries.map((entry) => (
                    <QueueEntry key={entry.plant.id} entry={entry} />
                  ))}
                </ul>
              </section>
            ) : null;
          })}
        </>
      )}
      {queue.entries.length > 0 && queue.counts.notConfigured === queue.counts.totalEligible ? (
        <p className={styles.note}>
          Watering schedules have not yet been configured for these active Plants.
        </p>
      ) : null}
    </div>
  );
}
