import Link from 'next/link';
import { connection } from 'next/server';
import { ArrowLeft, CalendarClock, Zap } from 'lucide-react';
import { nurseryToday } from '@/lib/calendar-date';
import { getElectricityTariffHistory } from '@/modules/energy/energy-queries';
import { compactDecimal, energyRows, humanDate, humanRange } from '@/modules/energy/energy-browser';
import { includesDate } from '@/modules/energy/energy-periods';
import { EnergyHistory } from '@/modules/energy/components/energy-history';
import styles from '@/modules/energy/components/energy.module.css';

export default async function ElectricityTariffsPage() {
  await connection();
  const { tariffs, timelineToken } = await getElectricityTariffHistory();
  const rows = energyRows(tariffs);
  const today = nurseryToday();
  const current = rows.find((row) => !row.voidedAt && includesDate(row, today));
  const next = rows.find((row) => !row.voidedAt && row.effectiveFrom > today);
  return (
    <div className={styles.page}>
      <div className={styles.breadcrumbs}>
        <Link href="/energy">
          <ArrowLeft aria-hidden="true" size={15} /> Energy overview
        </Link>
      </div>
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>Energy settings</p>
          <h1>Electricity tariffs</h1>
          <p>
            Keep a dated history of the unit rates used by nursery estimates. Enter rates in pence
            per kWh; standing charges are not included.
          </p>
        </div>
        <Link className={styles.overviewLink} href="/energy">
          View Energy overview
        </Link>
      </header>
      <section
        className={`${styles.currentSection} ${styles.stack}`}
        aria-labelledby="current-tariff"
      >
        <div className={styles.tariffHeading}>
          <span className={styles.tariffIcon} aria-hidden="true">
            <Zap size={21} />
          </span>
          <div>
            <p className={styles.eyebrow}>Current configuration</p>
            <h2 id="current-tariff">Current electricity tariff</h2>
          </div>
        </div>
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
          <div className={styles.tariffMissing}>
            <strong>Electricity tariff not configured for today</strong>
            <p>Energy estimates cannot be costed until a rate becomes applicable.</p>
            {next && (
              <p className={styles.scheduledTariff}>
                <CalendarClock aria-hidden="true" size={17} />
                {compactDecimal(next.unitRateMinorPerKwh!)} p/kWh is scheduled from{' '}
                {humanDate(next.effectiveFrom)}.
              </p>
            )}
          </div>
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
