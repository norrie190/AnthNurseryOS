import 'server-only';
import { z } from 'zod';
import { Prisma, type Plant } from '../../generated/prisma/client';
import { getPrisma } from '../../lib/prisma';
import { PlantError } from './plant-errors';
import { plantIdSchema } from './plant-field-schemas';

const archiveInputSchema = z.strictObject({ expectedUpdatedAt: z.iso.datetime({ precision: 3 }) });
export type PlantArchiveInput = z.input<typeof archiveInputSchema>;
export type PlantArchiveResult = { plant: Plant; changed: boolean };

export function archivePlant(
  plantId: string,
  input: PlantArchiveInput,
): Promise<PlantArchiveResult> {
  return changePlantArchive(plantId, input, true);
}

export function restorePlant(
  plantId: string,
  input: PlantArchiveInput,
): Promise<PlantArchiveResult> {
  return changePlantArchive(plantId, input, false);
}

async function changePlantArchive(
  plantId: string,
  input: PlantArchiveInput,
  archived: boolean,
): Promise<PlantArchiveResult> {
  const parsed = z
    .strictObject({ plantId: plantIdSchema, input: archiveInputSchema })
    .safeParse({ plantId, input });
  if (!parsed.success) {
    throw new PlantError(
      'VALIDATION_FAILED',
      'The Plant request was invalid. Reload its detail page and try again.',
      { cause: parsed.error },
    );
  }
  try {
    return await getPrisma().$transaction(
      async (tx) => {
        // Same target lock as editing. No relationship changes, so no parentage lock.
        const [current] = await tx.$queryRaw<Plant[]>`
        SELECT * FROM public."Plant" WHERE id = ${parsed.data.plantId}::uuid FOR NO KEY UPDATE
      `;
        if (!current) throw new PlantError('NOT_FOUND', 'This Plant could not be found.');
        // A repeated request is harmless even if its token predates the first request.
        // Do not replace either timestamp when the desired state is already present.
        if ((current.archivedAt !== null) === archived) return { plant: current, changed: false };
        if (current.updatedAt.toISOString() !== parsed.data.input.expectedUpdatedAt) {
          throw new PlantError(
            'STALE_UPDATE',
            'This Plant has changed since you opened it. Reload its details before changing its archive state.',
          );
        }
        const now = Date.now();
        const plant = await tx.plant.update({
          where: { id: current.id },
          data: {
            archivedAt: archived ? new Date(now) : null,
            updatedAt: new Date(Math.max(now, current.updatedAt.getTime() + 1)),
          },
        });
        return { plant, changed: true };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      ['P2002', 'P2003', 'P2034'].includes(error.code)
    ) {
      throw new PlantError(
        'CONFLICT',
        'The Plant archive state could not be changed because of conflicting database data.',
        { cause: error },
      );
    }
    throw error;
  }
}
