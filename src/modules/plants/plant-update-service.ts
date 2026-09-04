import 'server-only';
import { Prisma, type Plant, type Location } from '../../generated/prisma/client';
import { getPrisma } from '../../lib/prisma';
import { PlantError } from './plant-errors';
import {
  parseUpdatePlantInput,
  type UpdatePlantInput,
  type ParsedUpdatePlantInput,
} from './plant-update-input';

export type { UpdatePlantInput } from './plant-update-input';
export type UpdatedPlant = Prisma.PlantGetPayload<{
  include: { parentage: true; purchase: true; location: true };
}>;

export async function updatePlant(plantId: string, input: UpdatePlantInput): Promise<UpdatedPlant> {
  const parsed = parseUpdatePlantInput(plantId, input);
  try {
    return await getPrisma().$transaction(
      (tx) => updatePlantInTransaction(tx, parsed.plantId, parsed.input),
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      ['P2002', 'P2003', 'P2034'].includes(error.code)
    ) {
      throw new PlantError(
        'CONFLICT',
        'The Plant could not be saved because of conflicting database data.',
        { cause: error },
      );
    }
    throw error;
  }
}

async function updatePlantInTransaction(
  tx: Prisma.TransactionClient,
  plantId: string,
  input: ParsedUpdatePlantInput,
): Promise<UpdatedPlant> {
  // One local namespace/key for all existing parentage mutations. Always acquire this
  // before the target Plant lock, then acquire any new Location lock last.
  // READ COMMITTED gives subsequent queries a fresh snapshot after any lock wait.
  if (input.parentage !== undefined) {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(1095650894, 1)::text AS locked`;
  }
  const [current] = await tx.$queryRaw<Plant[]>`
    SELECT * FROM public."Plant" WHERE "id" = ${plantId}::uuid FOR NO KEY UPDATE
  `;
  if (!current) throw new PlantError('NOT_FOUND', 'This Plant could not be found.');
  if (current.updatedAt.toISOString() !== input.expectedUpdatedAt) {
    throw new PlantError(
      'STALE_UPDATE',
      'This Plant has changed since you opened it. Review the latest details before saving again.',
    );
  }

  const locationId = input.locationId === undefined ? current.locationId : input.locationId;
  let location: Location | null = null;
  if (locationId && locationId !== current.locationId) {
    const [candidate] = await tx.$queryRaw<Location[]>`
      SELECT * FROM public."Location" WHERE "id" = ${locationId}::uuid FOR SHARE
    `;
    if (!candidate || candidate.archivedAt !== null) {
      throw new PlantError(
        'LOCATION_UNAVAILABLE',
        'Choose an existing Location that is not archived.',
        {
          issues: [{ field: 'locationId', message: 'This Location is missing or archived.' }],
        },
      );
    }
    location = candidate;
  } else if (locationId) {
    location = await tx.location.findUnique({ where: { id: locationId } });
  }

  let parentage = await tx.plantParentage.findUnique({ where: { plantId } });
  if (input.parentage !== undefined) {
    if (current.originSeedBatchId !== null) {
      throw new PlantError(
        'ORIGIN_PARENTAGE_LOCKED',
        'Parentage derived from SeedBatch provenance cannot be edited directly.',
      );
    }
    const parents = {
      seedParentPlantId: parentage?.seedParentPlantId ?? null,
      seedParentName: parentage?.seedParentName ?? null,
      pollenParentPlantId: parentage?.pollenParentPlantId ?? null,
      pollenParentName: parentage?.pollenParentName ?? null,
    };
    for (const role of ['seed', 'pollen'] as const) {
      const choice = input.parentage[`${role}Parent`];
      if (choice === undefined) continue;
      parents[`${role}ParentPlantId`] = choice.kind === 'plant' ? choice.plantId : null;
      parents[`${role}ParentName`] = choice.kind === 'external' ? choice.name : null;
      if (choice.kind === 'plant') await validateLinkedParent(tx, plantId, choice.plantId, role);
    }
    if (parentage) {
      parentage = await tx.plantParentage.update({ where: { plantId }, data: parents });
    } else if (Object.values(parents).some((value) => value !== null)) {
      parentage = await tx.plantParentage.create({ data: { plantId, ...parents } });
    }
  }

  // Only the service assigns the replacement timestamp. Advance even for related only
  // edits, same millisecond saves, and a server clock behind the previous timestamp.
  const plant = await tx.plant.update({
    where: { id: plantId },
    data: {
      name: input.name === undefined ? current.name : input.name,
      status: input.status ?? current.status,
      notes: input.notes === undefined ? current.notes : input.notes,
      locationId,
      updatedAt: new Date(Math.max(Date.now(), current.updatedAt.getTime() + 1)),
    },
  });
  let purchase = await tx.plantPurchase.findUnique({ where: { plantId } });
  if (input.purchase !== undefined) {
    const patch = input.purchase;
    const data = {
      seller: patch.seller === undefined ? (purchase?.seller ?? null) : patch.seller,
      orderReference:
        patch.orderReference === undefined
          ? (purchase?.orderReference ?? null)
          : patch.orderReference,
      purchaseDate:
        patch.purchaseDate === undefined
          ? (purchase?.purchaseDate ?? null)
          : patch.purchaseDate === null
            ? null
            : new Date(`${patch.purchaseDate}T00:00:00.000Z`),
      plantPriceMinor:
        patch.plantPriceMinor === undefined
          ? (purchase?.plantPriceMinor ?? null)
          : patch.plantPriceMinor,
      shippingCostMinor:
        patch.shippingCostMinor === undefined
          ? (purchase?.shippingCostMinor ?? null)
          : patch.shippingCostMinor,
      otherCostMinor:
        patch.otherCostMinor === undefined
          ? (purchase?.otherCostMinor ?? null)
          : patch.otherCostMinor,
      currency: patch.currency ?? purchase?.currency ?? 'GBP',
    };
    if (purchase) {
      if (Object.values(patch).some((value) => value !== undefined)) {
        purchase = await tx.plantPurchase.update({ where: { plantId }, data });
      }
    } else {
      purchase = await tx.plantPurchase.create({ data: { plantId, ...data } });
    }
  }
  return { ...plant, location, parentage, purchase };
}

async function validateLinkedParent(
  tx: Prisma.TransactionClient,
  plantId: string,
  parentId: string,
  role: 'seed' | 'pollen',
) {
  const field = `parentage.${role}Parent.plantId`;
  if (plantId === parentId) {
    throw new PlantError('INVALID_PARENT', 'A Plant cannot be its own parent.', {
      issues: [{ field, message: 'Choose a different Plant.' }],
    });
  }
  if (!(await tx.plant.findUnique({ where: { id: parentId }, select: { id: true } }))) {
    throw new PlantError('INVALID_PARENT', 'A linked parent Plant does not exist.', {
      issues: [{ field, message: 'Choose an existing Plant.' }],
    });
  }
  // UNION deduplicates the sole traversal column (Plant ID), so even existing bad
  // cycles terminate. Names and archive/status fields play no part in traversal.
  const [result] = await tx.$queryRaw<{ cycle: boolean }[]>`
    WITH RECURSIVE ancestors(id) AS (
      SELECT ${parentId}::uuid
      UNION
      SELECT parent.id
      FROM ancestors a
      JOIN public."PlantParentage" p ON p."plantId" = a.id
      CROSS JOIN LATERAL (VALUES (p."seedParentPlantId"), (p."pollenParentPlantId")) AS parent(id)
      WHERE parent.id IS NOT NULL
    )
    SELECT EXISTS (SELECT 1 FROM ancestors WHERE id = ${plantId}::uuid) AS cycle
  `;
  if (result.cycle) {
    throw new PlantError(
      'ANCESTRY_CYCLE',
      'This parent would create a loop in the Plant parentage.',
      {
        issues: [{ field, message: 'Choose a Plant that does not descend from this Plant.' }],
      },
    );
  }
}
