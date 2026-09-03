import { randomUUID } from 'node:crypto';
import { beforeEach, expect, test, vi } from 'vitest';
import { Prisma } from '../../src/generated/prisma/client';
import { getPrisma } from '../../src/lib/prisma';
import {
  recordWateringBatch,
  recordWateringEvent,
} from '../../src/modules/watering/watering-event-service';
import { nextWateringTimestamp } from '../../src/modules/watering/watering-persistence';

vi.mock('server-only', () => ({}));
vi.mock('../../src/lib/prisma', () => ({ getPrisma: vi.fn() }));

const plantId = randomUUID();
const wateredAt = '2026-09-03T09:00:00.000Z';

beforeEach(() => vi.resetAllMocks());

test('event timestamps advance strictly even when the database clock is behind', () => {
  const previous = new Date('2099-01-01T00:00:00.999Z');
  expect(nextWateringTimestamp(previous, new Date('2026-09-03T10:00:00.000Z'))).toEqual(
    new Date('2099-01-01T00:00:01.000Z'),
  );
});

test('recording locks Plant eligibility without writing the Plant', async () => {
  const event = {
    id: randomUUID(),
    plantId,
    wateredAt: new Date(wateredAt),
    notes: null,
    voidedAt: null,
    correctionReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const queryRaw = vi.fn().mockResolvedValue([
    {
      id: plantId,
      status: 'GROWING',
      archivedAt: null,
      databaseNow: new Date('2026-09-03T10:00:00.000Z'),
    },
  ]);
  const create = vi.fn().mockResolvedValue(event);
  const plantUpdate = vi.fn();
  const tx = { $queryRaw: queryRaw, wateringEvent: { create }, plant: { update: plantUpdate } };
  const transaction = vi.fn(async (operation, options) => {
    expect(options).toEqual({ isolationLevel: 'ReadCommitted' });
    return operation(tx);
  });
  vi.mocked(getPrisma).mockReturnValue({ $transaction: transaction } as never);

  await expect(recordWateringEvent(plantId, { wateredAt })).resolves.toEqual(event);
  const sql = (queryRaw.mock.calls[0][0] as TemplateStringsArray).join('?');
  expect(sql).toContain('FOR NO KEY UPDATE');
  expect(sql).toContain('clock_timestamp()');
  expect(create).toHaveBeenCalledWith({
    data: { plantId, wateredAt: new Date(wateredAt), notes: null },
  });
  expect(plantUpdate).not.toHaveBeenCalled();
});

test('expected Prisma conflicts retain their cause as a Watering conflict', async () => {
  const cause = new Prisma.PrismaClientKnownRequestError('Conflict', {
    code: 'P2034',
    clientVersion: '7.10.0',
  });
  vi.mocked(getPrisma).mockReturnValue({
    $transaction: vi.fn().mockRejectedValue(cause),
  } as never);
  await expect(recordWateringEvent(plantId, { wateredAt })).rejects.toMatchObject({
    code: 'CONFLICT',
    cause,
  });
});

test('unexpected infrastructure failures remain unchanged', async () => {
  const cause = new Error('Connection failed');
  vi.mocked(getPrisma).mockImplementation(() => {
    throw cause;
  });
  await expect(recordWateringEvent(plantId, { wateredAt })).rejects.toBe(cause);
});

test('batch locks sorted Plants, reads one database timestamp and inserts one event per Plant', async () => {
  const first = randomUUID();
  const second = randomUUID();
  const now = new Date('2026-09-03T10:00:00.123Z');
  const queryRaw = vi
    .fn()
    .mockResolvedValueOnce([
      { id: second, status: 'QUARANTINE', archivedAt: null },
      { id: first, status: 'GROWING', archivedAt: null },
    ])
    .mockResolvedValueOnce([{ databaseNow: now }]);
  const createMany = vi.fn().mockResolvedValue({ count: 2 });
  const tx = { $queryRaw: queryRaw, wateringEvent: { createMany } };
  const transaction = vi.fn(async (operation, options) => {
    expect(options).toEqual({ isolationLevel: 'ReadCommitted' });
    return operation(tx);
  });
  vi.mocked(getPrisma).mockReturnValue({ $transaction: transaction } as never);

  await expect(
    recordWateringBatch({ plantIds: [second, first], notes: '  Morning round  ' }),
  ).resolves.toEqual({
    recorded: 2,
    wateredAt: now,
  });
  const sql = (queryRaw.mock.calls[0][0] as TemplateStringsArray).join('?');
  expect(sql).toContain('ORDER BY "id"');
  expect(sql).toContain('FOR NO KEY UPDATE');
  expect((queryRaw.mock.calls[1][0] as TemplateStringsArray).join('?')).toContain(
    'clock_timestamp()',
  );
  expect(createMany).toHaveBeenCalledWith({
    data: [
      ...[first, second].sort().map((plantId) => ({
        plantId,
        wateredAt: now,
        notes: 'Morning round',
      })),
    ],
  });
});
