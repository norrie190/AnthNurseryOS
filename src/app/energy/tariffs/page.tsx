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
      <Link href="/equipment">← Equipment</Link>
      <header>
        <h1>Electricity tariffs</h1>
        <p>
          Your shared electricity unit rate and its history. GBP only, flat rates; no standing
          charges.
        </p>
      </header>
      <section className={`${styles.card} ${styles.stack}`} aria-labelledby="current-tariff">
        <h2 id="current-tariff">Current applicable tariff</h2>
        {current ? (
          <>
            <strong>{compactDecimal(current.unitRateMinorPerKwh!)} p/kWh</strong>
            <p>{humanRange(current.effectiveFrom, current.effectiveTo)}</p>
          </>
        ) : (
          <p>
            No tariff applies today. Energy estimates remain available, but positive consumption
            cannot be costed without a rate.
          </p>
        )}
      </section>
      <section className={`${styles.card} ${styles.stack}`} aria-label="Manage tariff history">
        <EnergyHistory kind="tariff" rows={rows} token={timelineToken} today={today} />
      </section>
    </div>
  );
}
