// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { getPrisma } from '../../src/lib/prisma';
import { deletePlantPhoto } from '../../src/modules/plants/plant-photo-service';
import { getPlantPhotoStorage } from '../../src/modules/plants/plant-photo-storage';
import { createPhotoKeys, photoAssetPrefix } from '../../src/modules/plants/plant-photo-keys';
import { fakePlantPhotoStorage } from '../helpers/fake-plant-photo-storage';

vi.mock('server-only', () => ({}));
vi.mock('../../src/lib/prisma', () => ({ getPrisma: vi.fn() }));
vi.mock('../../src/modules/plants/plant-photo-storage', () => ({ getPlantPhotoStorage: vi.fn() }));
const plantId = randomUUID();
const photoId = randomUUID();
const updatedAt = new Date('2026-08-31T12:00:00.000Z');
const originalKey = createPhotoKeys(plantId, 'png').original;
const photo = { id: photoId, plantId, storageKey: originalKey, isPrimary: true };
const tx = {
  $queryRaw: vi.fn(),
  plant: { update: vi.fn() },
  plantPhoto: { findUnique: vi.fn(), findFirst: vi.fn(), delete: vi.fn(), update: vi.fn() },
};
const db = { $transaction: vi.fn() };
let fake: ReturnType<typeof fakePlantPhotoStorage>;
const input = () => ({ expectedUpdatedAt: updatedAt.toISOString(), confirmed: true as const });
beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  fake = fakePlantPhotoStorage();
  vi.mocked(getPlantPhotoStorage).mockReturnValue(fake.storage);
  vi.mocked(getPrisma).mockReturnValue(db as unknown as ReturnType<typeof getPrisma>);
  db.$transaction.mockImplementation(async (op) => op(tx));
  tx.$queryRaw.mockResolvedValue([{ id: plantId, updatedAt }]);
  tx.plantPhoto.findUnique.mockResolvedValue(photo);
  tx.plantPhoto.findFirst.mockResolvedValue(null);
  tx.plant.update.mockImplementation(async ({ data }) => data);
});
afterEach(() => vi.restoreAllMocks());

test('deletes only the known photo, advances timestamp and waits for commit before R2', async () => {
  let committed = false;
  db.$transaction.mockImplementation(async (op) => {
    const result = await op(tx);
    expect(fake.storage.removePhotoAsset).not.toHaveBeenCalled();
    committed = true;
    return result;
  });
  fake.storage.removePhotoAsset.mockImplementation(async (key) => {
    expect(committed).toBe(true);
    expect(key).toBe(originalKey);
  });
  const result = await deletePlantPhoto(plantId, photoId, input());
  expect(result).toMatchObject({
    deletedPhotoId: photoId,
    primaryPhotoId: null,
    cleanupPending: false,
  });
  expect(result.plantUpdatedAt.getTime()).toBeGreaterThan(updatedAt.getTime());
  expect(tx.plantPhoto.delete).toHaveBeenCalledExactlyOnceWith({ where: { id: photoId } });
  expect(tx.plantPhoto.update).not.toHaveBeenCalled();
  expect(tx.plant.update).toHaveBeenCalledExactlyOnceWith({
    where: { id: plantId },
    data: { updatedAt: result.plantUpdatedAt },
    select: { updatedAt: true },
  });
});

test.each([true, false])('primary deletion promotes only when needed (%s)', async (isPrimary) => {
  tx.plantPhoto.findUnique.mockResolvedValue({ ...photo, isPrimary });
  const nextId = randomUUID();
  tx.plantPhoto.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: nextId });
  expect((await deletePlantPhoto(plantId, photoId, input())).primaryPhotoId).toBe(nextId);
  expect(tx.plantPhoto.findFirst.mock.calls[1][0]).toEqual({
    where: { plantId, ...(isPrimary ? {} : { isPrimary: true }) },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true },
  });
  expect(tx.plantPhoto.update).toHaveBeenCalledTimes(isPrimary ? 1 : 0);
});

test.each([
  'stale',
  'plant-missing',
  'photo-missing',
  'other-owner',
  'foreign-key',
  'shared-asset',
])('rejects %s before deletion or storage access', async (failure) => {
  if (failure === 'stale')
    tx.$queryRaw.mockResolvedValue([{ updatedAt: new Date(updatedAt.getTime() + 1) }]);
  if (failure === 'plant-missing') tx.$queryRaw.mockResolvedValue([]);
  if (failure === 'photo-missing') tx.plantPhoto.findUnique.mockResolvedValue(null);
  if (failure === 'other-owner')
    tx.plantPhoto.findUnique.mockResolvedValue({ ...photo, plantId: randomUUID() });
  if (failure === 'foreign-key')
    tx.plantPhoto.findUnique.mockResolvedValue({
      ...photo,
      storageKey: createPhotoKeys(randomUUID(), 'png').original,
    });
  if (failure === 'shared-asset') tx.plantPhoto.findFirst.mockResolvedValue({ id: randomUUID() });
  await expect(deletePlantPhoto(plantId, photoId, input())).rejects.toThrow();
  expect(tx.plantPhoto.delete).not.toHaveBeenCalled();
  expect(getPlantPhotoStorage).not.toHaveBeenCalled();
});

test.each([
  { confirmed: false },
  { confirmed: undefined },
  { storageKey: originalKey },
  { photoId: randomUUID() },
  { isPrimary: true },
  { expectedUpdatedAt: 'invalid' },
  { deleteMany: {} },
  { prefix: 'plants/' },
])('rejects unconfirmed, malformed or injected inputs %j', async (extra) => {
  await expect(
    deletePlantPhoto(plantId, photoId, { ...input(), ...extra } as ReturnType<typeof input>),
  ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  expect(db.$transaction).not.toHaveBeenCalled();
  expect(getPlantPhotoStorage).not.toHaveBeenCalled();
});

test('definite rollback never cleans storage', async () => {
  const failure = new Error('database offline');
  tx.plant.update.mockRejectedValue(failure);
  await expect(deletePlantPhoto(plantId, photoId, input())).rejects.toBe(failure);
  expect(getPlantPhotoStorage).not.toHaveBeenCalled();
});

test('resolved deletion reports actual database primary and timestamp, not an uncertain callback snapshot', async () => {
  const newer = new Date(updatedAt.getTime() + 1000);
  const remainingId = randomUUID();
  db.$transaction.mockImplementationOnce(async (op) => {
    await op(tx);
    throw new Error('commit lost');
  });
  tx.$queryRaw
    .mockResolvedValueOnce([{ id: plantId, updatedAt }])
    .mockResolvedValueOnce([{ id: plantId, updatedAt: newer }]);
  tx.plantPhoto.findFirst
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce({ id: remainingId });
  const result = await deletePlantPhoto(plantId, photoId, input());
  expect(result).toMatchObject({
    primaryPhotoId: remainingId,
    plantUpdatedAt: newer,
    cleanupPending: false,
  });
});

test.each(['cleanup', 'configuration'])(
  'a postcommit %s failure returns deletion success with a safe warning',
  async (stage) => {
    const failure = new Error('secret-bearing provider error');
    if (stage === 'cleanup') fake.storage.removePhotoAsset.mockRejectedValue(failure);
    else
      vi.mocked(getPlantPhotoStorage).mockImplementation(() => {
        throw failure;
      });
    const result = await deletePlantPhoto(plantId, photoId, input());
    expect(result.cleanupPending).toBe(true);
    expect(db.$transaction).toHaveBeenCalledOnce();
    expect(console.error).toHaveBeenCalledWith(expect.any(String), {
      plantId,
      photoId,
      assetPrefix: photoAssetPrefix(originalKey),
    });
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('secret-bearing');
  },
);

test.each(['absent', 'present', 'unavailable'])(
  'uncertain commit resolves %s without blind cleanup',
  async (outcome) => {
    const failure = new Error('commit acknowledgement lost');
    db.$transaction.mockImplementationOnce(async (op) => {
      await op(tx);
      throw failure;
    });
    if (outcome === 'unavailable') db.$transaction.mockRejectedValueOnce(new Error('offline'));
    if (outcome === 'present')
      tx.plantPhoto.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: photoId });
    if (outcome === 'absent') {
      expect((await deletePlantPhoto(plantId, photoId, input())).cleanupPending).toBe(false);
      expect(fake.storage.removePhotoAsset).toHaveBeenCalledOnce();
    } else {
      await expect(deletePlantPhoto(plantId, photoId, input())).rejects.toThrow();
      expect(getPlantPhotoStorage).not.toHaveBeenCalled();
    }
    expect(db.$transaction).toHaveBeenCalledTimes(2);
  },
);
