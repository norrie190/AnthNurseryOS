import { randomUUID } from 'node:crypto';
import { beforeEach, expect, test, vi } from 'vitest';
import { Prisma } from '../../src/generated/prisma/client';
import { getPrisma } from '../../src/lib/prisma';
import { archivePlant, restorePlant } from '../../src/modules/plants/plant-archive-service';

vi.mock('server-only', () => ({}));
vi.mock('../../src/lib/prisma', () => ({ getPrisma: vi.fn() }));
const id = randomUUID();
const input = { expectedUpdatedAt: '2026-08-31T10:00:00.000Z' };
beforeEach(() => vi.resetAllMocks());
for (const operation of [archivePlant, restorePlant]) {
  test.each([
    {},
    { expectedUpdatedAt: undefined },
    { expectedUpdatedAt: 'invalid' },
    { ...input, id },
    { ...input, reference: 'ANT-0002' },
    { ...input, status: 'DECEASED' },
    { ...input, archivedAt: null },
    { ...input, createdAt: input.expectedUpdatedAt },
    { ...input, updatedAt: input.expectedUpdatedAt },
    { ...input, purchase: { delete: true } },
  ])(operation.name + ' rejects restricted input %j before opening the database', async (value) => {
    await expect(operation(id, value as typeof input)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    expect(getPrisma).not.toHaveBeenCalled();
  });
  test(operation.name + ' rejects malformed target IDs', async () => {
    await expect(operation('ANT-0001', input)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(getPrisma).not.toHaveBeenCalled();
  });
  test(operation.name + ' preserves unexpected infrastructure errors', async () => {
    const cause = new Error('Connection failed');
    vi.mocked(getPrisma).mockImplementation(() => {
      throw cause;
    });
    await expect(operation(id, input)).rejects.toBe(cause);
  });
  test.each(['P2002', 'P2003', 'P2034'])(
    operation.name + ' preserves the cause of conflict %s',
    async (code) => {
      const cause = new Prisma.PrismaClientKnownRequestError('Database details', {
        code,
        clientVersion: '7.10.0',
      });
      vi.mocked(getPrisma).mockImplementation(() => {
        throw cause;
      });
      await expect(operation(id, input)).rejects.toMatchObject({ code: 'CONFLICT', cause });
    },
  );
}
