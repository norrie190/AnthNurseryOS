import 'server-only';
import { Prisma, type Location } from '../../generated/prisma/client';
import { getPrisma } from '../../lib/prisma';
import { PlantError } from './plant-errors';
import {
  parseCreatePlantInput,
  type CreatePlantInput,
  type ParsedCreatePlantInput,
} from './plant-input';
import { formatPlantReference } from './plant-reference';

export type CreatedPlant = Prisma.PlantGetPayload<{
  include: { parentage: true; purchase: true; location: true };
}>;
export type { CreatePlantInput } from './plant-input';

export async function createPlant(input: CreatePlantInput): Promise<CreatedPlant> {
  const parsed = parseCreatePlantInput(input);
  try {
    return await getPrisma().$transaction((transaction) =>
      createPlantInTransaction(transaction, parsed),
    );
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      ['P2002', 'P2003', 'P2034'].includes(error.code)
    ) {
      throw new PlantError(
        'CONFLICT',
        'The Plant could not be saved because of conflicting database data.',
        {
          cause: error,
        },
      );
    }
    // Preserve unexpected infrastructure errors instead of presenting them as bad input.
    throw error;
  }
}

async function createPlantInTransaction(
  transaction: Prisma.TransactionClient,
  input: ParsedCreatePlantInput,
): Promise<CreatedPlant> {
  let location: Location | null = null;
  if (input.locationId) {
    // Hold this row stable until commit. KEY SHARE alone would allow archivedAt to change.
    const locations = await transaction.$queryRaw<Location[]>`
      SELECT "id", "name", "description", "parentLocationId", "createdAt", "updatedAt", "archivedAt"
      FROM public."Location"
      WHERE "id" = ${input.locationId}::uuid FOR SHARE
    `;
    location = locations[0] ?? null;
    if (!location || location.archivedAt !== null) {
      throw new PlantError(
        'LOCATION_UNAVAILABLE',
        'Choose an existing Location that is not archived.',
        {
          issues: [{ field: 'locationId', message: 'This Location is missing or archived.' }],
        },
      );
    }
  }

  const parentage = input.parentage;
  const parentIds = [
    ...new Set(
      [parentage?.seedParentPlantId, parentage?.pollenParentPlantId].filter(
        (id): id is string => !!id,
      ),
    ),
  ];
  if (parentIds.length) {
    const parents = await transaction.plant.findMany({
      where: { id: { in: parentIds } },
      select: { id: true },
    });
    const missing = parentIds.filter((id) => !parents.some((parent) => parent.id === id));
    if (missing.length)
      throw new PlantError('INVALID_PARENT', 'A linked parent Plant does not exist.');
  }

  const [allocation] = await transaction.$queryRaw<{ value: bigint }[]>`
    SELECT nextval('public.plant_reference_sequence'::regclass) AS value
  `;
  const plant = await transaction.plant.create({
    data: {
      reference: formatPlantReference(allocation.value),
      name: input.name,
      status: input.status,
      locationId: input.locationId,
      notes: input.notes,
    },
  });

  if (parentIds.includes(plant.id)) {
    throw new PlantError('INVALID_PARENT', 'A Plant cannot be its own parent.');
  }
  let createdParentage: CreatedPlant['parentage'] = null;
  if (parentage) {
    createdParentage = await transaction.plantParentage.create({
      data: {
        plantId: plant.id,
        seedParentPlantId: parentage.seedParentPlantId,
        seedParentName: parentage.seedParentName,
        pollenParentPlantId: parentage.pollenParentPlantId,
        pollenParentName: parentage.pollenParentName,
      },
    });
  }
  let createdPurchase: CreatedPlant['purchase'] = null;
  if (input.purchase) {
    const purchase = input.purchase;
    createdPurchase = await transaction.plantPurchase.create({
      data: {
        plantId: plant.id,
        seller: purchase.seller,
        orderReference: purchase.orderReference,
        purchaseDate: purchase.purchaseDate
          ? new Date(`${purchase.purchaseDate}T00:00:00.000Z`)
          : null,
        plantPriceMinor: purchase.plantPriceMinor,
        shippingCostMinor: purchase.shippingCostMinor,
        otherCostMinor: purchase.otherCostMinor,
        currency: purchase.currency,
      },
    });
  }
  return { ...plant, parentage: createdParentage, purchase: createdPurchase, location };
}
