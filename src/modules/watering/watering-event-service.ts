import 'server-only';
import { Prisma, type Plant, type WateringEvent } from '../../generated/prisma/client';
import { getPrisma } from '../../lib/prisma';
import { WateringError } from './watering-errors';
import {
  parseCorrectWateringEventInput,
  parseRecordWateringEventInput,
  parseVoidWateringEventInput,
  type CorrectWateringEventInput,
  type RecordWateringEventInput,
  type VoidWateringEventInput,
} from './watering-input';
import { nextWateringTimestamp, throwWateringDatabaseError } from './watering-persistence';

export type {
  CorrectWateringEventInput,
  RecordWateringEventInput,
  VoidWateringEventInput,
} from './watering-input';

type LockedPlant = Pick<Plant, 'id' | 'status' | 'archivedAt'> & { databaseNow: Date };
type LockedWateringEvent = WateringEvent & { databaseNow: Date };

function ensureNotFuture(wateredAt: Date, databaseNow: Date) {
  if (wateredAt.getTime() > databaseNow.getTime()) {
    throw new WateringError(
      'FUTURE_WATERING',
      'A watering event cannot be recorded in the future.',
      { issues: [{ field: 'wateredAt', message: 'Enter a time that is not in the future.' }] },
    );
  }
}

function ensureEventToken(event: WateringEvent, expectedUpdatedAt: string) {
  if (event.updatedAt.toISOString() !== expectedUpdatedAt) {
    throw new WateringError(
      'STALE_UPDATE',
      'This watering event has changed. Review the latest history before trying again.',
    );
  }
}

async function lockOwnedEvent(
  tx: Prisma.TransactionClient,
  plantId: string,
  eventId: string,
): Promise<LockedWateringEvent> {
  const [event] = await tx.$queryRaw<LockedWateringEvent[]>`
    SELECT event.*, clock_timestamp() AS "databaseNow"
    FROM public."WateringEvent" event
    WHERE event."id" = ${eventId}::uuid AND event."plantId" = ${plantId}::uuid
    FOR NO KEY UPDATE
  `;
  if (!event) {
    throw new WateringError(
      'EVENT_NOT_FOUND',
      'This watering event could not be found for the selected Plant.',
    );
  }
  return event;
}

export async function recordWateringEvent(
  plantId: string,
  input: RecordWateringEventInput,
): Promise<WateringEvent> {
  const parsed = parseRecordWateringEventInput(plantId, input);
  try {
    return await getPrisma().$transaction(
      async (tx) => {
        // Serialize eligibility with Plant status/archive writes, without changing Plant.updatedAt.
        const [plant] = await tx.$queryRaw<LockedPlant[]>`
          SELECT "id", "status", "archivedAt", clock_timestamp() AS "databaseNow"
          FROM public."Plant"
          WHERE "id" = ${parsed.plantId}::uuid
          FOR NO KEY UPDATE
        `;
        if (!plant) throw new WateringError('PLANT_NOT_FOUND', 'This Plant could not be found.');
        if (
          plant.archivedAt !== null ||
          (plant.status !== 'GROWING' && plant.status !== 'QUARANTINE')
        ) {
          throw new WateringError(
            'PLANT_NOT_ELIGIBLE',
            'New watering events can only be recorded for active Growing or Quarantine Plants.',
          );
        }
        ensureNotFuture(parsed.input.wateredAt, plant.databaseNow);
        return tx.wateringEvent.create({
          data: {
            plantId: plant.id,
            wateredAt: parsed.input.wateredAt,
            notes: parsed.input.notes ?? null,
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  } catch (error) {
    throwWateringDatabaseError(error);
  }
}

export async function correctWateringEvent(
  plantId: string,
  eventId: string,
  input: CorrectWateringEventInput,
): Promise<WateringEvent> {
  const parsed = parseCorrectWateringEventInput(plantId, eventId, input);
  try {
    return await getPrisma().$transaction(
      async (tx) => {
        const current = await lockOwnedEvent(tx, parsed.plantId, parsed.eventId);
        ensureEventToken(current, parsed.input.expectedUpdatedAt);
        if (current.voidedAt) {
          throw new WateringError(
            'ALREADY_VOIDED',
            'A voided watering event cannot be corrected. Record a replacement if needed.',
          );
        }
        const wateredAt = parsed.input.wateredAt ?? current.wateredAt;
        ensureNotFuture(wateredAt, current.databaseNow);
        return tx.wateringEvent.update({
          where: { id: current.id },
          data: {
            wateredAt,
            notes: parsed.input.notes === undefined ? current.notes : parsed.input.notes,
            correctionReason: parsed.input.correctionReason,
            updatedAt: nextWateringTimestamp(current.updatedAt, current.databaseNow),
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  } catch (error) {
    throwWateringDatabaseError(error);
  }
}

export async function voidWateringEvent(
  plantId: string,
  eventId: string,
  input: VoidWateringEventInput,
): Promise<WateringEvent> {
  const parsed = parseVoidWateringEventInput(plantId, eventId, input);
  try {
    return await getPrisma().$transaction(
      async (tx) => {
        const current = await lockOwnedEvent(tx, parsed.plantId, parsed.eventId);
        ensureEventToken(current, parsed.input.expectedUpdatedAt);
        if (current.voidedAt) {
          throw new WateringError('ALREADY_VOIDED', 'This watering event is already voided.');
        }
        return tx.wateringEvent.update({
          where: { id: current.id },
          data: {
            voidedAt: current.databaseNow,
            correctionReason: parsed.input.correctionReason,
            updatedAt: nextWateringTimestamp(current.updatedAt, current.databaseNow),
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  } catch (error) {
    throwWateringDatabaseError(error);
  }
}
