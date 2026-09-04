import Link from 'next/link';
import type { ReactNode } from 'react';
import type { PlantDetailRecord } from '../plant-queries';
import { formatPlantMoney } from '../plant-money';
import { plantStatusLabels } from '../plant-form-state';
import { PlantArchiveControls } from './plant-archive-controls';
import { PlantPhotos } from './plant-photos';
import { formatBreedingCross } from '../../breeding/breeding-provenance';
import type { PlantGalleryPhoto } from '../plant-photo-browser';
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
  return (
    <div className={styles.page}>
      <Link href={plant.archivedAt ? '/plants/archived' : '/plants'} className={styles.backLink}>
        {plant.archivedAt ? '← Archived Plants' : '← Plants'}
      </Link>
      <header className={styles.heading}>
        <p className={styles.eyebrow}>Plant record</p>
        <h1>{plant.reference}</h1>
        <p className={styles.plantName}>{plant.name || 'Unnamed Plant'}</p>
        <div className={styles.badges}>
          <span className={styles.badge}>{plantStatusLabels[plant.status]}</span>
          {plant.archivedAt && <span className={styles.badge}>Archived</span>}
        </div>
      </header>
      <section className={styles.card} aria-labelledby="details-heading">
        <h2 id="details-heading">Plant details</h2>
        <dl className={styles.detailsGrid}>
          <div>
            <dt>Location</dt>
            <dd>{plant.location?.name || 'Not recorded'}</dd>
          </div>
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
      <PlantPhotos
        key={`photos-${plant.id}`}
        plantId={plant.id}
        reference={plant.reference}
        archived={plant.archivedAt !== null}
        expectedUpdatedAt={plant.updatedAt.toISOString()}
        photos={photos}
      />
      {watering}
      {breeding}
      <section className={styles.card} aria-labelledby="parentage-heading">
        <h2 id="parentage-heading">Parentage</h2>
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
            <h3>Breeding origin</h3>
            <p>
              This Plant was promoted from a SeedBatch harvested on{' '}
              <time dateTime={plant.originSeedBatch.harvestedOn.toISOString().slice(0, 10)}>
                {new Intl.DateTimeFormat('en-GB', { dateStyle: 'long', timeZone: 'UTC' }).format(
                  plant.originSeedBatch.harvestedOn,
                )}
              </time>
              .
            </p>
            <p>
              <strong>Cross:</strong>{' '}
              {formatBreedingCross(plant.originSeedBatch.pollinationAttempt.inflorescence.plant, {
                pollenSourceMode: plant.originSeedBatch.pollinationAttempt.pollenSourceMode,
                pollenParent: plant.originSeedBatch.pollinationAttempt.pollenParent,
                pollenParentName: plant.originSeedBatch.pollinationAttempt.pollenParentName,
              })}
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
            <Link href={`/plants/${plant.id}#breeding-heading`}>View breeding history</Link>
          </div>
        )}
      </section>
      <section className={styles.card} aria-labelledby="purchase-heading">
        <h2 id="purchase-heading">Purchase information</h2>
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
      <div className={styles.actions}>
        <Link href={`/plants/${plant.id}/edit`} className={styles.primaryButton}>
          Edit Plant
        </Link>
        <Link href="/plants/new" className={styles.secondaryLink}>
          Add another Plant
        </Link>
        <Link href="/plants" className={styles.secondaryLink}>
          Back to Plants
        </Link>
      </div>
      <PlantArchiveControls
        key={`archive-${plant.id}`}
        plantId={plant.id}
        reference={plant.reference}
        archived={plant.archivedAt !== null}
        expectedUpdatedAt={plant.updatedAt.toISOString()}
      />
    </div>
  );
}
