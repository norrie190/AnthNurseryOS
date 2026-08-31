import 'server-only';
import { getPrisma } from '../../lib/prisma';
import { equipmentIdSchema } from './equipment-input';

const listSelect = {
  id: true,
  reference: true,
  name: true,
  category: true,
  usesPower: true,
  location: { select: { id: true, name: true, archivedAt: true } },
  createdAt: true,
  archivedAt: true,
} as const;

export async function getEquipmentList() {
  return getPrisma().equipment.findMany({
    where: { archivedAt: null },
    select: listSelect,
    orderBy: [{ createdAt: 'desc' }, { reference: 'asc' }],
  });
}
export async function getArchivedEquipmentList() {
  return getPrisma().equipment.findMany({
    where: { archivedAt: { not: null } },
    select: listSelect,
    orderBy: [{ archivedAt: 'desc' }, { reference: 'asc' }],
  });
}
export async function getEquipmentById(equipmentId: string) {
  const id = equipmentIdSchema.safeParse(equipmentId);
  if (!id.success) return null;
  return getPrisma().equipment.findUnique({
    where: { id: id.data },
    include: { purchase: true, location: true },
  });
}
export async function getEquipmentLocationOptions() {
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
export type EquipmentListItem = Awaited<ReturnType<typeof getEquipmentList>>[number];
export type EquipmentDetailRecord = NonNullable<Awaited<ReturnType<typeof getEquipmentById>>>;
