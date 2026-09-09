import Link from 'next/link';
import { ArrowRight, Bolt, CalendarDays } from 'lucide-react';
import type { EquipmentEnergyView } from '../energy-view';
import { humanRange } from '../energy-browser';
import { EnergyHistory } from './energy-history';
import styles from './energy.module.css';

export function EquipmentEnergy({ view }: { view: EquipmentEnergyView }) {
  const { current, report } = view;
  return (
    <section
      className={`${styles.card} ${styles.energySection}`}
      aria-labelledby="equipment-energy-heading"
    >
      <header className={styles.energyHeader}>
        <span className={styles.energyIcon} aria-hidden="true">
          <Bolt size={22} />
        </span>
        <div>
          <p className={styles.eyebrow}>Operating profile</p>
          <h2 id="equipment-energy-heading">Power / Energy</h2>
          <p>Configured estimates and the history behind them.</p>
        </div>
      </header>
      {!view.usesPower && (
        <div className={styles.configurationState}>
          <strong>Power tracking is not enabled</strong>
          <p>
            Existing history remains available for review and correction, but new settings cannot be
            recorded for this Equipment.
          </p>
        </div>
      )}
      {view.usesPower && !current && (
        <div className={styles.configurationState}>
          <strong>Power configuration not recorded</strong>
          <p>
            No settings apply today. Record settings below, or review future dates and gaps in the
            history.
          </p>
        </div>
      )}
      {current && (
        <div className={styles.currentPanel}>
          <div className={styles.currentPanelHeading}>
            <div>
              <p className={styles.eyebrow}>Today’s configuration</p>
              <h3>Current configuration and estimates</h3>
            </div>
            <span>Planning estimate</span>
          </div>
          <dl className={styles.metrics}>
            {[
              ['Configured operating power', `${current.watts} W`],
              ['Operating duration', `${current.hours} hours/day`],
              ['Estimated energy', `${current.kwh} kWh/day`],
              [
                'Current electricity unit rate',
                current.tariff === null ? 'Not recorded' : `${current.tariff} p/kWh`,
              ],
              ['Estimated variable cost/day', current.daily],
              ['Estimated 30-day cost', current.days30],
              ['Estimated 365-day cost', current.days365],
            ].map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <p className={styles.estimateNote}>
            Estimates come from configured settings, not live measurements or actual billing.
            Projections assume these settings and today’s rate stay unchanged.
          </p>
          {current.knownZero && <p>These settings record known zero energy consumption.</p>}
          {current.tariff === null && (
            <p className={styles.warning}>
              {current.knownZero
                ? 'No current tariff is recorded. Variable cost is still known zero because consumption is zero.'
                : 'Energy can be estimated, but cost cannot currently be calculated because the electricity tariff is missing.'}
            </p>
          )}
        </div>
      )}
      <Link className={styles.tariffLink} href="/energy/tariffs">
        Manage electricity tariffs <ArrowRight size={16} aria-hidden="true" />
      </Link>
      {report.applicable && (
        <div className={styles.monthPanel}>
          <div className={styles.monthHeading}>
            <CalendarDays size={20} aria-hidden="true" />
            <div>
              <p className={styles.eyebrow}>Recorded history</p>
              <h3>This calendar month</h3>
            </div>
          </div>
          <p>
            {humanRange(report.range.from, report.range.to)}. Includes scheduled dates, not a
            forecast of unrecorded days.
          </p>
          <p className={styles.monthTotal}>
            {report.kwh} kWh {report.energyComplete ? 'estimated energy' : 'known energy subtotal'}{' '}
            · {report.cost}{' '}
            {report.costComplete
              ? 'estimated variable cost'
              : 'known cost subtotal — incomplete coverage'}
          </p>
          {!report.energyComplete && (
            <p className={styles.warning}>
              No power settings are recorded for part of this period. Missing energy:{' '}
              {report.missingPower.map((range) => humanRange(range.from, range.to)).join('; ')}.
            </p>
          )}
          {!!report.missingTariff.length && (
            <p className={styles.warning}>
              {report.energyComplete
                ? 'Electricity usage is known, but the electricity tariff is missing for part of this period.'
                : 'The electricity tariff is also missing for part of this period.'}{' '}
              Missing tariff:{' '}
              {report.missingTariff.map((range) => humanRange(range.from, range.to)).join('; ')}.
              {report.costComplete && ' Variable cost is known zero for the missing tariff dates.'}
            </p>
          )}
        </div>
      )}
      <div className={styles.historyShell}>
        <EnergyHistory
          kind="power"
          equipmentId={view.equipmentId}
          token={view.token}
          rows={view.rows}
          today={view.today}
          canRecord={view.usesPower}
        />
      </div>
    </section>
  );
}
