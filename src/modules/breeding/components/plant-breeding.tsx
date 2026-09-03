import type { PlantBreedingDetail } from '../breeding-queries';
import { PlantBreedingWorkflow } from './plant-breeding-workflow';

export function PlantBreeding({
  plant,
  detail,
}: {
  plant: {
    id: string;
    reference: string;
    name: string | null;
    status: string;
    archivedAt: Date | null;
  };
  detail: PlantBreedingDetail;
}) {
  return <PlantBreedingWorkflow plant={plant} detail={detail} />;
}
