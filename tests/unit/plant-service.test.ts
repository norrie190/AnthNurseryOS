import { beforeEach, expect, test, vi } from 'vitest';
import { Prisma } from '../../src/generated/prisma/client';
import { getPrisma } from '../../src/lib/prisma';
import { createPlant } from '../../src/modules/plants/plant-service';

vi.mock('server-only', () => ({}));
vi.mock('../../src/lib/prisma', () => ({ getPrisma: vi.fn() }));

beforeEach(() => vi.resetAllMocks());

test('rejects input before opening a database connection', async () => {
  // @ts-expect-error Internal identity is not part of the public input type.
  await expect(createPlant({ id: 'injected' })).rejects.toMatchObject({
    code: 'VALIDATION_FAILED',
  });
  // @ts-expect-error Visible references are not part of the public input type.
  await expect(createPlant({ reference: 'ANT-0001' })).rejects.toMatchObject({
    code: 'VALIDATION_FAILED',
  });
  expect(getPrisma).not.toHaveBeenCalled();
});

test('preserves unexpected infrastructure errors unchanged', async () => {
  const cause = new Error('Connection unavailable');
  vi.mocked(getPrisma).mockImplementation(() => {
    throw cause;
  });
  await expect(createPlant({})).rejects.toBe(cause);
});

test.each(['P2002', 'P2003', 'P2034'])(
  'maps expected database conflict %s and preserves its cause',
  async (code) => {
    const cause = new Prisma.PrismaClientKnownRequestError('Database conflict', {
      code,
      clientVersion: '7.10.0',
    });
    vi.mocked(getPrisma).mockImplementation(() => {
      throw cause;
    });
    await expect(createPlant({})).rejects.toMatchObject({ code: 'CONFLICT', cause });
  },
);
