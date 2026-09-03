import 'server-only';
import { Prisma } from '../../generated/prisma/client';
import { getPrisma } from '../../lib/prisma';
import { WateringError } from './watering-errors';
import { parseWateringPlantId } from './watering-input';

const eventSelect = {
  id: true,
  plantId: true,
  wateredAt: true,
  notes: true,
  voidedAt: true,
  correctionReason: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.WateringEventSelect;

const plantSelect = {
  id: true,
  reference: true,
  name: true,
  status: true,
  archivedAt: true,
} satisfies Prisma.PlantSelect;

export async function getPlantWateringHistory(plantId: string) {
  const id = parseWateringPlantId(plantId);
  return getPrisma().$transaction(
    async (tx) => {
      const plant = await tx.plant.findUnique({ where: { id }, select: plantSelect });
      if (!plant) throw new WateringError('PLANT_NOT_FOUND', 'This Plant could not be found.');
      const events = await tx.wateringEvent.findMany({
        where: { plantId: id },
        select: eventSelect,
        orderBy: [{ wateredAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      });
      return { plant, events };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}

export type PlantWateringHistory = Awaited<ReturnType<typeof getPlantWateringHistory>>;
export type WateringHistoryEvent = PlantWateringHistory['events'][number];

export async function getLatestQualifyingWateringEvent(plantId: string) {
  const id = parseWateringPlantId(plantId);
  return getPrisma().$transaction(
    async (tx) => {
      const plant = await tx.plant.findUnique({ where: { id }, select: { id: true } });
      if (!plant) throw new WateringError('PLANT_NOT_FOUND', 'This Plant could not be found.');
      return tx.wateringEvent.findFirst({
        where: { plantId: id, voidedAt: null },
        select: eventSelect,
        orderBy: [{ wateredAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
