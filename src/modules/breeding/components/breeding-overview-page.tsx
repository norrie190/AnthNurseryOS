import Link from 'next/link';
import { ArrowRight, ArrowUpRight, Dna, Flower2, Sprout } from 'lucide-react';
import type { ReactNode } from 'react';
import type { BreedingAttentionItem, BreedingOverview } from '../breeding-overview-queries';
import styles from './breeding-overview-page.module.css';
import { EmptyState } from '../../../components/ui/empty-state';
import { StatusBadge, type StatusBadgeVariant } from '../../../components/ui/status-badge';

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

function statusVariant(status: string): StatusBadgeVariant {
  if (status === 'FAILED' || status === 'ABORTED') return 'danger';
  if (status === 'PENDING' || status === 'OPEN' || status === 'HARVESTED') return 'attention';
  return 'info';
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
  const icon =
    item.type === 'INFLORESCENCE' ? (
      <Flower2 size={22} />
    ) : item.type === 'POLLINATION' ? (
      <Dna size={22} />
    ) : (
      <Sprout size={22} />
    );
  return (
    <li className={styles.attentionItem}>
      <Link href={`/plants/${item.plant.id}`} className={styles.attentionLink}>
        <span className={styles.itemIcon} aria-hidden="true">
          {icon}
        </span>
        <span className={styles.itemBody}>
          <span className={styles.itemTopline}>
            <strong>{item.plant.reference}</strong>
            <span className={styles.type}>{typeLabel(item)}</span>
          </span>
          <span className={styles.itemTitle}>
            <StatusBadge variant={statusVariant(item.status)}>{workflowLabel(item)}</StatusBadge>
          </span>
          <span className={styles.itemName}>{displayName(item)}</span>
          <span className={styles.itemMeta}>
            {formatDate(item.relevantDate)}
            {item.plant.locationName ? ` · Location: ${item.plant.locationName}` : ''} · Plant:{' '}
            {lifecycle(item)}
          </span>
          {item.type !== 'INFLORESCENCE' && <span className={styles.itemCross}>{item.cross}</span>}
          {item.type === 'SEED_BATCH' && (
            <span className={styles.itemMeta}>{seedDescription(item)}</span>
          )}
        </span>
        <ArrowUpRight className={styles.itemArrow} size={18} aria-hidden="true" />
      </Link>
    </li>
  );
}

function CountGroup({
  title,
  icon,
  step,
  primary,
  entries,
}: {
  title: string;
  icon: ReactNode;
  step: string;
  primary: { label: string; value: number };
  entries: readonly { label: string; value: number }[];
}) {
  return (
    <div className={styles.summaryCard}>
      <div className={styles.summaryHeading}>
        <span className={styles.summaryIcon} aria-hidden="true">
          {icon}
        </span>
        <div>
          <span>{step}</span>
          <h3>{title}</h3>
        </div>
      </div>
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
    </div>
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
  const activeSeedBatches =
    overview.awaitingSowing + overview.awaitingGermination + overview.activelyGerminating;
  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>Your breeding programme</p>
          <h1>Breeding overview</h1>
          <p>Follow flowers, crosses and seed batches through one connected nursery workflow.</p>
        </div>
        <Link className={styles.plantLink} href="/plants">
          Open Plant collection <ArrowRight size={16} aria-hidden="true" />
        </Link>
      </header>

      <section className={styles.hero} aria-labelledby="breeding-focus-heading">
        <div>
          <p className={styles.heroEyebrow}>Breeding focus</p>
          <h2 id="breeding-focus-heading">
            {overview.attention.length
              ? `${overview.attention.length} ${overview.attention.length === 1 ? 'item needs' : 'items need'} attention`
              : 'Everything is up to date'}
          </h2>
          <p>
            The queue is ordered by the next useful nursery action, with the oldest work shown
            first.
          </p>
        </div>
        <dl className={styles.heroCounts}>
          <div>
            <dt>Active flowers</dt>
            <dd>{overview.activeInflorescences}</dd>
          </div>
          <div>
            <dt>Active crosses</dt>
            <dd>{overview.activePollinations}</dd>
          </div>
          <div>
            <dt>Seed batches in progress</dt>
            <dd>{activeSeedBatches}</dd>
          </div>
        </dl>
      </section>

      <section className={styles.section} aria-labelledby="breeding-summary-heading">
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.eyebrow}>Current records</p>
            <h2 id="breeding-summary-heading">Breeding pipeline</h2>
          </div>
        </div>
        <div className={styles.summaryGrid}>
          <CountGroup
            title="Inflorescences"
            icon={<Flower2 size={21} />}
            step="Stage 01"
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
            icon={<Dna size={21} />}
            step="Stage 02"
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
            icon={<Sprout size={21} />}
            step="Stage 03"
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
          <EmptyState
            title="No breeding records yet."
            description="Record breeding activity from an individual Plant."
            action={<Link href="/plants">View Plants</Link>}
          />
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
