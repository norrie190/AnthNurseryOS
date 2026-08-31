// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { getPrisma } from '../../src/lib/prisma';
import {
  uploadPlantPhoto,
  setPrimaryPlantPhoto,
} from '../../src/modules/plants/plant-photo-service';
import { getPlantPhotoReadUrl } from '../../src/modules/plants/plant-photo-queries';
import { getPlantPhotoStorage } from '../../src/modules/plants/plant-photo-storage';
import { createPhotoKeys } from '../../src/modules/plants/plant-photo-keys';
import { fakePlantPhotoStorage } from '../helpers/fake-plant-photo-storage';
import { photoFixture } from '../fixtures/plant-photo-images';
vi.mock('server-only', () => ({}));
vi.mock('../../src/lib/prisma', () => ({ getPrisma: vi.fn() }));
vi.mock('../../src/modules/plants/plant-photo-storage', () => ({ getPlantPhotoStorage: vi.fn() }));

const plantId = randomUUID();
const updatedAt = new Date('2026-08-31T11:00:00.000Z');
let fake: ReturnType<typeof fakePlantPhotoStorage>;
let image: Buffer;
const tx = {
  $queryRaw: vi.fn(),
  plant: { findUnique: vi.fn(), update: vi.fn() },
  plantPhoto: {
    create: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    updateMany: vi.fn(),
    update: vi.fn(),
  },
};
const database = { ...tx, $transaction: vi.fn() };
beforeEach(async () => {
  vi.resetAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  fake = fakePlantPhotoStorage();
  image = await photoFixture();
  vi.mocked(getPlantPhotoStorage).mockReturnValue(fake.storage);
  vi.mocked(getPrisma).mockReturnValue(database as unknown as ReturnType<typeof getPrisma>);
  tx.plant.findUnique.mockResolvedValue({ id: plantId, updatedAt });
  tx.$queryRaw.mockResolvedValue([{ id: plantId, updatedAt }]);
  tx.plant.update.mockResolvedValue({ updatedAt: new Date(updatedAt.getTime() + 1) });
  tx.plantPhoto.findFirst.mockResolvedValue(null);
  tx.plantPhoto.create.mockImplementation(async ({ data }) => ({ ...data, id: randomUUID() }));
  database.$transaction.mockImplementation(async (operation) => operation(tx));
});
afterEach(() => vi.restoreAllMocks());
const request = () => ({ image, expectedUpdatedAt: updatedAt.toISOString() });

test('finishes all storage writes before taking a database lock', async () => {
  const result = await uploadPlantPhoto(plantId, {
    ...request(),
    originalFilename: '../../fake.svg',
    caption: ' Leaf ',
  });
  expect(result.photo).toMatchObject({
    isPrimary: true,
    sortOrder: 0,
    originalFilename: 'fake.svg',
    caption: 'Leaf',
  });
  expect(result.photo.storageKey).toMatch(/\/original\.png$/);
  expect(fake.objects.size).toBe(3);
  expect(Math.max(...fake.storage.upload.mock.invocationCallOrder)).toBeLessThan(
    database.$transaction.mock.invocationCallOrder[0],
  );
  expect(tx.plant.findUnique.mock.invocationCallOrder[0]).toBeLessThan(
    fake.storage.upload.mock.invocationCallOrder[0],
  );
});
test.each([
  'id',
  'storageKey',
  'isPrimary',
  'sortOrder',
  'createdAt',
  'updatedAt',
  'delete',
  'photos',
])('rejects injected %s before touching the DB/storage', async (key) => {
  await expect(
    uploadPlantPhoto(plantId, { ...request(), [key]: 'injected' }),
  ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  expect(getPrisma).not.toHaveBeenCalled();
  expect(fake.storage.upload).not.toHaveBeenCalled();
});
test.each([null, { updatedAt: new Date(updatedAt.getTime() + 1) }])(
  'rejects missing or stale Plant before storage',
  async (current) => {
    tx.plant.findUnique.mockResolvedValue(current);
    await expect(uploadPlantPhoto(plantId, request())).rejects.toMatchObject({
      code: current ? 'STALE_UPDATE' : 'NOT_FOUND',
    });
    expect(fake.objects.size).toBe(0);
    expect(database.$transaction).not.toHaveBeenCalled();
  },
);
test('malformed bytes cause no storage writes or metadata', async () => {
  await expect(
    uploadPlantPhoto(plantId, { ...request(), image: Buffer.from('not a photo') }),
  ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  expect(fake.storage.upload).not.toHaveBeenCalled();
  expect(database.$transaction).not.toHaveBeenCalled();
});
test.each([1, 2, 3])(
  'cleans the attempted keys when upload %i fails, including a lost PUT response',
  async (failedCall) => {
    const failure = new Error('PUT response lost');
    let count = 0;
    fake.storage.upload.mockImplementation(async (object) => {
      fake.objects.set(object.key, object);
      if (++count === failedCall) throw failure;
    });
    await expect(uploadPlantPhoto(plantId, request())).rejects.toBe(failure);
    expect(fake.objects.size).toBe(0);
    expect(fake.storage.remove).toHaveBeenCalledTimes(failedCall);
    expect(database.$transaction).not.toHaveBeenCalled();
  },
);
test('cleanup preserves the original error and logs exact keys but no raw provider error', async () => {
  const failure = new Error('SENSITIVE signed URL and credential');
  fake.storage.upload.mockRejectedValueOnce(failure);
  fake.storage.remove.mockRejectedValue(new Error('cleanup secret'));
  await expect(uploadPlantPhoto(plantId, request())).rejects.toBe(failure);
  const logged = JSON.stringify(vi.mocked(console.error).mock.calls);
  expect(logged).toContain(fake.storage.upload.mock.calls[0][0].key);
  expect(logged).toContain('cleanup-failed');
  expect(logged).toContain(fake.storage.bucket);
  expect(logged).not.toContain('SENSITIVE');
  expect(logged).not.toContain('cleanup secret');
});
test('never removes another upload object after a conditional collision', async () => {
  fake.storage.upload.mockImplementationOnce(async (object) => {
    fake.objects.set(object.key, { ...object, uploadId: randomUUID() });
    throw new Error('Object exists');
  });
  await expect(uploadPlantPhoto(plantId, request())).rejects.toThrow('Object exists');
  expect(fake.objects.size).toBe(1);
  expect(JSON.stringify(vi.mocked(console.error).mock.calls)).toContain('not-owned');
});
test('rechecks a stale token under lock and cleans up this upload', async () => {
  tx.$queryRaw.mockResolvedValue([{ id: plantId, updatedAt: new Date(updatedAt.getTime() + 1) }]);
  await expect(uploadPlantPhoto(plantId, request())).rejects.toMatchObject({
    code: 'STALE_UPDATE',
  });
  expect(fake.objects.size).toBe(0);
  expect(tx.plantPhoto.create).not.toHaveBeenCalled();
});
test('cleans all three objects after a definite related database failure', async () => {
  const failure = new Error('Database update failed');
  tx.plant.update.mockRejectedValue(failure);
  await expect(uploadPlantPhoto(plantId, request())).rejects.toBe(failure);
  expect(fake.objects.size).toBe(0);
  expect(fake.storage.remove).toHaveBeenCalledTimes(3);
});
test('resolves a lost commit acknowledgement under a fresh lock and keeps committed files', async () => {
  let saved: unknown;
  database.$transaction.mockImplementationOnce(async (operation) => {
    const result = await operation(tx);
    saved = result.photo;
    throw new Error('Lost COMMIT response');
  });
  tx.plantPhoto.findUnique.mockImplementation(async () => saved);
  const result = await uploadPlantPhoto(plantId, request());
  expect(result.photo).toEqual(saved);
  expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
  expect(fake.storage.remove).not.toHaveBeenCalled();
  expect(fake.objects.size).toBe(3);
});
test('cleans only after a settled commit check confirms absence', async () => {
  const failure = new Error('COMMIT failed');
  database.$transaction.mockImplementationOnce(async (operation) => {
    await operation(tx);
    throw failure;
  });
  tx.plantPhoto.findUnique.mockResolvedValue(null);
  await expect(uploadPlantPhoto(plantId, request())).rejects.toBe(failure);
  expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
  expect(fake.objects.size).toBe(0);
});
test('retains all objects if commit outcome cannot safely be determined', async () => {
  const failure = new Error('COMMIT disconnected');
  database.$transaction
    .mockImplementationOnce(async (operation) => {
      await operation(tx);
      throw failure;
    })
    .mockRejectedValueOnce(new Error('Recovery unavailable'));
  await expect(uploadPlantPhoto(plantId, request())).rejects.toMatchObject({ cause: failure });
  expect(fake.objects.size).toBe(3);
  expect(fake.storage.remove).not.toHaveBeenCalled();
  expect(JSON.stringify(vi.mocked(console.error).mock.calls)).toContain('objects retained');
});
test('rejects ordering overflow and compensates without creating metadata', async () => {
  tx.plantPhoto.findFirst.mockResolvedValue({ sortOrder: 2147483647 });
  await expect(uploadPlantPhoto(plantId, request())).rejects.toMatchObject({ code: 'CONFLICT' });
  expect(tx.plantPhoto.create).not.toHaveBeenCalled();
  expect(fake.objects.size).toBe(0);
});
test('primary selection rejects extra values and another Plant photo', async () => {
  const input = { photoId: randomUUID(), expectedUpdatedAt: updatedAt.toISOString() };
  await expect(
    setPrimaryPlantPhoto(plantId, { ...input, storageKey: 'bad' } as typeof input),
  ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  await expect(setPrimaryPlantPhoto(plantId, input)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  expect(tx.plantPhoto.updateMany).not.toHaveBeenCalled();
});
test('delivery signs only the companion of a known, correctly owned photo', async () => {
  const photoId = randomUUID();
  const key = createPhotoKeys(plantId, 'jpg').original;
  tx.plantPhoto.findFirst.mockResolvedValue({ storageKey: key });
  expect(await getPlantPhotoReadUrl(plantId, photoId, 'display')).toMatchObject({
    expiresInSeconds: 300,
  });
  expect(fake.storage.signVariant).toHaveBeenCalledWith(key, 'display');
  await expect(
    getPlantPhotoReadUrl(plantId, photoId, 'original' as 'display'),
  ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  tx.plantPhoto.findFirst.mockResolvedValue({
    storageKey: createPhotoKeys(randomUUID(), 'jpg').original,
  });
  await expect(getPlantPhotoReadUrl(plantId, photoId, 'display')).rejects.toThrow('ownership');
  tx.plantPhoto.findFirst.mockResolvedValue(null);
  await expect(getPlantPhotoReadUrl(plantId, photoId, 'display')).rejects.toMatchObject({
    code: 'NOT_FOUND',
  });
  expect(fake.storage.signVariant).toHaveBeenCalledTimes(1);
});
