// @vitest-environment node
import { beforeEach, expect, test, vi } from 'vitest';
import { Prisma } from '../../generated/prisma/client';
import {
  createEquipment,
  updateEquipment,
  archiveEquipment,
  restoreEquipment,
} from './equipment-service';
import { getEquipmentById } from './equipment-queries';
import type { CreateEquipmentInput, UpdateEquipmentInput } from './equipment-input';

vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({ transaction: vi.fn(), findUnique: vi.fn() }));
vi.mock('../../lib/prisma', () => ({
  getPrisma: () => ({
    $transaction: mocks.transaction,
    equipment: { findUnique: mocks.findUnique },
  }),
}));
const id = 'ba576170-0776-4f0e-90d9-353cc6518611';
const locationId = 'dfa9ab36-c69c-48ad-b759-b110416c2340';
const current = {
  id,
  reference: 'EQP-0001',
  name: 'Light',
  category: 'Other',
  usesPower: true,
  brand: null,
  model: null,
  serialNumber: null,
  notes: null,
  locationId: null,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  archivedAt: null,
};
const token = { expectedUpdatedAt: current.updatedAt.toISOString() };
beforeEach(() => vi.resetAllMocks());

test('locks Equipment before a changed Location, with no parentage advisory lock', async () => {
  const statements: string[] = [];
  const query = vi.fn(async (strings: TemplateStringsArray) => {
    const sql = strings.join('?');
    statements.push(sql);
    return sql.includes('"Equipment"') ? [current] : [{ archivedAt: null }];
  });
  const tx = {
    $queryRaw: query,
    equipment: { update: vi.fn(), findUniqueOrThrow: vi.fn().mockResolvedValue(current) },
  };
  mocks.transaction.mockImplementation(async (operation) => operation(tx));
  await updateEquipment(id, { ...token, locationId });
  expect(statements).toHaveLength(2);
  expect(statements[0]).toContain('FOR NO KEY UPDATE');
  expect(statements[1]).toContain('FOR SHARE');
  expect(statements.join(' ')).not.toMatch(/advisory|nextval/);
  expect(tx.equipment.update).toHaveBeenCalledWith(
    expect.objectContaining({ data: expect.objectContaining({ locationId }) }),
  );
});
test('stale token is checked after row lock and before Location validation or writes', async () => {
  const query = vi.fn().mockResolvedValue([{ ...current, updatedAt: new Date('2026-02-01') }]);
  const update = vi.fn();
  mocks.transaction.mockImplementation(async (operation) =>
    operation({ $queryRaw: query, equipment: { update } }),
  );
  await expect(updateEquipment(id, { ...token, locationId })).rejects.toMatchObject({
    code: 'STALE_UPDATE',
  });
  expect(query).toHaveBeenCalledTimes(1);
  expect(query.mock.calls[0][0].join('')).toContain('FOR NO KEY UPDATE');
  expect(update).not.toHaveBeenCalled();
});
test('creation holds a Location SHARE lock before allocating the EQP reference', async () => {
  const statements: string[] = [];
  const query = vi.fn(async (strings: TemplateStringsArray) => {
    const sql = strings.join('?');
    statements.push(sql);
    return sql.includes('Location') ? [{ archivedAt: null }] : [{ value: 10000n }];
  });
  const create = vi.fn().mockResolvedValue(current);
  mocks.transaction.mockImplementation(async (operation) =>
    operation({
      $queryRaw: query,
      equipment: { create, findUniqueOrThrow: vi.fn().mockResolvedValue(current) },
    }),
  );
  await createEquipment({ name: 'Light', usesPower: true, locationId });
  expect(statements[0]).toContain('FOR SHARE');
  expect(statements[1]).toContain('public.equipment_reference_sequence');
  expect(create).toHaveBeenCalledWith({
    data: expect.objectContaining({ reference: 'EQP-10000' }),
  });
  const data = create.mock.calls[0][0].data;
  for (const key of ['id', 'createdAt', 'updatedAt', 'archivedAt'])
    expect(data).not.toHaveProperty(key);
});
test.each(['P2002', 'P2003', 'P2034'])(
  'maps expected database conflict %s and retains cause',
  async (code) => {
    const cause = new Prisma.PrismaClientKnownRequestError('Private database detail', {
      code,
      clientVersion: '7.10.0',
    });
    mocks.transaction.mockRejectedValue(cause);
    const operations = [
      () => createEquipment({ name: 'Light', usesPower: true }),
      () => updateEquipment(id, token),
      () => archiveEquipment(id, token),
      () => restoreEquipment(id, token),
    ];
    for (const operation of operations) {
      await expect(operation()).rejects.toMatchObject({ code: 'CONFLICT', cause });
      await expect(operation()).rejects.not.toHaveProperty('message', cause.message);
    }
  },
);
test('unexpected infrastructure error remains the original error', async () => {
  const error = new Error('Connection failed');
  mocks.transaction.mockRejectedValue(error);
  for (const operation of [
    () => createEquipment({ name: 'Light', usesPower: true }),
    () => updateEquipment(id, token),
    () => archiveEquipment(id, token),
    () => restoreEquipment(id, token),
  ]) {
    await expect(operation()).rejects.toBe(error);
  }
});
test('public operations reject arbitrary nested inputs before opening a transaction', async () => {
  await expect(
    createEquipment({
      name: 'Light',
      usesPower: true,
      reference: 'EQP-0999',
    } as unknown as CreateEquipmentInput),
  ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  await expect(
    updateEquipment(id, {
      ...token,
      purchase: { delete: true },
    } as unknown as UpdateEquipmentInput),
  ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  await expect(
    archiveEquipment(id, { ...token, archivedAt: null } as unknown as typeof token),
  ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  await expect(restoreEquipment('invalid', token)).rejects.toMatchObject({
    code: 'VALIDATION_FAILED',
  });
  expect(mocks.transaction).not.toHaveBeenCalled();
});
test('malformed detail lookup never reaches the database', async () => {
  expect(await getEquipmentById('EQP-0001')).toBeNull();
  expect(mocks.findUnique).not.toHaveBeenCalled();
});
