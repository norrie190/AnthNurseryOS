import Link from 'next/link';
import { formatPurchaseMoney } from '../../../lib/purchase-money';
import type { EquipmentDetailRecord } from '../equipment-queries';
import { EquipmentArchiveControls } from './equipment-archive-controls';
import styles from './equipment-management.module.css';

const timestamp = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Europe/London',
});
const calendarDate = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' });
export function EquipmentDetail({ equipment }: { equipment: EquipmentDetailRecord }) {
  const purchase = equipment.purchase;
  const details = [
    ['Category', equipment.category],
    ['Brand', equipment.brand ?? 'Not recorded'],
    ['Model', equipment.model ?? 'Not recorded'],
    ['Serial number', equipment.serialNumber ?? 'Not recorded'],
    ['Uses power', equipment.usesPower ? 'Yes' : 'No'],
    [
      'Location',
      equipment.location
        ? `${equipment.location.name}${equipment.location.archivedAt ? ' (archived)' : ''}`
        : 'No location',
    ],
  ];
  return (
    <div className={styles.page}>
      <Link
        className={styles.backLink}
        href={equipment.archivedAt ? '/equipment/archived' : '/equipment'}
      >
        ← {equipment.archivedAt ? 'Archived Equipment' : 'Equipment'}
      </Link>
      <header className={styles.header}>
        <div className={styles.heading}>
          <p className={styles.eyebrow}>Equipment inventory</p>
          <h1>{equipment.reference}</h1>
          <p>{equipment.name}</p>
          {equipment.archivedAt && (
            <p>
              <span className={styles.badge}>Archived</span>{' '}
              <time dateTime={equipment.archivedAt.toISOString()}>
                {timestamp.format(equipment.archivedAt)}
              </time>
            </p>
          )}
        </div>
        <Link href={`/equipment/${equipment.id}/edit`} className={styles.primaryButton}>
          Edit Equipment
        </Link>
      </header>
      <section className={styles.card} aria-labelledby="equipment-details-heading">
        <h2 id="equipment-details-heading">Equipment details</h2>
        <dl className={styles.detailsGrid}>
          {details.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
          <div className={styles.fullWidth}>
            <dt>Notes</dt>
            <dd className={styles.notes}>{equipment.notes ?? 'Not recorded'}</dd>
          </div>
          {(['createdAt', 'updatedAt'] as const).map((field) => (
            <div key={field}>
              <dt>{field === 'createdAt' ? 'Created' : 'Last updated'} (UK time)</dt>
              <dd>
                <time dateTime={equipment[field].toISOString()}>
                  {timestamp.format(equipment[field])}
                </time>
              </dd>
            </div>
          ))}
        </dl>
        <p className={styles.hint}>
          Uses power describes capability for electrical consumption tracking, not whether the item
          is currently switched on.
        </p>
      </section>
      <section className={styles.card} aria-labelledby="equipment-purchase-heading">
        <h2 id="equipment-purchase-heading">Purchase information</h2>
        {purchase ? (
          <>
            <dl className={styles.detailsGrid}>
              {[
                ['Seller', purchase.seller ?? 'Not recorded'],
                ['Order reference', purchase.orderReference ?? 'Not recorded'],
                [
                  'Purchase date',
                  purchase.purchaseDate
                    ? calendarDate.format(purchase.purchaseDate)
                    : 'Not recorded',
                ],
                ['Currency', purchase.currency],
                [
                  'Equipment price',
                  formatPurchaseMoney(purchase.equipmentPriceMinor, purchase.currency),
                ],
                [
                  'Allocated shipping cost',
                  formatPurchaseMoney(purchase.shippingCostMinor, purchase.currency),
                ],
                ['Other cost', formatPurchaseMoney(purchase.otherCostMinor, purchase.currency)],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            <p className={styles.hint}>
              Shipping is the amount allocated to this item, not necessarily the whole order.
            </p>
          </>
        ) : (
          <p className={styles.sectionIntro}>No purchase information recorded.</p>
        )}
      </section>
      <EquipmentArchiveControls
        equipmentId={equipment.id}
        reference={equipment.reference}
        archived={equipment.archivedAt !== null}
        expectedUpdatedAt={equipment.updatedAt.toISOString()}
      />
    </div>
  );
}
