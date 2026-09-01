// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { beforeEach, expect, test, vi } from 'vitest';
import { getPrisma } from '../../src/lib/prisma';
import {
  getEquipmentPhotoGallery,
  getEquipmentPhotoReadUrl,
  getOwnedEquipmentPhoto,
  getPrimaryEquipmentPhoto,
  getPrimaryEquipmentPhotoReferences,
} from '../../src/modules/equipment/equipment-photo-queries';
import { getEquipmentPhotoStorage } from '../../src/modules/equipment/equipment-photo-storage';
import { createEquipmentPhotoKeys } from '../../src/modules/equipment/equipment-photo-keys';
import { createPhotoKeys as createPlantPhotoKeys } from '../../src/modules/plants/plant-photo-keys';
import { fakeEquipmentPhotoStorage } from '../helpers/fake-equipment-photo-storage';

vi.mock('server-only', () => ({}));
vi.mock('../../src/lib/prisma', () => ({ getPrisma: vi.fn() }));
vi.mock('../../src/modules/equipment/equipment-photo-storage', () => ({
  getEquipmentPhotoStorage: vi.fn(),
}));

const equipmentId = randomUUID();
const photoId = randomUUID();
const database = {
  equipmentPhoto: { findMany: vi.fn(), findFirst: vi.fn() },
};
const fake = fakeEquipmentPhotoStorage();

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getPrisma).mockReturnValue(database as unknown as ReturnType<typeof getPrisma>);
  vi.mocked(getEquipmentPhotoStorage).mockReturnValue(fake.storage);
  database.equipmentPhoto.findMany.mockResolvedValue([]);
  database.equipmentPhoto.findFirst.mockResolvedValue(null);
});

test('gallery and primary metadata use deterministic, storage-free reads', async () => {
  await getEquipmentPhotoGallery(equipmentId);
  expect(database.equipmentPhoto.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { equipmentId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    }),
  );
  const gallerySelect = database.equipmentPhoto.findMany.mock.calls[0][0].select;
  expect(gallerySelect).not.toHaveProperty('storageKey');
  await getPrimaryEquipmentPhoto(equipmentId);
  expect(database.equipmentPhoto.findFirst).toHaveBeenCalledWith(
    expect.objectContaining({ where: { equipmentId, isPrimary: true } }),
  );
  expect(getEquipmentPhotoStorage).not.toHaveBeenCalled();
});

test('owned lookup cannot return a photo from another Equipment', async () => {
  await getOwnedEquipmentPhoto(equipmentId, photoId);
  expect(database.equipmentPhoto.findFirst).toHaveBeenCalledWith(
    expect.objectContaining({ where: { id: photoId, equipmentId } }),
  );
  await expect(getOwnedEquipmentPhoto('bad', photoId)).rejects.toMatchObject({
    code: 'VALIDATION_FAILED',
  });
});

test('list references select only primary identity and active thumbnail revision', async () => {
  const another = randomUUID();
  await getPrimaryEquipmentPhotoReferences([equipmentId, equipmentId, another]);
  expect(database.equipmentPhoto.findMany).toHaveBeenCalledWith({
    where: { equipmentId: { in: [equipmentId, another] }, isPrimary: true },
    select: { id: true, equipmentId: true, derivativeRevision: true },
    orderBy: [{ equipmentId: 'asc' }, { id: 'asc' }],
  });
  expect(await getPrimaryEquipmentPhotoReferences([])).toEqual([]);
  expect(database.equipmentPhoto.findMany).toHaveBeenCalledOnce();
  expect(getEquipmentPhotoStorage).not.toHaveBeenCalled();
});

test('delivery signs only a known Equipment display or database-resolved thumbnail revision', async () => {
  const revision = randomUUID();
  const storageKey = createEquipmentPhotoKeys(equipmentId, 'jpg').original;
  database.equipmentPhoto.findFirst.mockResolvedValue({ storageKey, derivativeRevision: revision });
  expect(await getEquipmentPhotoReadUrl(equipmentId, photoId, 'thumbnail')).toMatchObject({
    expiresInSeconds: 300,
  });
  expect(fake.storage.signVariant).toHaveBeenCalledWith(storageKey, 'thumbnail', revision);
  await getEquipmentPhotoReadUrl(equipmentId, photoId, 'display');
  expect(fake.storage.signVariant).toHaveBeenLastCalledWith(storageKey, 'display', revision);
  await expect(
    getEquipmentPhotoReadUrl(equipmentId, photoId, 'original' as 'display'),
  ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
});

test('delivery rejects missing, Plant-namespaced and cross-owned metadata before signing', async () => {
  await expect(getEquipmentPhotoReadUrl(equipmentId, photoId, 'display')).rejects.toMatchObject({
    code: 'NOT_FOUND',
  });
  database.equipmentPhoto.findFirst.mockResolvedValue({
    storageKey: createPlantPhotoKeys(randomUUID(), 'jpg').original,
    derivativeRevision: null,
  });
  await expect(getEquipmentPhotoReadUrl(equipmentId, photoId, 'display')).rejects.toThrow();
  database.equipmentPhoto.findFirst.mockResolvedValue({
    storageKey: createEquipmentPhotoKeys(randomUUID(), 'jpg').original,
    derivativeRevision: null,
  });
  await expect(getEquipmentPhotoReadUrl(equipmentId, photoId, 'thumbnail')).rejects.toThrow(
    'ownership',
  );
  expect(fake.storage.signVariant).not.toHaveBeenCalled();
});
