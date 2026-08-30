import 'server-only';
import { z } from 'zod';
import { getPrisma } from '../../lib/prisma';
import type { PlantSelectOption } from './plant-form-state';
import { plantStatusLabels } from './plant-form-state';

export async function getPlantById(plantId: string) {
  if (!z.uuid().safeParse(plantId).success) return null;
  return getPrisma().plant.findUnique({
    where: { id: plantId },
    include: {
      location: true,
      purchase: true,
      parentage: {
        include: {
          seedParent: { select: { id: true, reference: true, name: true } },
          pollenParent: { select: { id: true, reference: true, name: true } },
        },
      },
    },
  });
}
export type PlantDetailRecord = NonNullable<Awaited<ReturnType<typeof getPlantById>>>;

export async function getPlantParentOptions(): Promise<PlantSelectOption[]> {
  const plants = await getPrisma().plant.findMany({
    select: { id: true, reference: true, name: true, status: true, archivedAt: true },
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
  });
  return plants.map((plant) => ({
    id: plant.id,
    label: `${plant.reference} — ${plant.name || 'Unnamed Plant'}${plant.status !== 'GROWING' ? ` (${plantStatusLabels[plant.status]})` : ''}${plant.archivedAt ? ' (Archived)' : ''}`,
  }));
}

export async function getUsableLocationOptions(): Promise<PlantSelectOption[]> {
  const locations = await getPrisma().location.findMany({
    where: { archivedAt: null },
    select: { id: true, name: true, parentLocation: { select: { name: true } } },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
  });
  return locations.map((location) => ({
    id: location.id,
    label: location.parentLocation
      ? `${location.parentLocation.name} / ${location.name}`
      : location.name,
  }));
}
