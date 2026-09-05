import Link from 'next/link';
import { connection } from 'next/server';
import { nurseryToday } from '@/lib/calendar-date';
import { getElectricityTariffHistory } from '@/modules/energy/energy-queries';
import { compactDecimal, energyRows, humanRange } from '@/modules/energy/energy-browser';
import { includesDate } from '@/modules/energy/energy-periods';
import { EnergyHistory } from '@/modules/energy/components/energy-history';
import styles from '@/modules/energy/components/energy.module.css';

export default async function ElectricityTariffsPage() {
  await connection();
  const { tariffs, timelineToken } = await getElectricityTariffHistory();
  const rows = energyRows(tariffs);
  const today = nurseryToday();
  const current = rows.find((row) => !row.voidedAt && includesDate(row, today));
  return (
    <div className={styles.page}>
      <div className={styles.breadcrumbs}>
        <Link href="/equipment">← Equipment</Link>
      </div>
      <header className={styles.pageHeader}>
        <h1>Electricity tariffs</h1>
        <p>
          Track the electricity rate used for estimated running costs. Rates are recorded in pence
          per kWh; standing charges are not included.
        </p>
      </header>
      <section
        className={`${styles.currentSection} ${styles.stack}`}
        aria-labelledby="current-tariff"
      >
        <p className={styles.eyebrow}>Current configuration</p>
        <h2 id="current-tariff">Current electricity tariff</h2>
        {current ? (
          <dl className={styles.currentDetails}>
            <div>
              <dt>Rate</dt>
              <dd>{compactDecimal(current.unitRateMinorPerKwh!)} p/kWh</dd>
            </div>
            <div>
              <dt>Effective</dt>
              <dd>{humanRange(current.effectiveFrom, current.effectiveTo)}</dd>
            </div>
          </dl>
        ) : (
          <p>
            Electricity tariff not configured. Energy estimates cannot be costed without a rate.
          </p>
        )}
      </section>
      <section
        className={`${styles.section} ${styles.stack}`}
        aria-label="Tariff history and maintenance"
      >
        <EnergyHistory kind="tariff" rows={rows} token={timelineToken} today={today} />
      </section>
    </div>
  );
}
