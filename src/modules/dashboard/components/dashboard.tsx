import Link from 'next/link';
import {
  AlertTriangle,
  ArrowRight,
  Droplets,
  GitBranch,
  Leaf,
  PlugZap,
  ReceiptText,
  Wrench,
} from 'lucide-react';
import type { ReactNode } from 'react';
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

type DashboardWateringAttention = NonNullable<DashboardSummary['watering']>['attention'][number];

function wateringState(item: DashboardWateringAttention) {
  if (item.status === 'OVERDUE') return Math.abs(item.daysUntilDue ?? 0) + ' days overdue';
  if (item.status === 'DUE_TODAY') return 'Due today';
  return 'First watering not recorded';
}

function SnapshotMetric({
  icon,
  label,
  value,
  detail,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  detail: ReactNode;
}) {
  return (
    <article className={styles.snapshotMetric}>
      <span className={styles.metricIcon} aria-hidden="true">
        {icon}
      </span>
      <div className={styles.metricCopy}>
        <h3>{label}</h3>
        <p className={styles.metricValue}>{value}</p>
        <p className={styles.metricDetail}>{detail}</p>
      </div>
    </article>
  );
}

function Snapshot({ summary }: { summary: DashboardSummary }) {
  const watering = summary.watering;
  const energy = summary.energy;
  const energyCost = energy.knownEstimatedVariableCostPence?.daily ?? null;
  const energyValue =
    energy.activePoweredEquipmentCount === 0
      ? 'Not configured'
      : energyCost === null
        ? 'Estimate unavailable'
        : formatEnergyCost(energyCost);
  const energyDetail =
    energy.activePoweredEquipmentCount === 0
      ? 'No active power-tracking Equipment'
      : !energy.configurationCoverage.complete
        ? `Setup incomplete · ${energy.activePoweredEquipmentConfiguredTodayCount} of ${energy.activePoweredEquipmentCount} configured`
        : energy.currentTariff === null
          ? 'Tariff not configured'
          : 'Estimated daily cost';

  return (
    <section className={styles.snapshot} aria-label="Nursery snapshot">
      <div className={styles.snapshotGrid}>
        <SnapshotMetric
          icon={<Leaf size={20} />}
          label="Plants"
          value={summary.plants.activeCount}
          detail={`${summary.plants.archivedCount} archived`}
        />
        <SnapshotMetric
          icon={<Wrench size={20} />}
          label="Equipment"
          value={summary.equipment.activeCount}
          detail={`${summary.equipment.activeUsesPowerCount} power tracking capable`}
        />
        <SnapshotMetric
          icon={<Droplets size={20} />}
          label="Watering attention"
          value={
            watering ? (
              <span className={styles.inlineMetricList}>
                <span>{watering.overdue} overdue</span>
                <span>{watering.dueToday} today</span>
              </span>
            ) : (
              'Not available'
            )
          }
          detail={
            watering
              ? `${watering.needsFirstWatering} need first watering${watering.notConfigured ? ` · ${watering.notConfigured} not configured` : ''}`
              : 'Watering summary unavailable'
          }
        />
        <SnapshotMetric
          icon={<PlugZap size={20} />}
          label="Energy estimate"
          value={energyValue}
          detail={energyDetail}
        />
      </div>
    </section>
  );
}

function Watering({ summary }: { summary: DashboardSummary }) {
  const watering = summary.watering;
  if (!watering) return null;
  const urgent = watering.overdue + watering.dueToday + watering.needsFirstWatering;

  return (
    <section
      className={`${styles.panel} ${styles.wateringPanel}`}
      aria-labelledby="attention-heading"
    >
      <div className={styles.sectionHeading}>
        <div>
          <p className={styles.eyebrow}>Today</p>
          <h2 id="attention-heading">Needs attention</h2>
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
          <dl className={styles.wateringPrimaryMetrics}>
            <div className={styles.urgentMetric}>
              <dt>Overdue</dt>
              <dd>{watering.overdue}</dd>
            </div>
            <div className={styles.urgentMetric}>
              <dt>Due today</dt>
              <dd>{watering.dueToday}</dd>
            </div>
            <div className={styles.urgentMetric}>
              <dt>Needs first watering</dt>
              <dd>{watering.needsFirstWatering}</dd>
            </div>
          </dl>

          <dl className={styles.wateringSecondaryMetrics}>
            <div>
              <dt>Due soon</dt>
              <dd>{watering.dueSoon}</dd>
            </div>
            <div>
              <dt>Upcoming</dt>
              <dd>{watering.upcoming}</dd>
            </div>
            <div>
              <dt>Not configured</dt>
              <dd>{watering.notConfigured}</dd>
            </div>
          </dl>

          {watering.attention.length ? (
            <ul className={styles.wateringAttention} aria-label="Watering attention Plants">
              {watering.attention.map((item) => (
                <li key={item.id}>
                  <Link className={styles.attentionLink} href={'/plants/' + item.id}>
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
                    <span className={styles.attentionDetails}>
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
            <p className={styles.wateringQuiet} role="status">
              {urgent === 0
                ? 'No urgent watering tasks today.'
                : 'Nothing needs immediate watering attention.'}
            </p>
          )}

          <Link className={styles.textLink} href="/watering">
            View watering queue <ArrowRight aria-hidden="true" size={15} />
          </Link>
        </>
      )}
    </section>
  );
}

function RecentPlants({ summary }: { summary: DashboardSummary }) {
  const recentPlants = summary.recentlyAdded.plants.slice(0, 4);

  return (
    <section
      className={`${styles.panel} ${styles.recentPlantsPanel}`}
      aria-labelledby="recent-plants-heading"
    >
      <div className={styles.sectionHeading}>
        <div>
          <p className={styles.eyebrow}>New to the nursery</p>
          <h2 id="recent-plants-heading">Recent Plants</h2>
        </div>
        <Link className={styles.headingLink} href="/plants">
          View all Plants <ArrowRight aria-hidden="true" size={15} />
        </Link>
      </div>

      {recentPlants.length === 0 ? (
        <div className={styles.emptyState}>
          <h3>No active Plants have been added yet</h3>
          <p>New Plant records will appear here with their primary photo or fallback.</p>
        </div>
      ) : (
        <ul className={styles.recentList} aria-label="Recently added Plants">
          {recentPlants.map((plant) => (
            <li key={plant.id}>
              <Link className={styles.recentLink} href={`/plants/${plant.id}`}>
                <span className={styles.recentPlantThumbnail}>
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
                <ArrowRight className={styles.rowArrow} aria-hidden="true" size={17} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function QuickActions() {
  return (
    <section
      className={`${styles.panel} ${styles.quickActionsPanel}`}
      aria-labelledby="quick-actions-heading"
    >
      <div className={styles.sectionHeading}>
        <div>
          <p className={styles.eyebrow}>Shortcuts</p>
          <h2 id="quick-actions-heading">Quick actions</h2>
        </div>
      </div>

      <nav className={styles.quickActionList} aria-label="Dashboard quick actions">
        <Link className={styles.quickAction} href="/plants/new">
          <span className={styles.actionIcon} aria-hidden="true">
            <Leaf size={19} />
          </span>
          <span className={styles.actionCopy}>
            <strong>Add Plant</strong>
            <span>Record a new Plant</span>
          </span>
          <ArrowRight className={styles.rowArrow} aria-hidden="true" size={16} />
        </Link>
        <Link className={styles.quickAction} href="/watering">
          <span className={styles.actionIcon} aria-hidden="true">
            <Droplets size={19} />
          </span>
          <span className={styles.actionCopy}>
            <strong>Watering</strong>
            <span>Open today’s queue</span>
          </span>
          <ArrowRight className={styles.rowArrow} aria-hidden="true" size={16} />
        </Link>
        <Link className={styles.quickAction} href="/equipment/new">
          <span className={styles.actionIcon} aria-hidden="true">
            <Wrench size={19} />
          </span>
          <span className={styles.actionCopy}>
            <strong>Add Equipment</strong>
            <span>Record a new asset</span>
          </span>
          <ArrowRight className={styles.rowArrow} aria-hidden="true" size={16} />
        </Link>
        <Link className={styles.quickAction} href="/breeding">
          <span className={styles.actionIcon} aria-hidden="true">
            <GitBranch size={19} />
          </span>
          <span className={styles.actionCopy}>
            <strong>Breeding</strong>
            <span>Review breeding work</span>
          </span>
          <ArrowRight className={styles.rowArrow} aria-hidden="true" size={16} />
        </Link>
        <Link className={styles.quickAction} href="/energy/tariffs">
          <span className={styles.actionIcon} aria-hidden="true">
            <PlugZap size={19} />
          </span>
          <span className={styles.actionCopy}>
            <strong>Configure tariff</strong>
            <span>Update Energy assumptions</span>
          </span>
          <ArrowRight className={styles.rowArrow} aria-hidden="true" size={16} />
        </Link>
      </nav>
    </section>
  );
}

function Energy({ summary }: { summary: DashboardSummary }) {
  const energy = summary.energy;
  const hasPoweredEquipment = energy.activePoweredEquipmentCount > 0;
  const hasKnownEnergyValues =
    energy.configuredOperatingDrawWatts !== null ||
    energy.estimatedKwh !== null ||
    energy.knownEstimatedVariableCostPence !== null;

  return (
    <section className={`${styles.panel} ${styles.energyPanel}`} aria-labelledby="energy-heading">
      <div className={styles.sectionHeading}>
        <div>
          <p className={styles.eyebrow}>Current settings</p>
          <h2 id="energy-heading">Energy estimates</h2>
        </div>
        <PlugZap aria-hidden="true" size={22} />
      </div>

      <div className={styles.energyLayout}>
        <div className={styles.energySummary}>
          {!hasPoweredEquipment ? (
            <div className={styles.emptyState}>
              <h3>No active power-tracking Equipment</h3>
              <p>
                There is nothing to estimate until Equipment capable of power tracking is added.
              </p>
            </div>
          ) : (
            <>
              {hasKnownEnergyValues && (
                <div className={styles.energyCoverage}>
                  <p>
                    <strong>{energy.activePoweredEquipmentConfiguredTodayCount}</strong> of{' '}
                    <strong>{energy.activePoweredEquipmentCount} </strong>active power-tracking
                    items are configured today.
                  </p>
                  {!energy.configurationCoverage.complete && (
                    <span className={styles.attention}>Some current settings are missing</span>
                  )}
                </div>
              )}
              {hasKnownEnergyValues ? (
                <>
                  <dl className={styles.energyMetrics}>
                    {energy.configuredOperatingDrawWatts !== null && (
                      <div>
                        <dt>Configured operating draw</dt>
                        <dd>{`${compactDecimal(energy.configuredOperatingDrawWatts)} W`}</dd>
                      </div>
                    )}
                    {energy.estimatedKwh !== null && (
                      <div>
                        <dt>Estimated energy / day</dt>
                        <dd>{`${compactDecimal(energy.estimatedKwh.daily)} kWh`}</dd>
                      </div>
                    )}
                    {energy.knownEstimatedVariableCostPence !== null && (
                      <>
                        <div>
                          <dt>
                            {energy.costCoverage.complete
                              ? 'Estimated cost / day'
                              : 'Known estimate / day'}
                          </dt>
                          <dd>{formatEnergyCost(energy.knownEstimatedVariableCostPence.daily)}</dd>
                        </div>
                        <div>
                          <dt>
                            {energy.costCoverage.complete
                              ? '30-day projection'
                              : 'Known 30-day projection'}
                          </dt>
                          <dd>{formatEnergyCost(energy.knownEstimatedVariableCostPence.days30)}</dd>
                        </div>
                        <div>
                          <dt>
                            {energy.costCoverage.complete
                              ? '365-day projection'
                              : 'Known 365-day projection'}
                          </dt>
                          <dd>
                            {formatEnergyCost(energy.knownEstimatedVariableCostPence.days365)}
                          </dd>
                        </div>
                      </>
                    )}
                  </dl>
                  <p className={styles.projectionNote}>
                    Projections use today’s configured settings and current tariff. They are not
                    measured consumption or actual bills.
                  </p>
                  {energy.currentTariff === null &&
                    energy.knownEstimatedVariableCostPence === null && (
                      <p className={styles.warningText}>
                        Cost estimates are unknown because no current tariff is configured.
                      </p>
                    )}
                </>
              ) : (
                <div className={styles.energySetupState}>
                  <h3>Setup incomplete</h3>
                  <p>
                    {energy.activePoweredEquipmentConfiguredTodayCount} of{' '}
                    {energy.activePoweredEquipmentCount} power-tracking items configured today.
                  </p>
                  {energy.currentTariff === null && <p>No current tariff.</p>}
                  <p>Estimates will appear when current configuration is available.</p>
                </div>
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
        </div>

        <article className={styles.tariffSummary} aria-labelledby="tariff-heading">
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

function Investment({ summary }: { summary: DashboardSummary }) {
  const currencies = summary.investment.combinedByCurrency;
  const plantsComplete = summary.investment.plants.coverageComplete;
  const equipmentComplete = summary.investment.equipment.coverageComplete;

  return (
    <section
      className={`${styles.panel} ${styles.investmentPanel}`}
      aria-labelledby="investment-heading"
    >
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

function RecentEquipment({ summary }: { summary: DashboardSummary }) {
  const recentEquipment = summary.recentlyAdded.equipment.slice(0, 4);

  return (
    <section
      className={`${styles.panel} ${styles.recentEquipmentPanel}`}
      aria-labelledby="recent-equipment-heading"
    >
      <div className={styles.sectionHeading}>
        <div>
          <p className={styles.eyebrow}>Inventory</p>
          <h2 id="recent-equipment-heading">Recent Equipment</h2>
        </div>
        <Link className={styles.headingLink} href="/equipment">
          View all Equipment <ArrowRight aria-hidden="true" size={15} />
        </Link>
      </div>

      {recentEquipment.length === 0 ? (
        <div className={styles.emptyState}>
          <h3>No active Equipment has been added yet</h3>
          <p>New Equipment records will appear here with their primary photo or fallback.</p>
        </div>
      ) : (
        <ul className={styles.recentList} aria-label="Recently added Equipment">
          {recentEquipment.map((item) => (
            <li key={item.id}>
              <Link className={styles.recentLink} href={`/equipment/${item.id}`}>
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
                <ArrowRight className={styles.rowArrow} aria-hidden="true" size={17} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function Dashboard({ summary }: { summary: DashboardSummary }) {
  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <h1>Dashboard</h1>
        <p>Nursery overview and today’s priorities.</p>
      </header>

      <Snapshot summary={summary} />

      <div className={styles.mainGrid}>
        <Watering summary={summary} />
        <div className={styles.sideStack}>
          <RecentPlants summary={summary} />
          <QuickActions />
        </div>
      </div>

      <div className={styles.secondaryGrid}>
        <Energy summary={summary} />
        <Investment summary={summary} />
      </div>

      <RecentEquipment summary={summary} />
    </div>
  );
}
