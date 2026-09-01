// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { getPrisma } from '../../src/lib/prisma';
import {
  deleteEquipmentPhoto,
  previewNewEquipmentPhoto,
  setPrimaryEquipmentPhoto,
  updateEquipmentPhotoCrop,
  uploadEquipmentPhoto,
} from '../../src/modules/equipment/equipment-photo-service';
import { getEquipmentPhotoStorage } from '../../src/modules/equipment/equipment-photo-storage';
import {
  createEquipmentPhotoKeys,
  equipmentPhotoVariantKey,
} from '../../src/modules/equipment/equipment-photo-keys';
import { fakeEquipmentPhotoStorage } from '../helpers/fake-equipment-photo-storage';
import { photoFixture } from '../fixtures/plant-photo-images';

vi.mock('server-only', () => ({}));
vi.mock('../../src/lib/prisma', () => ({ getPrisma: vi.fn() }));
vi.mock('../../src/modules/equipment/equipment-photo-storage', () => ({
  getEquipmentPhotoStorage: vi.fn(),
}));

const equipmentId = randomUUID();
const updatedAt = new Date('2026-09-01T08:00:00.000Z');
const equipment = {
  id: equipmentId,
  updatedAt,
  archivedAt: null,
  usesPower: false,
  reference: 'EQP-0001',
};
let fake: ReturnType<typeof fakeEquipmentPhotoStorage>;
let image: Buffer;
const tx = {
  $queryRaw: vi.fn(),
  equipment: { findUnique: vi.fn(), update: vi.fn() },
  equipmentPhoto: {
    create: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    updateMany: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  plantPhoto: { findFirst: vi.fn() },
};
const database = { ...tx, $transaction: vi.fn() };

beforeEach(async () => {
  vi.resetAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  fake = fakeEquipmentPhotoStorage();
  image = await photoFixture();
  vi.mocked(getEquipmentPhotoStorage).mockReturnValue(fake.storage);
  vi.mocked(getPrisma).mockReturnValue(database as unknown as ReturnType<typeof getPrisma>);
  tx.equipment.findUnique.mockResolvedValue(equipment);
  tx.$queryRaw.mockResolvedValue([equipment]);
  tx.equipment.update.mockResolvedValue({ updatedAt: new Date(updatedAt.getTime() + 1) });
  tx.equipmentPhoto.findFirst.mockResolvedValue(null);
  tx.equipmentPhoto.create.mockImplementation(async ({ data }) => ({
    ...data,
    id: randomUUID(),
    createdAt: updatedAt,
    updatedAt,
  }));
  tx.plantPhoto.findFirst.mockResolvedValue(null);
  database.$transaction.mockImplementation(async (operation) => operation(tx));
});

afterEach(() => vi.restoreAllMocks());

const request = () => ({ image, expectedUpdatedAt: updatedAt.toISOString() });
const cropRequest = () => ({
  crop: { x: 0, y: 0, size: 0.5 },
  expectedUpdatedAt: updatedAt.toISOString(),
});

function existingPhoto(data: Record<string, unknown> = {}) {
  const keys = createEquipmentPhotoKeys(equipmentId, 'png');
  const previous = {
    id: randomUUID(),
    equipmentId,
    storageKey: keys.original,
    originalFilename: null,
    caption: 'Keep caption',
    takenAt: updatedAt,
    isPrimary: true,
    sortOrder: 5,
    cropX: null as number | null,
    cropY: null as number | null,
    cropSize: null as number | null,
    derivativeRevision: null as string | null,
    createdAt: updatedAt,
    updatedAt,
    ...data,
  };
  for (const key of Object.values(keys))
    fake.objects.set(key, { key, body: image, contentType: 'image/png', uploadId: randomUUID() });
  let record = previous;
  tx.equipmentPhoto.findFirst.mockImplementation(async () => record);
  tx.equipmentPhoto.findUnique.mockImplementation(async () => record);
  tx.equipmentPhoto.update.mockImplementation(async ({ data: patch }) => {
    record = { ...record, ...patch };
    return record;
  });
  return { previous, record: () => record, keys };
}

test('upload stores only Equipment keys, keeps the original and creates full/cropped derivatives', async () => {
  const result = await uploadEquipmentPhoto(equipmentId, {
    ...request(),
    originalFilename: '../../device.svg',
    caption: ' Front ',
    crop: { x: 0, y: 0, size: 0.5 },
  });
  expect(result.photo).toMatchObject({
    equipmentId,
    isPrimary: true,
    sortOrder: 0,
    originalFilename: 'device.svg',
    caption: 'Front',
    cropX: 0,
    cropY: 0,
    cropSize: 0.5,
    derivativeRevision: expect.any(String),
  });
  expect(result.photo.storageKey).toMatch(
    new RegExp(`^equipment/${equipmentId}/[0-9a-f-]+/original\\.png$`),
  );
  expect(fake.objects.get(result.photo.storageKey)?.body).toEqual(image);
  expect(fake.storage.upload).toHaveBeenCalledTimes(3);
  expect(fake.storage.upload.mock.calls[1][0].key).toMatch(/\/display\.webp$/);
  expect(fake.storage.upload.mock.calls[2][0].key).toContain(
    `/thumbnails/${result.photo.derivativeRevision}.webp`,
  );
  expect(Math.max(...fake.storage.upload.mock.invocationCallOrder)).toBeLessThan(
    database.$transaction.mock.invocationCallOrder[0],
  );
});

test('default crop is centred and later upload appends without replacing primary', async () => {
  tx.equipmentPhoto.findFirst.mockResolvedValue({ sortOrder: 8 });
  const result = await uploadEquipmentPhoto(equipmentId, request());
  expect(result.photo).toMatchObject({
    isPrimary: false,
    sortOrder: 9,
    cropX: 0.125,
    cropY: 0,
    cropSize: 1,
  });
});

test('preview uses the shared oriented pipeline without storage or database writes', async () => {
  expect(await previewNewEquipmentPhoto(equipmentId, request())).toMatchObject({
    width: 16,
    height: 12,
  });
  expect(getEquipmentPhotoStorage).not.toHaveBeenCalled();
  expect(database.$transaction).not.toHaveBeenCalled();
});

test('malformed input and bytes fail before storage or metadata writes', async () => {
  await expect(
    uploadEquipmentPhoto(equipmentId, { ...request(), storageKey: 'equipment/' } as ReturnType<
      typeof request
    >),
  ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  await expect(
    uploadEquipmentPhoto(equipmentId, { ...request(), image: Buffer.from('not a photo') }),
  ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  expect(fake.storage.upload).not.toHaveBeenCalled();
  expect(tx.equipmentPhoto.create).not.toHaveBeenCalled();
});

test.each(['missing', 'early-stale', 'locked-stale'])(
  'upload rejects %s Equipment without retained objects',
  async (stage) => {
    if (stage === 'missing') tx.equipment.findUnique.mockResolvedValue(null);
    if (stage === 'early-stale')
      tx.equipment.findUnique.mockResolvedValue({ updatedAt: new Date(updatedAt.getTime() + 1) });
    if (stage === 'locked-stale')
      tx.$queryRaw.mockResolvedValue([{ updatedAt: new Date(updatedAt.getTime() + 1) }]);
    await expect(uploadEquipmentPhoto(equipmentId, request())).rejects.toMatchObject({
      code: stage === 'missing' ? 'NOT_FOUND' : 'STALE_UPDATE',
    });
    expect(fake.objects.size).toBe(0);
  },
);

test.each([1, 2, 3])('partial storage failure %i cleans only attempted objects', async (call) => {
  const failure = new Error('PUT lost');
  let count = 0;
  fake.storage.upload.mockImplementation(async (object) => {
    fake.objects.set(object.key, object);
    if (++count === call) throw failure;
  });
  await expect(uploadEquipmentPhoto(equipmentId, request())).rejects.toBe(failure);
  expect(fake.objects.size).toBe(0);
  expect(fake.storage.remove).toHaveBeenCalledTimes(call);
  expect(database.$transaction).not.toHaveBeenCalled();
});

test('definite database rollback cleans all newly uploaded Equipment objects', async () => {
  const failure = new Error('database rollback');
  tx.equipment.update.mockRejectedValue(failure);
  await expect(uploadEquipmentPhoto(equipmentId, request())).rejects.toBe(failure);
  expect(fake.objects.size).toBe(0);
  expect(fake.storage.remove).toHaveBeenCalledTimes(3);
});

test.each(['committed', 'absent', 'unavailable'])(
  'upload resolves uncertain commit outcome: %s',
  async (outcome) => {
    let saved: unknown;
    const failure = new Error('commit response lost');
    database.$transaction.mockImplementationOnce(async (operation) => {
      const result = await operation(tx);
      saved = result.photo;
      throw failure;
    });
    if (outcome === 'committed') tx.equipmentPhoto.findUnique.mockImplementation(async () => saved);
    if (outcome === 'absent') tx.equipmentPhoto.findUnique.mockResolvedValue(null);
    if (outcome === 'unavailable')
      database.$transaction.mockRejectedValueOnce(new Error('recovery unavailable'));
    const result = uploadEquipmentPhoto(equipmentId, request());
    if (outcome === 'committed') expect((await result).photo).toEqual(saved);
    else if (outcome === 'absent') await expect(result).rejects.toBe(failure);
    else await expect(result).rejects.toMatchObject({ cause: failure });
    expect(fake.objects.size).toBe(outcome === 'absent' ? 0 : 3);
  },
);

test('primary selection switches atomically and already-primary is a no-op', async () => {
  const { previous } = existingPhoto({ isPrimary: false });
  const changed = await setPrimaryEquipmentPhoto(equipmentId, {
    photoId: previous.id,
    expectedUpdatedAt: updatedAt.toISOString(),
  });
  expect(changed.changed).toBe(true);
  expect(tx.equipmentPhoto.updateMany).toHaveBeenCalledWith({
    where: { equipmentId, isPrimary: true },
    data: { isPrimary: false },
  });
  expect(tx.equipment.update).toHaveBeenCalledOnce();

  vi.clearAllMocks();
  tx.$queryRaw.mockResolvedValue([equipment]);
  tx.equipmentPhoto.findFirst.mockResolvedValue({ ...previous, isPrimary: true });
  database.$transaction.mockImplementation(async (operation) => operation(tx));
  const same = await setPrimaryEquipmentPhoto(equipmentId, {
    photoId: previous.id,
    expectedUpdatedAt: updatedAt.toISOString(),
  });
  expect(same.changed).toBe(false);
  expect(tx.equipmentPhoto.updateMany).not.toHaveBeenCalled();
  expect(tx.equipment.update).not.toHaveBeenCalled();
});

test('primary selection rejects stale and cross-owner photos', async () => {
  const { previous } = existingPhoto({ equipmentId: randomUUID(), isPrimary: false });
  await expect(
    setPrimaryEquipmentPhoto(equipmentId, {
      photoId: previous.id,
      expectedUpdatedAt: updatedAt.toISOString(),
    }),
  ).rejects.toThrow();
  tx.$queryRaw.mockResolvedValue([{ updatedAt: new Date(updatedAt.getTime() + 1) }]);
  await expect(
    setPrimaryEquipmentPhoto(equipmentId, {
      photoId: previous.id,
      expectedUpdatedAt: updatedAt.toISOString(),
    }),
  ).rejects.toMatchObject({ code: 'STALE_UPDATE' });
});

test('crop writes only a fresh thumbnail and preserves original/display metadata', async () => {
  const { previous, keys, record } = existingPhoto();
  const before = new Map(fake.objects);
  const result = await updateEquipmentPhotoCrop(equipmentId, previous.id, cropRequest());
  expect(result.changed).toBe(true);
  expect(result.photo).toMatchObject({
    cropX: 0,
    cropY: 0,
    cropSize: 0.5,
    derivativeRevision: expect.any(String),
    isPrimary: true,
    sortOrder: 5,
    caption: 'Keep caption',
    takenAt: updatedAt,
  });
  expect(fake.storage.readOriginal).toHaveBeenCalledWith(keys.original);
  expect(fake.storage.upload).toHaveBeenCalledOnce();
  expect(fake.storage.upload.mock.calls[0][0].key).toBe(
    equipmentPhotoVariantKey(keys.original, 'thumbnail', record().derivativeRevision),
  );
  for (const [key, object] of before) expect(fake.objects.get(key)).toEqual(object);
});

test('identical crop is a locked no-op without storage access', async () => {
  const { previous } = existingPhoto({
    cropX: 0,
    cropY: 0,
    cropSize: 0.5,
    derivativeRevision: randomUUID(),
  });
  expect((await updateEquipmentPhotoCrop(equipmentId, previous.id, cropRequest())).changed).toBe(
    false,
  );
  expect(getEquipmentPhotoStorage).not.toHaveBeenCalled();
  expect(tx.equipment.update).not.toHaveBeenCalled();
});

test.each(['stale', 'upload', 'database'])(
  'failed crop %s cleans only the attempted revision',
  async (stage) => {
    const { previous } = existingPhoto();
    const before = new Map(fake.objects);
    if (stage === 'stale')
      tx.$queryRaw.mockResolvedValue([{ updatedAt: new Date(updatedAt.getTime() + 1) }]);
    if (stage === 'upload') fake.storage.upload.mockRejectedValue(new Error('put failed'));
    if (stage === 'database') tx.equipment.update.mockRejectedValue(new Error('db failed'));
    await expect(
      updateEquipmentPhotoCrop(equipmentId, previous.id, cropRequest()),
    ).rejects.toThrow();
    expect(fake.objects).toEqual(before);
    expect(fake.storage.remove).toHaveBeenCalledTimes(
      stage === 'upload' || stage === 'database' || stage === 'stale' ? 1 : 0,
    );
  },
);

test.each(['committed', 'previous', 'superseded', 'unavailable'])(
  'crop resolves uncertain commit outcome: %s',
  async (outcome) => {
    const { previous } = existingPhoto();
    const failure = new Error('commit response lost');
    database.$transaction.mockImplementationOnce(async (operation) => {
      await operation(tx);
      if (outcome === 'previous') tx.equipmentPhoto.findFirst.mockResolvedValue(previous);
      if (outcome === 'superseded')
        tx.equipmentPhoto.findFirst.mockResolvedValue({
          ...previous,
          derivativeRevision: randomUUID(),
        });
      throw failure;
    });
    if (outcome === 'unavailable')
      database.$transaction.mockRejectedValueOnce(new Error('recovery unavailable'));
    const result = updateEquipmentPhotoCrop(equipmentId, previous.id, cropRequest());
    if (outcome === 'committed') expect((await result).changed).toBe(true);
    else if (outcome === 'previous') await expect(result).rejects.toBe(failure);
    else await expect(result).rejects.toMatchObject({ cause: failure });
    expect(fake.storage.remove).toHaveBeenCalledTimes(outcome === 'previous' ? 1 : 0);
  },
);

test('deletion commits metadata and deterministic primary before exact asset cleanup', async () => {
  const { previous, keys } = existingPhoto();
  const revision = randomUUID();
  const superseded = equipmentPhotoVariantKey(keys.original, 'thumbnail', revision);
  fake.objects.set(superseded, {
    key: superseded,
    body: image,
    contentType: 'image/webp',
    uploadId: randomUUID(),
  });
  const nextId = randomUUID();
  tx.equipmentPhoto.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: nextId });
  let committed = false;
  database.$transaction.mockImplementation(async (operation) => {
    const result = await operation(tx);
    expect(fake.storage.removePhotoAsset).not.toHaveBeenCalled();
    committed = true;
    return result;
  });
  fake.storage.removePhotoAsset.mockImplementation(async (key) => {
    expect(committed).toBe(true);
    expect(key).toBe(keys.original);
    for (const objectKey of [...fake.objects.keys()])
      if (objectKey.startsWith(keys.original.slice(0, keys.original.lastIndexOf('/') + 1)))
        fake.objects.delete(objectKey);
  });
  const result = await deleteEquipmentPhoto(equipmentId, previous.id, {
    confirmed: true,
    expectedUpdatedAt: updatedAt.toISOString(),
  });
  expect(result).toMatchObject({
    deletedPhotoId: previous.id,
    primaryPhotoId: nextId,
    cleanupPending: false,
  });
  expect(tx.equipmentPhoto.findFirst.mock.calls[1][0].orderBy).toEqual([
    { sortOrder: 'asc' },
    { createdAt: 'asc' },
    { id: 'asc' },
  ]);
  expect(tx.equipmentPhoto.update).toHaveBeenCalledWith({
    where: { id: nextId },
    data: { isPrimary: true },
  });
  expect(fake.objects.size).toBe(0);
});

test.each(['shared-equipment', 'shared-plant', 'stale', 'other-owner'])(
  'deletion rejects unsafe %s state before storage access',
  async (stage) => {
    const { previous } = existingPhoto();
    if (stage === 'shared-equipment')
      tx.equipmentPhoto.findFirst.mockResolvedValue({ id: randomUUID() });
    if (stage === 'shared-plant') tx.plantPhoto.findFirst.mockResolvedValue({ id: randomUUID() });
    if (stage === 'stale')
      tx.$queryRaw.mockResolvedValue([{ updatedAt: new Date(updatedAt.getTime() + 1) }]);
    if (stage === 'other-owner')
      tx.equipmentPhoto.findUnique.mockResolvedValue({ ...previous, equipmentId: randomUUID() });
    await expect(
      deleteEquipmentPhoto(equipmentId, previous.id, {
        confirmed: true,
        expectedUpdatedAt: updatedAt.toISOString(),
      }),
    ).rejects.toThrow();
    expect(tx.equipmentPhoto.delete).not.toHaveBeenCalled();
    expect(getEquipmentPhotoStorage).not.toHaveBeenCalled();
  },
);

test('postcommit cleanup failure reports cleanupPending without restoring metadata', async () => {
  const { previous } = existingPhoto();
  tx.equipmentPhoto.findFirst.mockResolvedValue(null);
  fake.storage.removePhotoAsset.mockRejectedValue(new Error('secret provider error'));
  const result = await deleteEquipmentPhoto(equipmentId, previous.id, {
    confirmed: true,
    expectedUpdatedAt: updatedAt.toISOString(),
  });
  expect(result.cleanupPending).toBe(true);
  expect(tx.equipmentPhoto.delete).toHaveBeenCalledOnce();
  expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('secret provider');
});

test.each(['committed', 'present', 'unavailable'])(
  'deletion resolves uncertain commit outcome: %s',
  async (outcome) => {
    const { previous } = existingPhoto();
    const failure = new Error('commit acknowledgement lost');
    tx.equipmentPhoto.findFirst.mockResolvedValue(null);
    database.$transaction.mockImplementationOnce(async (operation) => {
      await operation(tx);
      throw failure;
    });
    if (outcome === 'present')
      tx.equipmentPhoto.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: previous.id });
    if (outcome === 'unavailable')
      database.$transaction.mockRejectedValueOnce(new Error('database unavailable'));
    const result = deleteEquipmentPhoto(equipmentId, previous.id, {
      confirmed: true,
      expectedUpdatedAt: updatedAt.toISOString(),
    });
    if (outcome === 'committed') expect((await result).cleanupPending).toBe(false);
    else await expect(result).rejects.toThrow();
    expect(fake.storage.removePhotoAsset).toHaveBeenCalledTimes(outcome === 'committed' ? 1 : 0);
  },
);
