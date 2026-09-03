import Link from 'next/link';
import {
  AlertTriangle,
  ArrowRight,
  Droplets,
  Leaf,
  PlugZap,
  ReceiptText,
  Wrench,
} from 'lucide-react';
import { formatPurchaseMoney } from '../../../lib/purchase-money';
import { EquipmentPhotoImage } from '../../equipment/components/equipment-photo-image';
import { equipmentPhotoImagePath } from '../../equipment/equipment-photo-browser';
import { formatGbp } from '../../energy/energy-calculations';
import { compactDecimal } from '../../energy/energy-browser';
import { decimalToScaled } from '../../energy/energy-input';
import { PlantPhotoImage } from '../../plants/components/plant-photo-image';
import { photoImagePath } from '../../plants/plant-photo-browser';
import type {
  DashboardSummary,
  InvestmentCurrencySummary,
  InvestmentDomainSummary,
} from '../dashboard-summary';
import styles from './dashboard.module.css';

const dateFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'Europe/London',
});

function formatInvestment(value: number | null, currency: string) {
  return value === null ? 'Unknown' : formatPurchaseMoney(value, currency);
}

function formatDomainInvestment(summary: InvestmentCurrencySummary | undefined, currency: string) {
  return summary ? formatInvestment(summary.knownSpendSubtotalMinor, currency) : 'No records';
}

function formatEnergyCost(value: string | null) {
  return value === null ? 'Unknown' : formatGbp(decimalToScaled(value, 12));
}

function currencySummary(
  domain: InvestmentDomainSummary,
  currency: string,
): InvestmentCurrencySummary | undefined {
  return domain.byCurrency.find((summary) => summary.currency === currency);
}

function coverageSentence(label: string, summary: InvestmentDomainSummary) {
  if (summary.relevantRecordCount === 0) return `No ${label} records to cost yet.`;
  return `${summary.completeCostRecordCount} of ${summary.relevantRecordCount} ${label} records have complete cost information.`;
}

function wateringState(
  item: DashboardSummary['watering'] extends infer W
    ? W extends { attention: (infer A)[] }
      ? A
      : never
    : never,
) {
  if (item.status === 'OVERDUE') return Math.abs(item.daysUntilDue ?? 0) + ' days overdue';
  if (item.status === 'DUE_TODAY') return 'Due today';
  return 'First watering not recorded';
}

function Watering({ summary }: { summary: DashboardSummary }) {
  const watering = summary.watering;
  if (!watering) return null;
  const urgent = watering.overdue + watering.dueToday + watering.needsFirstWatering;
  return (
    <section className={styles.section} aria-labelledby="watering-heading">
      <div className={styles.sectionHeading}>
        <div>
          <p className={styles.eyebrow}>Daily care</p>
          <h2 id="watering-heading">Watering overview</h2>
        </div>
        <Droplets aria-hidden="true" size={22} />
      </div>
      {watering.totalEligible === 0 ? (
        <div className={styles.emptyState}>
          <h3>No active Plants need watering tracking</h3>
          <p>Active Growing and Quarantine Plants will appear here once available.</p>
          <Link className={styles.textLink} href="/plants">
            View Plants <ArrowRight aria-hidden="true" size={15} />
          </Link>
        </div>
      ) : (
        <>
          <dl className={styles.wateringMetrics}>
            <div>
              <dt>Overdue</dt>
              <dd>{watering.overdue}</dd>
            </div>
            <div>
              <dt>Due today</dt>
              <dd>{watering.dueToday}</dd>
            </div>
            <div>
              <dt>Needs first watering</dt>
              <dd>{watering.needsFirstWatering}</dd>
            </div>
            <div>
              <dt>Due soon</dt>
              <dd>{watering.dueSoon}</dd>
            </div>
            <div>
              <dt>Not configured</dt>
              <dd>{watering.notConfigured}</dd>
            </div>
          </dl>
          {urgent === 0 ? (
            <p className={styles.wateringQuiet} role="status">
              No urgent watering tasks today.
            </p>
          ) : null}
          {watering.dueSoon || watering.notConfigured ? (
            <p className={styles.cardNote}>
              {watering.dueSoon ? watering.dueSoon + ' due soon' : ''}
              {watering.dueSoon && watering.notConfigured ? ' · ' : ''}
              {watering.notConfigured ? watering.notConfigured + ' not configured' : ''}
            </p>
          ) : null}
          {watering.attention.length ? (
            <ul className={styles.wateringAttention} aria-label="Watering attention Plants">
              {watering.attention.map((item) => (
                <li key={item.id}>
                  <Link href={'/plants/' + item.id}>
                    <span className={styles.thumbnail}>
                      <PlantPhotoImage
                        src={
                          item.primaryPhoto
                            ? photoImagePath(
                                item.id,
                                item.primaryPhoto.id,
                                'thumbnail',
                                item.primaryPhoto.derivativeRevision,
                              )
                            : undefined
                        }
                        alt={item.reference + ' primary photo'}
                      />
                    </span>
                    <span className={styles.recentDetails}>
                      <strong>{item.displayName}</strong>
                      <span>
                        {item.reference}
                        {item.location ? ' · ' + item.location.name : ''}
                      </span>
                      <span>{wateringState(item)}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.wateringQuiet}>Nothing needs immediate watering attention.</p>
          )}
          <Link className={styles.textLink} href="/watering">
            View watering queue <ArrowRight aria-hidden="true" size={15} />
          </Link>
        </>
      )}
    </section>
  );
}

function Overview({ summary }: { summary: DashboardSummary }) {
  return (
    <section className={styles.section} aria-labelledby="overview-heading">
      <div className={styles.sectionHeading}>
        <div>
          <p className={styles.eyebrow}>At a glance</p>
          <h2 id="overview-heading">Nursery overview</h2>
        </div>
      </div>

      <div className={styles.overviewGrid}>
        <article className={styles.overviewCard}>
          <div className={styles.cardTitle}>
            <span className={styles.icon} aria-hidden="true">
              <Leaf size={19} />
            </span>
            <h3>Plants</h3>
          </div>
          <p className={styles.primaryMetric}>
            <strong>{summary.plants.activeCount}</strong>
            <span>active</span>
          </p>
          <dl className={styles.countGrid}>
            <div>
              <dt>Growing</dt>
              <dd>{summary.plants.growingCount}</dd>
            </div>
            <div>
              <dt>Quarantine</dt>
              <dd>{summary.plants.quarantineCount}</dd>
            </div>
            <div>
              <dt>Sold</dt>
              <dd>{summary.plants.soldCount}</dd>
            </div>
            <div>
              <dt>Deceased</dt>
              <dd>{summary.plants.deceasedCount}</dd>
            </div>
            <div>
              <dt>Archived</dt>
              <dd>{summary.plants.archivedCount}</dd>
            </div>
          </dl>
          <Link className={styles.textLink} href="/plants">
            View Plants <ArrowRight aria-hidden="true" size={15} />
          </Link>
        </article>

        <article className={styles.overviewCard}>
          <div className={styles.cardTitle}>
            <span className={styles.icon} aria-hidden="true">
              <Wrench size={19} />
            </span>
            <h3>Equipment</h3>
          </div>
          <p className={styles.primaryMetric}>
            <strong>{summary.equipment.activeCount}</strong>
            <span>active</span>
          </p>
          <dl className={styles.countGrid}>
            <div>
              <dt>Power tracking capable</dt>
              <dd>{summary.equipment.activeUsesPowerCount}</dd>
            </div>
            <div>
              <dt>Does not use power</dt>
              <dd>{summary.equipment.activeDoesNotUsePowerCount}</dd>
            </div>
            <div>
              <dt>Archived</dt>
              <dd>{summary.equipment.archivedCount}</dd>
            </div>
          </dl>
          <p className={styles.cardNote}>
            Power tracking capability does not mean an item is currently operating.
          </p>
          <Link className={styles.textLink} href="/equipment">
            View Equipment <ArrowRight aria-hidden="true" size={15} />
          </Link>
        </article>
      </div>
    </section>
  );
}

function Investment({ summary }: { summary: DashboardSummary }) {
  const currencies = summary.investment.combinedByCurrency;
  const plantsComplete = summary.investment.plants.coverageComplete;
  const equipmentComplete = summary.investment.equipment.coverageComplete;

  return (
    <section className={styles.section} aria-labelledby="investment-heading">
      <div className={styles.sectionHeading}>
        <div>
          <p className={styles.eyebrow}>Acquisition costs</p>
          <h2 id="investment-heading">Investment</h2>
        </div>
        <ReceiptText aria-hidden="true" size={22} />
      </div>

      {currencies.length === 0 ? (
        <div className={styles.emptyState}>
          <h3>No acquisition costs recorded</h3>
          <p>Known Plant and Equipment purchase costs will be summarised here by currency.</p>
        </div>
      ) : (
        <div className={styles.currencyList}>
          {currencies.map((combined) => {
            const plants = currencySummary(summary.investment.plants, combined.currency);
            const equipment = currencySummary(summary.investment.equipment, combined.currency);
            const combinedComplete = plantsComplete && equipmentComplete;
            return (
              <article className={styles.currencyRow} key={combined.currency}>
                <header>
                  <h3>{combined.currency}</h3>
                  <span>
                    {combinedComplete ? 'Cost records complete' : 'Incomplete cost records'}
                  </span>
                </header>
                <dl className={styles.investmentMetrics}>
                  <div>
                    <dt>{plantsComplete ? 'Plant spend' : 'Known Plant spend'}</dt>
                    <dd>{formatDomainInvestment(plants, combined.currency)}</dd>
                  </div>
                  <div>
                    <dt>{equipmentComplete ? 'Equipment spend' : 'Known Equipment spend'}</dt>
                    <dd>{formatDomainInvestment(equipment, combined.currency)}</dd>
                  </div>
                  <div className={styles.combinedSpend}>
                    <dt>{combinedComplete ? 'Combined spend' : 'Combined known spend'}</dt>
                    <dd>{formatInvestment(combined.knownSpendSubtotalMinor, combined.currency)}</dd>
                  </div>
                </dl>
              </article>
            );
          })}
        </div>
      )}

      <div className={styles.coverageNotes}>
        <p>{coverageSentence('Plant', summary.investment.plants)}</p>
        <p>{coverageSentence('Equipment', summary.investment.equipment)}</p>
      </div>
    </section>
  );
}

function Energy({ summary }: { summary: DashboardSummary }) {
  const energy = summary.energy;
  const hasPoweredEquipment = energy.activePoweredEquipmentCount > 0;

  return (
    <section className={styles.section} aria-labelledby="energy-heading">
      <div className={styles.sectionHeading}>
        <div>
          <p className={styles.eyebrow}>Current settings</p>
          <h2 id="energy-heading">Energy estimates</h2>
        </div>
        <PlugZap aria-hidden="true" size={22} />
      </div>

      <div className={styles.energyLayout}>
        <article className={styles.energyCard}>
          {!hasPoweredEquipment ? (
            <div className={styles.emptyState}>
              <h3>No active power-tracking Equipment</h3>
              <p>
                There is nothing to estimate until Equipment capable of power tracking is added.
              </p>
            </div>
          ) : (
            <>
              <div className={styles.energyCoverage}>
                <p>
                  <strong>{energy.activePoweredEquipmentConfiguredTodayCount}</strong> of{' '}
                  <strong>{energy.activePoweredEquipmentCount}</strong> active power-tracking items
                  are configured today.
                </p>
                {!energy.configurationCoverage.complete && (
                  <span className={styles.attention}>Some current settings are missing</span>
                )}
              </div>
              <dl className={styles.energyMetrics}>
                <div>
                  <dt>Configured operating draw</dt>
                  <dd>
                    {energy.configuredOperatingDrawWatts === null
                      ? 'Unknown'
                      : `${compactDecimal(energy.configuredOperatingDrawWatts)} W`}
                  </dd>
                </div>
                <div>
                  <dt>Estimated energy / day</dt>
                  <dd>
                    {energy.estimatedKwh === null
                      ? 'Unknown'
                      : `${compactDecimal(energy.estimatedKwh.daily)} kWh`}
                  </dd>
                </div>
                <div>
                  <dt>
                    {energy.costCoverage.complete ? 'Estimated cost / day' : 'Known estimate / day'}
                  </dt>
                  <dd>{formatEnergyCost(energy.knownEstimatedVariableCostPence?.daily ?? null)}</dd>
                </div>
                <div>
                  <dt>
                    {energy.costCoverage.complete ? '30-day projection' : 'Known 30-day projection'}
                  </dt>
                  <dd>
                    {formatEnergyCost(energy.knownEstimatedVariableCostPence?.days30 ?? null)}
                  </dd>
                </div>
                <div>
                  <dt>
                    {energy.costCoverage.complete
                      ? '365-day projection'
                      : 'Known 365-day projection'}
                  </dt>
                  <dd>
                    {formatEnergyCost(energy.knownEstimatedVariableCostPence?.days365 ?? null)}
                  </dd>
                </div>
              </dl>
              <p className={styles.projectionNote}>
                Projections use today’s configured settings and current tariff. They are not
                measured consumption or actual bills.
              </p>
              {energy.currentTariff === null && energy.knownEstimatedVariableCostPence === null && (
                <p className={styles.warningText}>
                  Cost estimates are unknown because no current tariff is configured.
                </p>
              )}
            </>
          )}

          {energy.archivedEquipmentWithOngoingSettingsTodayCount > 0 && (
            <aside className={styles.archiveNotice} aria-label="Archived Equipment attention">
              <AlertTriangle aria-hidden="true" size={18} />
              <p>
                <strong>
                  {energy.archivedEquipmentWithOngoingSettingsTodayCount} archived Equipment item
                  {energy.archivedEquipmentWithOngoingSettingsTodayCount === 1 ? '' : 's'}
                </strong>{' '}
                {energy.archivedEquipmentWithOngoingSettingsTodayCount === 1 ? 'has' : 'have'}{' '}
                ongoing power settings today. This is kept separate from active estimates.
              </p>
            </aside>
          )}
        </article>

        <article className={styles.tariffCard} aria-labelledby="tariff-heading">
          <h3 id="tariff-heading">Current electricity tariff</h3>
          {energy.currentTariff ? (
            <>
              <p className={styles.tariffRate}>
                <strong>{compactDecimal(energy.currentTariff.unitRateMinorPerKwh)}</strong>
                <span>p/kWh</span>
              </p>
              <p className={styles.tariffDate}>
                Effective from{' '}
                <time dateTime={energy.currentTariff.effectiveFrom}>
                  {dateFormat.format(new Date(`${energy.currentTariff.effectiveFrom}T12:00:00Z`))}
                </time>
              </p>
            </>
          ) : (
            <div className={styles.tariffEmpty}>
              <strong>No current tariff</strong>
              <p>Add a tariff to calculate variable electricity cost for positive known energy.</p>
            </div>
          )}
          <Link className={styles.secondaryButton} href="/energy/tariffs">
            {energy.currentTariff ? 'Manage tariffs' : 'Configure tariff'}
          </Link>
        </article>
      </div>
    </section>
  );
}

function RecentlyAdded({ summary }: { summary: DashboardSummary }) {
  const recentPlants = summary.recentlyAdded.plants.slice(0, 4);
  const recentEquipment = summary.recentlyAdded.equipment.slice(0, 4);

  return (
    <section className={styles.section} aria-labelledby="recent-heading">
      <div className={styles.sectionHeading}>
        <div>
          <p className={styles.eyebrow}>New to the nursery</p>
          <h2 id="recent-heading">Recently added</h2>
        </div>
      </div>

      <div className={styles.recentColumns}>
        <div className={styles.recentGroup}>
          <div className={styles.recentTitle}>
            <h3>Plants</h3>
            <Link href="/plants">View all</Link>
          </div>
          {recentPlants.length === 0 ? (
            <p className={styles.recentEmpty}>No active Plants have been added yet.</p>
          ) : (
            <ul className={styles.recentList} aria-label="Recently added Plants">
              {recentPlants.map((plant) => (
                <li key={plant.id}>
                  <Link href={`/plants/${plant.id}`}>
                    <span className={styles.thumbnail}>
                      <PlantPhotoImage
                        src={
                          plant.primaryPhoto
                            ? photoImagePath(
                                plant.id,
                                plant.primaryPhoto.id,
                                'thumbnail',
                                plant.primaryPhoto.derivativeRevision,
                              )
                            : undefined
                        }
                        alt={`${plant.reference} primary photo`}
                      />
                    </span>
                    <span className={styles.recentDetails}>
                      <strong>{plant.displayName}</strong>
                      <span>{plant.reference}</span>
                      <time dateTime={plant.createdAt.toISOString()}>
                        Added {dateFormat.format(plant.createdAt)}
                      </time>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className={styles.recentGroup}>
          <div className={styles.recentTitle}>
            <h3>Equipment</h3>
            <Link href="/equipment">View all</Link>
          </div>
          {recentEquipment.length === 0 ? (
            <p className={styles.recentEmpty}>No active Equipment has been added yet.</p>
          ) : (
            <ul className={styles.recentList} aria-label="Recently added Equipment">
              {recentEquipment.map((item) => (
                <li key={item.id}>
                  <Link href={`/equipment/${item.id}`}>
                    <span className={styles.thumbnail}>
                      <EquipmentPhotoImage
                        src={
                          item.primaryPhoto
                            ? equipmentPhotoImagePath(
                                item.id,
                                item.primaryPhoto.id,
                                'thumbnail',
                                item.primaryPhoto.derivativeRevision,
                              )
                            : undefined
                        }
                        alt={`${item.reference} primary photo`}
                      />
                    </span>
                    <span className={styles.recentDetails}>
                      <strong>{item.name}</strong>
                      <span>{item.reference}</span>
                      <time dateTime={item.createdAt.toISOString()}>
                        Added {dateFormat.format(item.createdAt)}
                      </time>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

export function Dashboard({ summary }: { summary: DashboardSummary }) {
  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <p className={styles.eyebrow}>Anth Nursery OS</p>
        <h1>Nursery dashboard</h1>
        <p>A current view of your collection, equipment, investment and energy estimates.</p>
      </header>
      <Overview summary={summary} />
      <Watering summary={summary} />
      <Investment summary={summary} />
      <Energy summary={summary} />
      <RecentlyAdded summary={summary} />
    </div>
  );
}
