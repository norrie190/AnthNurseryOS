import Link from 'next/link';
import type { PlantDetailRecord } from '../plant-queries';
import { formatPlantMoney } from '../plant-money';
import { plantStatusLabels } from '../plant-form-state';
import styles from './plant-management.module.css';

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

export function PlantDetail({ plant }: { plant: PlantDetailRecord }) {
  const purchase = plant.purchase;
  return (
    <div className={styles.page}>
      <Link href="/plants" className={styles.backLink}>
        ← Plants
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
        </dl>
      </section>
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
        <Link href="/plants/new" className={styles.primaryButton}>
          Add another Plant
        </Link>
        <Link href="/plants" className={styles.secondaryLink}>
          Back to Plants
        </Link>
      </div>
    </div>
  );
}
