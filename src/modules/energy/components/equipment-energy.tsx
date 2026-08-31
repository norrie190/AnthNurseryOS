import Link from 'next/link';
import type { EquipmentEnergyView } from '../energy-view';
import { humanRange } from '../energy-browser';
import { EnergyHistory } from './energy-history';
import styles from './energy.module.css';

export function EquipmentEnergy({ view }: { view: EquipmentEnergyView }) {
  const { current, report } = view;
  return (
    <section
      className={`${styles.card} ${styles.stack}`}
      aria-labelledby="equipment-energy-heading"
    >
      <h2 id="equipment-energy-heading">Power / Energy</h2>
      {!view.usesPower && (
        <p>
          Power tracking is not enabled for this Equipment. Existing history remains available for
          review and correction.
        </p>
      )}
      {view.usesPower && !current && (
        <p>
          No operating settings apply today. Record settings below, or review gaps and future dates
          in the history.
        </p>
      )}
      {current && (
        <>
          <p>
            Estimates from configured settings, not live measurements or actual billing. Projections
            assume these settings and today’s rate stay unchanged; future scheduled changes are not
            included in projections.
          </p>
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
          {current.knownZero && <p>These settings record known zero energy consumption.</p>}
          {current.tariff === null && (
            <p className={styles.warning}>
              {current.knownZero
                ? 'No current tariff is recorded. Variable cost is still known zero because consumption is zero.'
                : 'Energy can be estimated, but cost cannot currently be calculated because the electricity tariff is missing.'}
            </p>
          )}
        </>
      )}
      <Link href="/energy/tariffs">Manage electricity tariffs</Link>
      {report.applicable && (
        <div className={styles.stack}>
          <h3>This calendar month from recorded history</h3>
          <p>
            {humanRange(report.range.from, report.range.to)}. Includes scheduled dates, not a
            forecast of unrecorded days.
          </p>
          <p>
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
      <EnergyHistory
        kind="power"
        equipmentId={view.equipmentId}
        token={view.token}
        rows={view.rows}
        today={view.today}
        canRecord={view.usesPower}
      />
    </section>
  );
}
