import Link from 'next/link';
import type { BreedingAttentionItem, BreedingOverview } from '../breeding-overview-queries';
import styles from './breeding-overview-page.module.css';

const dateFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

const inflorescenceStatus = {
  OBSERVED: 'Observed',
  OPEN: 'Open',
  FINISHED: 'Finished',
  ABORTED: 'Aborted',
} as const;
const pollinationStatus = {
  PENDING: 'Pending',
  DEVELOPING: 'Developing',
  FAILED: 'Failed',
  HARVESTED: 'Harvested',
} as const;
const seedBatchStatus = {
  HARVESTED: 'Harvested',
  AWAITING_GERMINATION: 'Awaiting germination',
  GERMINATING: 'Germinating',
  EXHAUSTED: 'Exhausted',
  FAILED: 'Failed',
} as const;

function formatDate(value: Date) {
  return dateFormat.format(value);
}

function displayName(item: BreedingAttentionItem) {
  return item.plant.name?.trim() || 'Unnamed Plant';
}

function lifecycle(item: BreedingAttentionItem) {
  return item.plant.archivedAt ? `${item.plant.status} · Archived` : item.plant.status;
}

function workflowLabel(item: BreedingAttentionItem) {
  if (item.type === 'INFLORESCENCE') return 'Open inflorescence awaiting pollination';
  if (item.type === 'POLLINATION') {
    return item.status === 'PENDING' ? 'Pollination pending' : 'Cross developing';
  }
  if (item.status === 'HARVESTED') return 'Seed batch awaiting sowing';
  return seedBatchStatus[item.status];
}

function typeLabel(item: BreedingAttentionItem) {
  if (item.type === 'INFLORESCENCE') return 'Inflorescence';
  if (item.type === 'POLLINATION') return 'Pollination';
  return 'Seed batch';
}

function seedDescription(item: Extract<BreedingAttentionItem, { type: 'SEED_BATCH' }>) {
  const seeds = item.seedCount === null ? 'Seed count unknown' : `${item.seedCount} seeds`;
  const germination =
    item.germinatedCount === null
      ? 'Germination not counted'
      : `${item.germinatedCount} germinated`;
  return `${seeds} · ${germination}`;
}

function AttentionItem({ item }: { item: BreedingAttentionItem }) {
  return (
    <li className={styles.attentionItem}>
      <Link href={`/plants/${item.plant.id}`} className={styles.attentionLink}>
        <span className={styles.itemTopline}>
          <strong>{item.plant.reference}</strong>
          <span className={styles.type}>{typeLabel(item)}</span>
        </span>
        <span className={styles.itemTitle}>{workflowLabel(item)}</span>
        <span className={styles.itemMeta}>
          {displayName(item)} · {formatDate(item.relevantDate)}
        </span>
        <span className={styles.itemMeta}>
          {item.plant.locationName ? `Location: ${item.plant.locationName} · ` : ''}
          Plant: {lifecycle(item)}
        </span>
        {item.type !== 'INFLORESCENCE' && <span className={styles.itemMeta}>{item.cross}</span>}
        {item.type === 'SEED_BATCH' && (
          <span className={styles.itemMeta}>{seedDescription(item)}</span>
        )}
      </Link>
    </li>
  );
}

function CountGroup({
  title,
  primary,
  entries,
}: {
  title: string;
  primary: { label: string; value: number };
  entries: readonly { label: string; value: number }[];
}) {
  return (
    <article className={styles.summaryCard}>
      <h3>{title}</h3>
      <p className={styles.primaryCount}>
        <strong>{primary.value}</strong>
        <span>{primary.label}</span>
      </p>
      <dl className={styles.counts}>
        {entries.map((entry) => (
          <div key={entry.label}>
            <dt>{entry.label}</dt>
            <dd>{entry.value}</dd>
          </div>
        ))}
      </dl>
    </article>
  );
}

function hasRecords(overview: BreedingOverview) {
  return (
    Object.values(overview.inflorescences).some(Boolean) ||
    Object.values(overview.pollinationAttempts).some(Boolean) ||
    Object.values(overview.seedBatches).some(Boolean)
  );
}

export function BreedingOverviewPage({ overview }: { overview: BreedingOverview }) {
  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <p className={styles.eyebrow}>Nursery operations</p>
        <h1>Breeding overview</h1>
        <p>See active breeding work across the nursery and follow each item back to its Plant.</p>
      </header>

      <section className={styles.section} aria-labelledby="breeding-summary-heading">
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.eyebrow}>Current records</p>
            <h2 id="breeding-summary-heading">Summary</h2>
          </div>
        </div>
        <div className={styles.summaryGrid}>
          <CountGroup
            title="Inflorescences"
            primary={{ label: 'active', value: overview.activeInflorescences }}
            entries={[
              { label: inflorescenceStatus.OBSERVED, value: overview.inflorescences.OBSERVED },
              { label: inflorescenceStatus.OPEN, value: overview.inflorescences.OPEN },
              { label: inflorescenceStatus.FINISHED, value: overview.inflorescences.FINISHED },
              { label: inflorescenceStatus.ABORTED, value: overview.inflorescences.ABORTED },
            ]}
          />
          <CountGroup
            title="Pollination"
            primary={{ label: 'active', value: overview.activePollinations }}
            entries={[
              { label: pollinationStatus.PENDING, value: overview.pollinationAttempts.PENDING },
              {
                label: pollinationStatus.DEVELOPING,
                value: overview.pollinationAttempts.DEVELOPING,
              },
              { label: pollinationStatus.FAILED, value: overview.pollinationAttempts.FAILED },
              { label: pollinationStatus.HARVESTED, value: overview.pollinationAttempts.HARVESTED },
            ]}
          />
          <CountGroup
            title="Seed batches"
            primary={{ label: 'awaiting sowing', value: overview.awaitingSowing }}
            entries={[
              { label: 'Awaiting germination', value: overview.awaitingGermination },
              { label: 'Germinating', value: overview.activelyGerminating },
              { label: seedBatchStatus.EXHAUSTED, value: overview.seedBatches.EXHAUSTED },
              { label: seedBatchStatus.FAILED, value: overview.seedBatches.FAILED },
            ]}
          />
        </div>
      </section>

      <section className={styles.section} aria-labelledby="breeding-attention-heading">
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.eyebrow}>Next actions</p>
            <h2 id="breeding-attention-heading">Breeding attention</h2>
          </div>
          <span className={styles.bound}>Up to 10 items</span>
        </div>
        {!hasRecords(overview) ? (
          <div className={styles.emptyState}>
            <h3>No breeding records yet.</h3>
            <p>Record breeding activity from an individual Plant.</p>
            <Link href="/plants" className={styles.textLink}>
              View Plants
            </Link>
          </div>
        ) : overview.attention.length === 0 ? (
          <p className={styles.quiet} role="status">
            No active breeding tasks right now.
          </p>
        ) : (
          <ol className={styles.attentionList}>
            {overview.attention.map((item) => (
              <AttentionItem key={`${item.type}-${item.id}`} item={item} />
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
