import { randomUUID } from 'node:crypto';
import { beforeEach, expect, test, vi } from 'vitest';
import { Prisma } from '../../src/generated/prisma/client';
import { getPrisma } from '../../src/lib/prisma';
import { updatePlant } from '../../src/modules/plants/plant-update-service';

vi.mock('server-only', () => ({}));
vi.mock('../../src/lib/prisma', () => ({ getPrisma: vi.fn() }));
const id = randomUUID();
const input = { expectedUpdatedAt: '2026-08-30T12:00:00.000Z' };
beforeEach(() => vi.resetAllMocks());
test('rejects protected input before connecting to the database', async () => {
  // @ts-expect-error A reference is not editable.
  await expect(updatePlant(id, { ...input, reference: 'ANT-9999' })).rejects.toMatchObject({
    code: 'VALIDATION_FAILED',
  });
  expect(getPrisma).not.toHaveBeenCalled();
});
test('preserves unexpected infrastructure errors', async () => {
  const error = new Error('Connection failure');
  vi.mocked(getPrisma).mockImplementation(() => {
    throw error;
  });
  await expect(updatePlant(id, input)).rejects.toBe(error);
});
test.each(['P2002', 'P2003', 'P2034'])(
  'preserves the cause of database conflict %s',
  async (code) => {
    const cause = new Prisma.PrismaClientKnownRequestError('Details', {
      code,
      clientVersion: '7.10.0',
    });
    vi.mocked(getPrisma).mockImplementation(() => {
      throw cause;
    });
    await expect(updatePlant(id, input)).rejects.toMatchObject({ code: 'CONFLICT', cause });
  },
);
