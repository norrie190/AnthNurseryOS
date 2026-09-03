import { randomUUID } from 'node:crypto';
import { beforeEach, expect, test, vi } from 'vitest';
import { getPrisma } from '../../src/lib/prisma';
import { changeWateringSchedule } from '../../src/modules/watering/watering-schedule-service';

vi.mock('server-only', () => ({}));
vi.mock('../../src/lib/prisma', () => ({ getPrisma: vi.fn() }));

const plantId = randomUUID();

beforeEach(() => vi.resetAllMocks());

test('normal schedule changes serialize on the Plant without writing it', async () => {
  const created = { id: randomUUID(), plantId, intervalDays: 7 };
  const queryRaw = vi.fn().mockResolvedValue([
    {
      id: plantId,
      status: 'GROWING',
      archivedAt: null,
      databaseNow: new Date('2026-09-03T10:00:00.000Z'),
    },
  ]);
  const plantUpdate = vi.fn();
  const create = vi.fn().mockResolvedValue(created);
  const tx = {
    $queryRaw: queryRaw,
    plant: { update: plantUpdate },
    wateringSchedulePeriod: { findMany: vi.fn().mockResolvedValue([]), create },
  };
  const transaction = vi.fn(async (operation, options) => {
    expect(options).toEqual({ isolationLevel: 'ReadCommitted' });
    return operation(tx);
  });
  vi.mocked(getPrisma).mockReturnValue({ $transaction: transaction } as never);

  await expect(
    changeWateringSchedule(plantId, { intervalDays: 7, effectiveFrom: '2026-09-03' }),
  ).resolves.toEqual(created);
  const sql = (queryRaw.mock.calls[0][0] as TemplateStringsArray).join('?');
  expect(sql).toContain('FOR NO KEY UPDATE');
  expect(create).toHaveBeenCalledOnce();
  expect(plantUpdate).not.toHaveBeenCalled();
});

test('eligibility is checked from the locked Plant state', async () => {
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([
      {
        id: plantId,
        status: 'SOLD',
        archivedAt: null,
        databaseNow: new Date(),
      },
    ]),
    wateringSchedulePeriod: { findMany: vi.fn(), create: vi.fn() },
  };
  vi.mocked(getPrisma).mockReturnValue({
    $transaction: vi.fn((operation) => operation(tx)),
  } as never);
  await expect(
    changeWateringSchedule(plantId, { intervalDays: 7, effectiveFrom: '2026-09-03' }),
  ).rejects.toMatchObject({ code: 'PLANT_NOT_ELIGIBLE' });
  expect(tx.wateringSchedulePeriod.findMany).not.toHaveBeenCalled();
  expect(tx.wateringSchedulePeriod.create).not.toHaveBeenCalled();
});

test.each([
  { intervalDays: 0, effectiveFrom: '2026-09-03' },
  { intervalDays: 366, effectiveFrom: '2026-09-03' },
  { intervalDays: 7, effectiveFrom: 'not-a-date' },
  { intervalDays: 7, effectiveFrom: '2026-09-03', anchorDate: '2026-09-03' },
])('invalid or protected schedule input is rejected before database access %#', async (input) => {
  await expect(changeWateringSchedule(plantId, input as never)).rejects.toMatchObject({
    code: 'VALIDATION_FAILED',
  });
  expect(getPrisma).not.toHaveBeenCalled();
});

test('PostgreSQL exclusion conflicts become schedule domain conflicts', async () => {
  const cause = { code: '23P01' };
  vi.mocked(getPrisma).mockReturnValue({
    $transaction: vi.fn().mockRejectedValue(cause),
  } as never);
  await expect(
    changeWateringSchedule(plantId, { intervalDays: 7, effectiveFrom: '2026-09-03' }),
  ).rejects.toMatchObject({ code: 'SCHEDULE_CONFLICT', cause });
});
