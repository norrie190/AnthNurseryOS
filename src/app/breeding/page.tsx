import { connection } from 'next/server';
import { getBreedingOverview } from '@/modules/breeding/breeding-overview-queries';
import { BreedingOverviewPage } from '@/modules/breeding/components/breeding-overview-page';

export default async function BreedingPage() {
  await connection();
  return <BreedingOverviewPage overview={await getBreedingOverview()} />;
}
