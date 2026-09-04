import Link from 'next/link';
import type { ReactNode } from 'react';
import { LocalSectionNav } from '@/components/ui/local-section-nav';
import { StatusBadge, type StatusBadgeVariant } from '@/components/ui/status-badge';
import type { PlantDetailRecord } from '../plant-queries';
import { formatPlantMoney } from '../plant-money';
import { plantStatusLabels } from '../plant-form-state';
import { PlantArchiveControls } from './plant-archive-controls';
import { PlantPhotoImage } from './plant-photo-image';
import { PlantPhotos } from './plant-photos';
import { formatBreedingCross } from '../../breeding/breeding-provenance';
import type { PlantGalleryPhoto } from '../plant-photo-browser';
import { photoImagePath } from '../plant-photo-browser';
import styles from './plant-management.module.css';

const seedBatchStatusLabels: Record<string, string> = {
  HARVESTED: 'Harvested',
  AWAITING_GERMINATION: 'Awaiting germination',
  GERMINATING: 'Germinating',
  EXHAUSTED: 'Exhausted',
  FAILED: 'Failed',
};

function ParentValue({
  linked,
  external,
}: {
  linked: { id: string; reference: string; name: string | null } | null | undefined;
  external: string | null | undefined;
}) {
  return linked ? (
    <Link href={`/plants/${linked.id}`}>
      {linked.reference} — {linked.name || 'Unnamed Plant'}
    </Link>
  ) : (
    <>{external || 'Unknown'}</>
  );
}

export function PlantDetail({
  plant,
  photos = [],
  watering,
  breeding,
}: {
  plant: PlantDetailRecord;
  photos?: readonly PlantGalleryPhoto[];
  watering?: ReactNode;
  breeding?: ReactNode;
}) {
  const purchase = plant.purchase;
  const primaryPhoto = photos.find((photo) => photo.isPrimary);
  return (
    <div className={styles.page}>
      <Link href={plant.archivedAt ? '/plants/archived' : '/plants'} className={styles.backLink}>
        {plant.archivedAt ? '← Archived Plants' : '← Plants'}
      </Link>
      <header className={styles.identityHeader}>
        <div className={styles.identityPhoto}>
          <PlantPhotoImage
            src={primaryPhoto ? photoImagePath(plant.id, primaryPhoto.id, 'display') : undefined}
            alt={primaryPhoto?.caption || `${plant.reference} primary photo`}
            prominent
          />
        </div>
        <div className={styles.identityContent}>
          <p className={styles.eyebrow}>Plant record</p>
          <h1>{plant.name || 'Unnamed Plant'}</h1>
          <p className={styles.reference}>{plant.reference}</p>
          <div className={styles.badges}>
            <StatusBadge variant={plantStatusVariant(plant.status)}>
              {plantStatusLabels[plant.status]}
            </StatusBadge>
            {plant.archivedAt && <StatusBadge>Archived</StatusBadge>}
          </div>
          <dl className={styles.identityMeta}>
            <div>
              <dt>Location</dt>
              <dd>{plant.location?.name || 'Not recorded'}</dd>
            </div>
            {plant.archivedAt && (
              <div>
                <dt>Collection</dt>
                <dd>Archived record</dd>
              </div>
            )}
          </dl>
          <div className={styles.identityActions}>
            <Link href={`/plants/${plant.id}/edit`} className={styles.primaryButton}>
              Edit Plant
            </Link>
          </div>
        </div>
      </header>
      <LocalSectionNav
        ariaLabel="Plant detail sections"
        items={[
          { href: '#overview', label: 'Overview' },
          { href: '#care', label: 'Care' },
          { href: '#breeding', label: 'Breeding' },
          { href: '#photos', label: 'Photos' },
          { href: '#history', label: 'History' },
        ]}
      />

      <section id="overview" className={styles.pageSection} aria-labelledby="overview-heading">
        <div className={styles.sectionHeading}>
          <p className={styles.eyebrow}>Plant overview</p>
          <h2 id="overview-heading">Overview</h2>
        </div>
        <div className={styles.overviewGrid}>
          <section className={styles.subsection} aria-labelledby="details-heading">
            <h3 id="details-heading">Plant details</h3>
            <dl className={styles.detailsGrid}>
              <div>
                <dt>Created</dt>
                <dd>
                  <time dateTime={plant.createdAt.toISOString()}>
                    {new Intl.DateTimeFormat('en-GB', {
                      dateStyle: 'long',
                      timeZone: 'Europe/London',
                    }).format(plant.createdAt)}
                  </time>
                </dd>
              </div>
              <div className={styles.fullWidth}>
                <dt>Notes</dt>
                <dd className={styles.notes}>{plant.notes || 'Not recorded'}</dd>
              </div>
              {plant.archivedAt && (
                <div>
                  <dt>Archived</dt>
                  <dd>
                    <time dateTime={plant.archivedAt.toISOString()}>
                      {new Intl.DateTimeFormat('en-GB', {
                        dateStyle: 'long',
                        timeZone: 'Europe/London',
                      }).format(plant.archivedAt)}
                    </time>
                  </dd>
                </div>
              )}
            </dl>
          </section>

          <section className={styles.subsection} aria-labelledby="parentage-heading">
            <h3 id="parentage-heading">Parentage</h3>
            <dl className={styles.detailsGrid}>
              <div>
                <dt>Seed parent</dt>
                <dd>
                  <ParentValue
                    linked={plant.parentage?.seedParent}
                    external={plant.parentage?.seedParentName}
                  />
                </dd>
              </div>
              <div>
                <dt>Pollen parent</dt>
                <dd>
                  <ParentValue
                    linked={plant.parentage?.pollenParent}
                    external={plant.parentage?.pollenParentName}
                  />
                </dd>
              </div>
            </dl>
            {plant.originSeedBatch && (
              <div className={styles.origin}>
                <h4>Breeding origin</h4>
                <p>
                  This Plant was promoted from a SeedBatch harvested on{' '}
                  <time dateTime={plant.originSeedBatch.harvestedOn.toISOString().slice(0, 10)}>
                    {new Intl.DateTimeFormat('en-GB', {
                      dateStyle: 'long',
                      timeZone: 'UTC',
                    }).format(plant.originSeedBatch.harvestedOn)}
                  </time>
                  .
                </p>
                <p>
                  <strong>Cross:</strong>{' '}
                  {formatBreedingCross(
                    plant.originSeedBatch.pollinationAttempt.inflorescence.plant,
                    {
                      pollenSourceMode: plant.originSeedBatch.pollinationAttempt.pollenSourceMode,
                      pollenParent: plant.originSeedBatch.pollinationAttempt.pollenParent,
                      pollenParentName: plant.originSeedBatch.pollinationAttempt.pollenParentName,
                    },
                  )}
                </p>
                {plant.originSeedBatch.pollinationAttempt.pollenBreeder && (
                  <p>Breeder/source: {plant.originSeedBatch.pollinationAttempt.pollenBreeder}</p>
                )}
                {plant.originSeedBatch.pollinationAttempt.pollenCultivar && (
                  <p>Cultivar/clone: {plant.originSeedBatch.pollinationAttempt.pollenCultivar}</p>
                )}
                {plant.originSeedBatch.pollinationAttempt.pollenSourceMode === 'UNKNOWN' && (
                  <p>Unknown pollen parent</p>
                )}
                <p>SeedBatch status: {seedBatchStatusLabels[plant.originSeedBatch.status]}</p>
                <Link href={`/plants/${plant.id}#breeding`}>View breeding history</Link>
              </div>
            )}
          </section>

          <section
            className={`${styles.subsection} ${styles.purchaseSection}`}
            aria-labelledby="purchase-heading"
          >
            <h3 id="purchase-heading">Purchase information</h3>
            {purchase ? (
              <dl className={styles.detailsGrid}>
                <div>
                  <dt>Seller</dt>
                  <dd>{purchase.seller || 'Not recorded'}</dd>
                </div>
                <div>
                  <dt>Order reference</dt>
                  <dd>{purchase.orderReference || 'Not recorded'}</dd>
                </div>
                <div>
                  <dt>Purchase date</dt>
                  <dd>
                    {purchase.purchaseDate ? (
                      <time dateTime={purchase.purchaseDate.toISOString().slice(0, 10)}>
                        {new Intl.DateTimeFormat('en-GB', {
                          dateStyle: 'long',
                          timeZone: 'UTC',
                        }).format(purchase.purchaseDate)}
                      </time>
                    ) : (
                      'Not recorded'
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Currency</dt>
                  <dd>{purchase.currency}</dd>
                </div>
                <div>
                  <dt>Plant price</dt>
                  <dd>{formatPlantMoney(purchase.plantPriceMinor, purchase.currency)}</dd>
                </div>
                <div>
                  <dt>Shipping cost</dt>
                  <dd>{formatPlantMoney(purchase.shippingCostMinor, purchase.currency)}</dd>
                </div>
                <div>
                  <dt>Other cost</dt>
                  <dd>{formatPlantMoney(purchase.otherCostMinor, purchase.currency)}</dd>
                </div>
              </dl>
            ) : (
              <p className={styles.hint}>No purchase recorded.</p>
            )}
          </section>
        </div>
      </section>
      <section id="care" className={styles.pageSection} aria-labelledby="care-heading">
        <div className={styles.sectionHeading}>
          <p className={styles.eyebrow}>Current care</p>
          <h2 id="care-heading">Care</h2>
        </div>
        {watering}
      </section>
      <section
        id="breeding"
        className={styles.pageSection}
        aria-labelledby="breeding-shell-heading"
      >
        <div className={styles.sectionHeading}>
          <p className={styles.eyebrow}>Breeding records</p>
          <h2 id="breeding-shell-heading">Breeding records</h2>
        </div>
        {breeding}
      </section>
      <div id="photos" className={styles.pageSection}>
        <PlantPhotos
          key={`photos-${plant.id}`}
          plantId={plant.id}
          reference={plant.reference}
          archived={plant.archivedAt !== null}
          expectedUpdatedAt={plant.updatedAt.toISOString()}
          photos={photos}
        />
      </div>
      <section id="history" className={styles.pageSection} aria-labelledby="history-heading">
        <div className={styles.sectionHeading}>
          <p className={styles.eyebrow}>Retained Plant history</p>
          <h2 id="history-heading">History</h2>
        </div>
        <p className={styles.sectionIntro}>
          Plant-level visibility and maintenance actions are kept here. Watering and Breeding
          histories remain with their operational sections.
        </p>
        <PlantArchiveControls
          key={`archive-${plant.id}`}
          plantId={plant.id}
          reference={plant.reference}
          archived={plant.archivedAt !== null}
          expectedUpdatedAt={plant.updatedAt.toISOString()}
        />
      </section>
      <div className={styles.actions}>
        <Link href="/plants/new" className={styles.secondaryLink}>
          Add another Plant
        </Link>
        <Link href="/plants" className={styles.secondaryLink}>
          Back to Plants
        </Link>
      </div>
    </div>
  );
}

function plantStatusVariant(status: keyof typeof plantStatusLabels): StatusBadgeVariant {
  if (status === 'GROWING') return 'success';
  if (status === 'QUARANTINE') return 'attention';
  return 'neutral';
}
