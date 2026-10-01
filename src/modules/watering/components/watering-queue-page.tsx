'use client';

import Link from 'next/link';
import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Droplets, Settings2 } from 'lucide-react';
import { photoImagePath } from '../../plants/plant-photo-browser';
import { PlantPhotoImage } from '../../plants/components/plant-photo-image';
import { plantStatusLabels } from '../../plants/plant-form-state';
import type { WateringQueue } from '../watering-queue-queries';
import type { WateringQueueEntry } from '../watering-queue';
import styles from './watering-queue-page.module.css';
import { initialBatchWateringState } from '../watering-form-state';
import type { recordWateringBatchAction } from '../watering-actions';
import { InlineNotice } from '../../../components/ui/inline-notice';
import { EmptyState } from '../../../components/ui/empty-state';
import { StatusBadge, type StatusBadgeVariant } from '../../../components/ui/status-badge';

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
  if (due.status === 'NEEDS_FIRST_WATERING') return 'No watering recorded yet';
  if (due.status === 'DUE_SOON' || due.status === 'UPCOMING')
    return `Due in ${due.daysUntilDue} days`;
  return 'Watering schedule not configured';
}

function plantStatusVariant(status: WateringQueueEntry['plant']['status']): StatusBadgeVariant {
  if (status === 'QUARANTINE') return 'attention';
  return 'success';
}

function QueueEntry({
  entry,
  selected,
  onToggle,
}: {
  entry: WateringQueueEntry;
  selected: boolean;
  onToggle: (id: string) => void;
}) {
  const { plant, due } = entry;
  const photo = plant.primaryPhoto;
  return (
    <li className={styles.entry} data-selected={selected ? 'true' : undefined}>
      <label className={styles.checkbox}>
        <input
          type="checkbox"
          name="plantIds"
          value={plant.id}
          checked={selected}
          onChange={() => onToggle(plant.id)}
          aria-label={'Select ' + plant.reference + ' for batch watering'}
        />
        <span>{selected ? 'Selected' : 'Select'}</span>
      </label>
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
          <StatusBadge variant={plantStatusVariant(plant.status)}>
            {plantStatusLabels[plant.status]}
          </StatusBadge>
        </div>
        <p className={styles.meta}>
          {plant.reference} · {plant.location?.name || 'No location'}
        </p>
        <p className={styles.due} data-status={due.status}>
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
          <Settings2 aria-hidden="true" size={15} />
          Manage watering
        </Link>
      </div>
    </li>
  );
}

export function WateringQueuePage({
  queue,
  batchAction,
}: {
  queue: WateringQueue;
  batchAction: typeof recordWateringBatchAction;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [locationFilter, setLocationFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [state, formAction, pending] = useActionState(batchAction, initialBatchWateringState);
  useEffect(() => {
    if (state.success) {
      router.refresh();
      const timer = setTimeout(() => {
        setSelected([]);
        setConfirming(false);
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [router, state.success]);
  const locations = Array.from(
    new Map(
      queue.entries
        .filter((entry) => entry.plant.location)
        .map((entry) => [
          entry.plant.location!.id,
          entry.plant.location!.parentName
            ? `${entry.plant.location!.parentName} / ${entry.plant.location!.name}`
            : entry.plant.location!.name,
        ]),
    ),
  ).sort((a, b) => a[1].localeCompare(b[1]) || a[0].localeCompare(b[0]));
  const searchTerm = search.trim().toLocaleLowerCase();
  const visibleEntries = queue.entries.filter((entry) => {
    if (locationFilter === 'none' && entry.plant.location) return false;
    if (
      locationFilter !== 'all' &&
      locationFilter !== 'none' &&
      entry.plant.location?.id !== locationFilter
    )
      return false;
    if (statusFilter !== 'all' && entry.due.status !== statusFilter) return false;
    return (
      !searchTerm ||
      entry.plant.reference.toLocaleLowerCase().includes(searchTerm) ||
      entry.plant.name?.toLocaleLowerCase().includes(searchTerm)
    );
  });
  const visibleIds = new Set(visibleEntries.map((entry) => entry.plant.id));
  const effectiveSelected = selected.filter((id) => visibleIds.has(id));
  const changeFilter = (change: () => void) => {
    change();
    setSelected([]);
    setConfirming(false);
  };
  const toggle = (id: string) =>
    setSelected((current) =>
      current.includes(id)
        ? current.filter((value) => value !== id)
        : current.length >= 100
          ? current
          : [...current, id],
    );
  const clear = () => {
    setSelected([]);
    setConfirming(false);
  };
  const grouped = new Map(
    categories.map(([status]) => [
      status,
      visibleEntries.filter((entry) => entry.due.status === status),
    ]),
  );
  const urgent = queue.counts.overdue + queue.counts.dueToday;
  const nurseryDate = dateFormat.format(new Date(`${queue.nurseryDate}T00:00:00Z`));
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Nursery care</p>
          <h1>Watering</h1>
          <p>{nurseryDate} · Choose the Plants you watered and record them together.</p>
        </div>
      </header>
      <section aria-labelledby="watering-summary-heading" className={styles.summary}>
        <div className={styles.summaryIntro}>
          <span className={styles.summaryIcon} aria-hidden="true">
            {urgent === 0 ? <Check size={24} /> : <Droplets size={24} />}
          </span>
          <div>
            <p className={styles.eyebrow}>Today&apos;s focus</p>
            <h2 id="watering-summary-heading">
              {urgent === 0
                ? 'No urgent watering today'
                : `${urgent} ${urgent === 1 ? 'Plant needs' : 'Plants need'} attention`}
            </h2>
            <p>{queue.counts.totalEligible} active care Plants are being tracked.</p>
          </div>
        </div>
        <dl className={styles.summaryPrimary} aria-label="Watering attention counts">
          {categories.map(([status, label]) =>
            ['OVERDUE', 'DUE_TODAY', 'NEEDS_FIRST_WATERING'].includes(status) ? (
              <div key={status} data-status={status}>
                <dt>{label}</dt>
                <dd>{queue.counts[countKeys[status]]}</dd>
              </div>
            ) : null,
          )}
        </dl>
        <dl className={styles.summarySecondary} aria-label="Other watering counts">
          {categories.map(([status, label]) =>
            !['OVERDUE', 'DUE_TODAY', 'NEEDS_FIRST_WATERING'].includes(status) ? (
              <div key={status}>
                <dt>{label}</dt>
                <dd>{queue.counts[countKeys[status]]}</dd>
              </div>
            ) : null,
          )}
        </dl>
      </section>
      {queue.entries.length > 0 ? (
        <section className={styles.filters} aria-label="Find Plants to water">
          <div className={styles.filterField}>
            <label htmlFor="watering-location">Location</label>
            <select
              id="watering-location"
              value={locationFilter}
              onChange={(event) => changeFilter(() => setLocationFilter(event.target.value))}
            >
              <option value="all">All locations</option>
              {locations.map(([id, name]) => (
                <option value={id} key={id}>
                  {name}
                </option>
              ))}
              <option value="none">No location</option>
            </select>
          </div>
          <div className={styles.filterField}>
            <label htmlFor="watering-status">Watering state</label>
            <select
              id="watering-status"
              value={statusFilter}
              onChange={(event) => changeFilter(() => setStatusFilter(event.target.value))}
            >
              <option value="all">All states</option>
              {categories.map(([status, label]) => (
                <option value={status} key={status}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.filterField}>
            <label htmlFor="watering-search">Plant name or ANT reference</label>
            <input
              id="watering-search"
              type="search"
              value={search}
              onChange={(event) => changeFilter(() => setSearch(event.target.value))}
              placeholder="Find a Plant"
            />
          </div>
          <div className={styles.filterActions}>
            <span>
              Showing {visibleEntries.length} of {queue.entries.length} Plants
            </span>
            <button
              type="button"
              onClick={() => setSelected(visibleEntries.map((entry) => entry.plant.id))}
              disabled={pending || visibleEntries.length === 0 || visibleEntries.length > 100}
            >
              Select visible
            </button>
          </div>
          {visibleEntries.length > 100 ? (
            <p className={styles.filterHelp}>
              Narrow the view to 100 Plants or fewer to select them together.
            </p>
          ) : null}
        </section>
      ) : null}
      {queue.entries.length > 0 &&
      (effectiveSelected.length > 0 || !!state.message || confirming) ? (
        <form
          action={formAction}
          className={`${styles.batchPanel} ${effectiveSelected.length ? styles.batchPanelActive : ''}`}
        >
          {effectiveSelected.map((id) => (
            <input key={id} type="hidden" name="plantIds" value={id} />
          ))}
          <div className={styles.batchToolbar}>
            <strong>
              {effectiveSelected.length} {effectiveSelected.length === 1 ? 'Plant' : 'Plants'}{' '}
              selected
            </strong>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={clear}
              disabled={!effectiveSelected.length}
            >
              Clear selection
            </button>
            <button
              type="button"
              className={styles.primaryButton}
              onClick={() => setConfirming(true)}
              disabled={!effectiveSelected.length || effectiveSelected.length > 100 || pending}
            >
              Water selected
            </button>
          </div>
          {effectiveSelected.length === 100 ? (
            <p className={styles.meta}>The batch limit is 100 Plants.</p>
          ) : null}
          {state.message ? (
            <InlineNotice
              variant={state.success ? 'success' : 'error'}
              role={state.success ? 'status' : 'alert'}
              className={state.success ? styles.success : styles.error}
            >
              {state.message}
            </InlineNotice>
          ) : null}
          {confirming ? (
            <section className={styles.confirmation} aria-labelledby="batch-confirm-heading">
              <h2 id="batch-confirm-heading">
                Water {effectiveSelected.length} selected Plants now?
              </h2>
              <p>
                All selected Plants will be recorded together using one timestamp. If one cannot be
                watered, none will be changed.
              </p>
              <label htmlFor="batch-notes">Shared note (applied to every record, optional)</label>
              <textarea id="batch-notes" name="notes" defaultValue={state.notes} rows={2} />
              <div className={styles.confirmActions}>
                <button type="button" onClick={() => setConfirming(false)} disabled={pending}>
                  Cancel
                </button>
                <button type="submit" className={styles.primaryButton} disabled={pending}>
                  {pending ? 'Recording…' : 'Confirm watering'}
                </button>
              </div>
            </section>
          ) : null}
        </form>
      ) : null}
      {queue.entries.length === 0 ? (
        <EmptyState
          title="No active Plants currently need watering tracking."
          description="Add or restore a Plant to begin."
          action={<Link href="/plants">View Plants</Link>}
        />
      ) : (
        <>
          {urgent === 0 ? (
            <p className={styles.quiet} role="status">
              No urgent watering tasks today.
            </p>
          ) : null}
          {visibleEntries.length === 0 ? (
            <EmptyState
              title="No Plants match these filters."
              description="Try another Location, watering state or search."
              action={
                <button
                  type="button"
                  onClick={() =>
                    changeFilter(() => {
                      setLocationFilter('all');
                      setStatusFilter('all');
                      setSearch('');
                    })
                  }
                >
                  Clear filters
                </button>
              }
            />
          ) : null}
          {categories.map(([status, label]) => {
            const entries = grouped.get(status)!;
            return entries.length ? (
              <section
                className={styles.category}
                data-status={status}
                key={status}
                aria-labelledby={`watering-${status.toLowerCase()}`}
              >
                <h2 id={`watering-${status.toLowerCase()}`}>
                  {label} <span>({entries.length})</span>
                </h2>
                <ul>
                  {entries.map((entry) => (
                    <QueueEntry
                      key={entry.plant.id}
                      entry={entry}
                      selected={effectiveSelected.includes(entry.plant.id)}
                      onToggle={toggle}
                    />
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
