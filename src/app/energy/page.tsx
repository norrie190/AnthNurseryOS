import { connection } from 'next/server';

import { EnergyOverviewPage } from '@/modules/energy/components/energy-overview';
import { getEnergyOverview } from '@/modules/energy/energy-overview';

export default async function EnergyPage() {
  await connection();
  const overview = await getEnergyOverview();

  return <EnergyOverviewPage overview={overview} />;
}
