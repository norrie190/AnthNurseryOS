import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  CircleGauge,
  Gauge,
  Leaf,
  PoundSterling,
  Settings2,
  Zap,
} from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { EquipmentPhotoImage } from '../../equipment/components/equipment-photo-image';
import { equipmentPhotoImagePath } from '../../equipment/equipment-photo-browser';
import { compactDecimal, humanDate, humanRange } from '../energy-browser';
import type { EnergyOverview } from '../energy-overview';
import styles from './energy-overview.module.css';

function Metric({
  icon,
  label,
  value,
  note,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  note: string;
}) {
  return (
    <article className={styles.metric}>
      <span className={styles.metricIcon} aria-hidden="true">
        {icon}
      </span>
      <div>
        <p>{label}</p>
        <strong>{value}</strong>
        <span>{note}</span>
      </div>
    </article>
  );
}

function ConfigurationStatus({ overview }: { overview: EnergyOverview }) {
  const hasEquipment = overview.equipmentCount > 0;
  const complete = overview.totals.energyCoverageComplete && overview.totals.costCoverageComplete;
  const percentage = overview.equipmentCount
    ? Math.round((overview.configuredCount / overview.equipmentCount) * 100)
    : 100;

  return (
    <section className={styles.readiness} aria-labelledby="energy-readiness-heading">
      <div className={styles.readinessCopy}>
        <span className={complete ? styles.readyIcon : styles.attentionIcon} aria-hidden="true">
          {complete ? <CheckCircle2 size={22} /> : <AlertTriangle size={22} />}
        </span>
        <div>
          <p className={styles.eyebrow}>Configuration health</p>
          <h2 id="energy-readiness-heading">
            {!hasEquipment
              ? 'No powered Equipment yet'
              : complete
                ? 'Energy estimates are ready'
                : 'Finish setting up Energy'}
          </h2>
          <p>
            {!hasEquipment
              ? 'No active Equipment is marked for power tracking.'
              : `${overview.configuredCount} of ${overview.equipmentCount} power-tracking items have settings for today.`}
            {hasEquipment &&
              overview.currentTariff === null &&
              !overview.totals.costCoverageComplete &&
              ' A current electricity tariff is still needed.'}
          </p>
        </div>
      </div>
      <div className={styles.progressBlock}>
        <div className={styles.progressLabel}>
          <span>Equipment configured</span>
          <strong>{percentage}%</strong>
        </div>
        <div className={styles.progressTrack} aria-hidden="true">
          <span style={{ width: `${percentage}%` }} />
        </div>
      </div>
    </section>
  );
}

function TariffCard({ overview }: { overview: EnergyOverview }) {
  return (
    <section className={styles.tariffCard} aria-labelledby="tariff-card-heading">
      <div className={styles.sectionHeader}>
        <div>
          <p className={styles.eyebrow}>Electricity rate</p>
          <h2 id="tariff-card-heading">Tariff</h2>
        </div>
        <Link href="/energy/tariffs">
          Manage <ArrowRight size={15} aria-hidden="true" />
        </Link>
      </div>

      {overview.currentTariff ? (
        <div className={styles.tariffCurrent}>
          <p>
            <strong>{compactDecimal(overview.currentTariff.unitRateMinorPerKwh)}</strong>
            <span>p/kWh</span>
          </p>
          <span>
            {humanRange(overview.currentTariff.effectiveFrom, overview.currentTariff.effectiveTo)}
          </span>
        </div>
      ) : (
        <div className={styles.missingTariff}>
          <AlertTriangle size={20} aria-hidden="true" />
          <div>
            <strong>No tariff applies today</strong>
            <p>Energy can still be estimated, but variable cost cannot.</p>
          </div>
        </div>
      )}

      {overview.nextTariff && (
        <div className={styles.nextTariff}>
          <CalendarClock size={18} aria-hidden="true" />
          <p>
            Next rate{' '}
            <strong>{compactDecimal(overview.nextTariff.unitRateMinorPerKwh)} p/kWh</strong> from{' '}
            {humanDate(overview.nextTariff.effectiveFrom)}
          </p>
        </div>
      )}
    </section>
  );
}

function EquipmentTable({ overview }: { overview: EnergyOverview }) {
  return (
    <section className={styles.equipmentPanel} aria-labelledby="powered-equipment-heading">
      <div className={styles.sectionHeader}>
        <div>
          <p className={styles.eyebrow}>Current configuration</p>
          <h2 id="powered-equipment-heading">Powered Equipment</h2>
        </div>
        <Link href="/equipment">
          All Equipment <ArrowRight size={15} aria-hidden="true" />
        </Link>
      </div>

      {overview.equipment.length === 0 ? (
        <div className={styles.emptyState}>
          <Leaf size={25} aria-hidden="true" />
          <h3>No power-tracking Equipment</h3>
          <p>Enable power tracking when adding or editing powered Equipment.</p>
          <Link className={styles.primaryButton} href="/equipment/new">
            Add Equipment
          </Link>
        </div>
      ) : (
        <div className={styles.equipmentList} role="list">
          {overview.equipment.map((item) => (
            <article className={styles.equipmentRow} key={item.id} role="listitem">
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
              <div className={styles.equipmentIdentity}>
                <strong>{item.name}</strong>
                <span>{item.reference}</span>
              </div>
              {item.current ? (
                <>
                  <div className={styles.equipmentValue}>
                    <span>Settings</span>
                    <strong>
                      {compactDecimal(item.current.powerWatts)} W ·{' '}
                      {compactDecimal(item.current.hoursPerDay)} h/day
                    </strong>
                  </div>
                  <div className={styles.equipmentValue}>
                    <span>Daily estimate</span>
                    <strong>{compactDecimal(item.current.estimatedKwhPerDay)} kWh</strong>
                    <small>{item.current.estimatedCostPerDay ?? 'Cost unavailable'}</small>
                  </div>
                </>
              ) : (
                <div className={styles.missingSettings}>
                  <strong>No settings for today</strong>
                  <span>
                    {item.nextSettingFrom
                      ? `Scheduled from ${humanDate(item.nextSettingFrom)}`
                      : 'Add operating power and hours'}
                  </span>
                </div>
              )}
              <Link className={styles.manageLink} href={`/equipment/${item.id}#energy`}>
                Manage <ArrowRight size={15} aria-hidden="true" />
              </Link>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

export function EnergyOverviewPage({ overview }: { overview: EnergyOverview }) {
  const totals = overview.totals;
  const knownCostLabel = totals.costCoverageComplete ? 'Estimated cost' : 'Known cost estimate';

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>Nursery utilities</p>
          <h1>Energy</h1>
          <p>Understand your configured electricity use and keep every estimate honest.</p>
        </div>
        <Link className={styles.secondaryButton} href="/energy/tariffs">
          <Settings2 size={17} aria-hidden="true" /> Manage tariffs
        </Link>
      </header>

      <ConfigurationStatus overview={overview} />

      <section className={styles.metricsGrid} aria-label="Current Energy estimates">
        <Metric
          icon={<Gauge size={21} />}
          label="Configured operating draw"
          value={
            totals.configuredOperatingDrawWatts === null
              ? 'Not available'
              : `${compactDecimal(totals.configuredOperatingDrawWatts)} W`
          }
          note="Combined configured power, not a live reading"
        />
        <Metric
          icon={<Zap size={21} />}
          label="Estimated daily energy"
          value={
            totals.estimatedKwhPerDay === null
              ? 'Not available'
              : `${compactDecimal(totals.estimatedKwhPerDay)} kWh`
          }
          note={
            totals.energyCoverageComplete ? 'All active items covered' : 'Known configured subtotal'
          }
        />
        <Metric
          icon={<PoundSterling size={21} />}
          label={`${knownCostLabel} · 30 days`}
          value={totals.estimatedCost30Days ?? 'Not available'}
          note={
            totals.costCoverageComplete ? 'Complete current coverage' : 'Coverage is incomplete'
          }
        />
        <Metric
          icon={<CircleGauge size={21} />}
          label={`${knownCostLabel} · 365 days`}
          value={totals.estimatedCost365Days ?? 'Not available'}
          note="Projection from today’s settings and rate"
        />
      </section>

      <p className={styles.disclaimer}>
        These are planning estimates from configured operating settings, not live measurements or
        household bills. Standing charges are not included.
      </p>

      <div className={styles.contentGrid}>
        <EquipmentTable overview={overview} />
        <TariffCard overview={overview} />
      </div>

      {overview.archivedOngoingCount > 0 && (
        <aside className={styles.archivedWarning} aria-label="Archived Equipment warning">
          <AlertTriangle size={19} aria-hidden="true" />
          <p>
            <strong>{overview.archivedOngoingCount} archived Equipment item</strong> still has power
            settings applying today. Historical data is preserved and kept out of the active totals.
          </p>
          <Link href="/equipment/archived">Review archived Equipment</Link>
        </aside>
      )}
    </div>
  );
}
