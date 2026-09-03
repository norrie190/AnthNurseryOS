import { connection } from 'next/server';
import { getWateringQueue } from '@/modules/watering/watering-queue-queries';
import { WateringQueuePage } from '@/modules/watering/components/watering-queue-page';

export default async function WateringPage() {
  await connection();
  return <WateringQueuePage queue={await getWateringQueue()} />;
}
