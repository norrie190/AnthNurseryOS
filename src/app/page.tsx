import { connection } from 'next/server';
import { Dashboard } from '@/modules/dashboard/components/dashboard';
import { getDashboardSummary } from '@/modules/dashboard';

export default async function HomePage() {
  await connection();
  const summary = await getDashboardSummary();

  return <Dashboard summary={summary} />;
}
