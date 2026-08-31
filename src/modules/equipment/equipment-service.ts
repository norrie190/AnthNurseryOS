import 'server-only';
import { Prisma, type Equipment } from '../../generated/prisma/client';
import { getPrisma } from '../../lib/prisma';
import { EquipmentError } from './equipment-errors';
import {
  parseCreateEquipmentInput,
  parseUpdateEquipmentInput,
  parseEquipmentArchiveInput,
  type CreateEquipmentInput,
  type UpdateEquipmentInput,
  type EquipmentArchiveInput,
  type EquipmentPurchasePatch,
} from './equipment-input';
import { formatEquipmentReference } from './equipment-reference';

export type {
  CreateEquipmentInput,
  UpdateEquipmentInput,
  EquipmentArchiveInput,
} from './equipment-input';
export type EquipmentRecord = Prisma.EquipmentGetPayload<{
  include: { location: true; purchase: true };
}>;
export type EquipmentArchiveResult = { equipment: Equipment; changed: boolean };

export async function createEquipment(input: CreateEquipmentInput): Promise<EquipmentRecord> {
  const parsed = parseCreateEquipmentInput(input);
  try {
    return await getPrisma().$transaction(
      async (tx) => {
        if (parsed.locationId) await validateLocation(tx, parsed.locationId);
        const [allocation] = await tx.$queryRaw<{ value: bigint }[]>`
        SELECT nextval('public.equipment_reference_sequence'::regclass) AS value
      `;
        const equipment = await tx.equipment.create({
          data: {
            reference: formatEquipmentReference(allocation.value),
            name: parsed.name,
            category: parsed.category,
            usesPower: parsed.usesPower,
            brand: parsed.brand,
            model: parsed.model,
            serialNumber: parsed.serialNumber,
            notes: parsed.notes,
            locationId: parsed.locationId,
          },
        });
        if (parsed.purchase !== undefined) await savePurchase(tx, equipment.id, parsed.purchase);
        return tx.equipment.findUniqueOrThrow({
          where: { id: equipment.id },
          include: { location: true, purchase: true },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  } catch (error) {
    throwEquipmentConflict(error);
  }
}

export async function updateEquipment(
  equipmentId: string,
  input: UpdateEquipmentInput,
): Promise<EquipmentRecord> {
  const parsed = parseUpdateEquipmentInput(equipmentId, input);
  const patch = parsed.input;
  try {
    return await getPrisma().$transaction(
      async (tx) => {
        const current = await lockEquipment(tx, parsed.equipmentId);
        requireCurrentToken(current, patch.expectedUpdatedAt);
        // Equipment first, then a changed Location. An unchanged archived assignment is valid.
        if (patch.locationId && patch.locationId !== current.locationId) {
          await validateLocation(tx, patch.locationId);
        }
        await tx.equipment.update({
          where: { id: current.id },
          data: {
            name: patch.name,
            category: patch.category,
            usesPower: patch.usesPower,
            brand: patch.brand,
            model: patch.model,
            serialNumber: patch.serialNumber,
            notes: patch.notes,
            locationId: patch.locationId,
            updatedAt: nextTimestamp(current),
          },
        });
        if (patch.purchase !== undefined) await savePurchase(tx, current.id, patch.purchase);
        return tx.equipment.findUniqueOrThrow({
          where: { id: current.id },
          include: { location: true, purchase: true },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  } catch (error) {
    throwEquipmentConflict(error);
  }
}

export function archiveEquipment(
  equipmentId: string,
  input: EquipmentArchiveInput,
): Promise<EquipmentArchiveResult> {
  return changeEquipmentArchive(equipmentId, input, true);
}
export function restoreEquipment(
  equipmentId: string,
  input: EquipmentArchiveInput,
): Promise<EquipmentArchiveResult> {
  return changeEquipmentArchive(equipmentId, input, false);
}

async function changeEquipmentArchive(
  equipmentId: string,
  input: EquipmentArchiveInput,
  archived: boolean,
): Promise<EquipmentArchiveResult> {
  const parsed = parseEquipmentArchiveInput(equipmentId, input);
  try {
    return await getPrisma().$transaction(
      async (tx) => {
        const current = await lockEquipment(tx, parsed.equipmentId);
        // Match Plants: repeated requests preserve both timestamps, even with the old token.
        if ((current.archivedAt !== null) === archived)
          return { equipment: current, changed: false };
        requireCurrentToken(current, parsed.input.expectedUpdatedAt);
        const equipment = await tx.equipment.update({
          where: { id: current.id },
          data: { archivedAt: archived ? new Date() : null, updatedAt: nextTimestamp(current) },
        });
        return { equipment, changed: true };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  } catch (error) {
    throwEquipmentConflict(error);
  }
}

async function lockEquipment(tx: Prisma.TransactionClient, equipmentId: string) {
  const [current] = await tx.$queryRaw<Equipment[]>`
    SELECT * FROM public."Equipment" WHERE id = ${equipmentId}::uuid FOR NO KEY UPDATE
  `;
  if (!current) throw new EquipmentError('NOT_FOUND', 'This Equipment could not be found.');
  return current;
}
function requireCurrentToken(current: Equipment, expectedUpdatedAt: string) {
  if (current.updatedAt.toISOString() !== expectedUpdatedAt) {
    throw new EquipmentError(
      'STALE_UPDATE',
      'This Equipment has changed since you opened it. Review the latest details before saving again.',
    );
  }
}
function nextTimestamp(current: Equipment) {
  return new Date(Math.max(Date.now(), current.updatedAt.getTime() + 1));
}
async function validateLocation(tx: Prisma.TransactionClient, locationId: string) {
  // SHARE also blocks archive edits, unlike KEY SHARE. Held only until this short transaction ends.
  const [location] = await tx.$queryRaw<{ archivedAt: Date | null }[]>`
    SELECT "archivedAt" FROM public."Location" WHERE id = ${locationId}::uuid FOR SHARE
  `;
  if (!location || location.archivedAt !== null) {
    throw new EquipmentError(
      'LOCATION_UNAVAILABLE',
      'Choose an existing Location that is not archived.',
      {
        issues: [{ field: 'locationId', message: 'This Location is missing or archived.' }],
      },
    );
  }
}

async function savePurchase(
  tx: Prisma.TransactionClient,
  equipmentId: string,
  patch: EquipmentPurchasePatch,
) {
  const current = await tx.equipmentPurchase.findUnique({ where: { equipmentId } });
  // Undefined is omitted by Prisma; null intentionally clears. Only approved scalars are mapped.
  const data = {
    seller: patch.seller,
    orderReference: patch.orderReference,
    purchaseDate:
      patch.purchaseDate === undefined
        ? undefined
        : patch.purchaseDate === null
          ? null
          : new Date(`${patch.purchaseDate}T00:00:00.000Z`),
    equipmentPriceMinor: patch.equipmentPriceMinor,
    shippingCostMinor: patch.shippingCostMinor,
    otherCostMinor: patch.otherCostMinor,
    currency: patch.currency,
  };
  if (!current) {
    await tx.equipmentPurchase.create({ data: { equipmentId, ...data } });
  } else if (Object.values(data).some((value) => value !== undefined)) {
    await tx.equipmentPurchase.update({ where: { equipmentId }, data });
  }
}
function throwEquipmentConflict(error: unknown): never {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    ['P2002', 'P2003', 'P2034'].includes(error.code)
  ) {
    throw new EquipmentError(
      'CONFLICT',
      'The Equipment could not be saved because of conflicting database data.',
      { cause: error },
    );
  }
  // Unexpected infrastructure failures remain distinguishable, with their original diagnostics.
  throw error;
}
