// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
  createPhotoKeys,
  photoAssetPrefix,
  photoVariantKey,
} from '../../src/modules/plants/plant-photo-keys';
const sdk = vi.hoisted(() => ({ send: vi.fn(), configure: vi.fn(), sign: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@aws-sdk/client-s3', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@aws-sdk/client-s3')>()),
  S3Client: class {
    constructor(config: unknown) {
      sdk.configure(config);
    }
    send = sdk.send;
  },
}));
vi.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: sdk.sign }));

const environment = {
  R2_ACCOUNT_ID: 'a'.repeat(32),
  R2_ACCESS_KEY_ID: 'test-access',
  R2_SECRET_ACCESS_KEY: 'test-secret',
  R2_BUCKET_NAME: 'test-photo-bucket',
};
beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
});
afterEach(() => vi.unstubAllEnvs());

async function mockedStorage() {
  // The SDK is unconditionally mocked above: even these simulated runtime settings
  // cannot open a socket. Production's normal test guard is exercised separately.
  vi.stubEnv('NODE_ENV', 'development');
  vi.stubEnv('VITEST', '');
  for (const [key, value] of Object.entries(environment)) vi.stubEnv(key, value);
  return (await import('../../src/modules/plants/plant-photo-storage')).getPlantPhotoStorage();
}

test('asset deletion paginates only the exact folder and removes original, display, legacy and all revisions', async () => {
  const storage = await mockedStorage();
  const keys = createPhotoKeys(randomUUID(), 'jpg');
  const revisions = [
    photoVariantKey(keys.original, 'thumbnail', randomUUID()),
    photoVariantKey(keys.original, 'thumbnail', randomUUID()),
  ];
  const prefix = photoAssetPrefix(keys.original);
  const all = [...Object.values(keys), ...revisions];
  sdk.send.mockResolvedValueOnce({
    Contents: Object.values(keys).map((Key) => ({ Key })),
    IsTruncated: true,
    NextContinuationToken: 'next',
  });
  sdk.send.mockResolvedValueOnce({
    Contents: revisions.map((Key) => ({ Key })),
    IsTruncated: false,
  });
  for (const key of all) sdk.send.mockResolvedValueOnce({ key });
  sdk.send.mockResolvedValueOnce({ Contents: [] });
  await storage.removePhotoAsset(keys.original);
  const calls = sdk.send.mock.calls.map(([command]) => command);
  const lists = calls.filter((command) => command.constructor.name === 'ListObjectsV2Command');
  expect(lists).toHaveLength(3);
  for (const command of lists)
    expect(command.input).toMatchObject({ Bucket: environment.R2_BUCKET_NAME, Prefix: prefix });
  expect(lists[1].input.ContinuationToken).toBe('next');
  expect(
    calls
      .filter((command) => command.constructor.name === 'DeleteObjectCommand')
      .map((command) => command.input.Key),
  ).toEqual(all);
  expect(calls.some((command) => command.constructor.name === 'HeadObjectCommand')).toBe(false);
});

test('Plant storage rejects Equipment paths while the closed Equipment scope accepts only its own paths', async () => {
  const plantStorage = await mockedStorage();
  const shared = await import('../../src/lib/photos/photo-storage');
  const keyHelpers = await import('../../src/lib/photos/photo-keys');
  const equipmentStorage = shared.getPhotoStorage('equipment');
  const plantKey = createPhotoKeys(randomUUID(), 'jpg').original;
  const equipmentKey = keyHelpers.createPhotoKeys('equipment', randomUUID(), 'jpg').original;
  const upload = (key: string) => ({
    key,
    body: Buffer.from('fixture'),
    contentType: 'image/jpeg',
    uploadId: randomUUID(),
  });
  await expect(plantStorage.upload(upload(equipmentKey))).rejects.toThrow('namespace');
  await expect(equipmentStorage.upload(upload(plantKey))).rejects.toThrow('namespace');
  expect(sdk.send).not.toHaveBeenCalled();
  sdk.send.mockResolvedValue({});
  await equipmentStorage.upload(upload(equipmentKey));
  expect(sdk.send).toHaveBeenCalledOnce();
  expect(sdk.send.mock.calls[0][0].input.Key).toBe(equipmentKey);
});

test('unknown storage scopes are rejected before configuration or provider access', async () => {
  const { getPhotoStorage } = await import('../../src/lib/photos/photo-storage');
  expect(() => getPhotoStorage('media' as 'plants')).toThrow();
  expect(sdk.configure).not.toHaveBeenCalled();
  expect(sdk.send).not.toHaveBeenCalled();
});

test.each(['plants/', '../original.png', 'https://example.invalid/original.png'])(
  'asset removal rejects arbitrary prefix/key %s without SDK calls',
  async (key) => {
    const storage = await mockedStorage();
    await expect(storage.removePhotoAsset(key)).rejects.toThrow();
    expect(sdk.send).not.toHaveBeenCalled();
  },
);

test.each(['another-plant', 'another-photo', 'traversal', 'missing-key', 'unrecognised-file'])(
  'unsafe listing %s fails before any deletion',
  async (failure) => {
    const storage = await mockedStorage();
    const owner = randomUUID();
    const keys = createPhotoKeys(owner, 'png');
    const prefix = photoAssetPrefix(keys.original);
    const foreign =
      failure === 'another-plant'
        ? createPhotoKeys(randomUUID(), 'png').original
        : failure === 'another-photo'
          ? createPhotoKeys(owner, 'png').original
          : failure === 'traversal'
            ? `${prefix}../original.png`
            : failure === 'missing-key'
              ? undefined
              : `${prefix}unrecognised.txt`;
    sdk.send.mockResolvedValueOnce({ Contents: [{ Key: keys.original }, { Key: foreign }] });
    await expect(storage.removePhotoAsset(keys.original)).rejects.toThrow();
    expect(sdk.send).toHaveBeenCalledOnce();
  },
);

test('a failed deletion does not prevent other exact asset deletes and reports remaining objects', async () => {
  const storage = await mockedStorage();
  const keys = createPhotoKeys(randomUUID(), 'png');
  sdk.send.mockResolvedValueOnce({ Contents: [{ Key: keys.original }, { Key: keys.display }] });
  sdk.send.mockRejectedValueOnce(new Error('provider secret'));
  sdk.send.mockResolvedValueOnce({});
  sdk.send.mockResolvedValueOnce({ Contents: [{ Key: keys.original }] });
  await expect(storage.removePhotoAsset(keys.original)).rejects.toThrow('Some objects remain');
  expect(sdk.send.mock.calls[2][0].input.Key).toBe(keys.display);
});

test('empty assets and lost DELETE acknowledgement resolved by absence succeed', async () => {
  const storage = await mockedStorage();
  const key = createPhotoKeys(randomUUID(), 'png').original;
  sdk.send.mockResolvedValueOnce({ Contents: [] }).mockResolvedValueOnce({ Contents: [] });
  await storage.removePhotoAsset(key);
  expect(sdk.send).toHaveBeenCalledTimes(2);
  sdk.send
    .mockResolvedValueOnce({ Contents: [{ Key: key }] })
    .mockRejectedValueOnce(new Error('lost acknowledgement'))
    .mockResolvedValueOnce({ Contents: [] });
  await storage.removePhotoAsset(key);
});

test.each(['missing', 'repeated', 'failure'])(
  'incomplete listing %s never starts deletion',
  async (failure) => {
    const storage = await mockedStorage();
    const key = createPhotoKeys(randomUUID(), 'png').original;
    if (failure === 'failure') sdk.send.mockRejectedValue(new Error('offline'));
    else
      sdk.send.mockResolvedValue({
        Contents: [{ Key: key }],
        IsTruncated: true,
        NextContinuationToken: failure === 'missing' ? undefined : 'repeated',
      });
    await expect(storage.removePhotoAsset(key)).rejects.toThrow();
    expect(
      sdk.send.mock.calls.every(([command]) => command.constructor.name === 'ListObjectsV2Command'),
    ).toBe(true);
  },
);
test('fails closed in tests even when all R2 settings exist', async () => {
  for (const [key, value] of Object.entries(environment)) vi.stubEnv(key, value);
  const { getPlantPhotoStorage } = await import('../../src/modules/plants/plant-photo-storage');
  expect(() => getPlantPhotoStorage()).toThrow('disabled in automated tests');
  expect(sdk.configure).not.toHaveBeenCalled();
});
test('derives only the R2 endpoint and names missing configuration without exposing values', async () => {
  const { readR2Configuration } = await import('../../src/modules/plants/plant-photo-storage');
  expect(readR2Configuration(environment)).toMatchObject({
    endpoint: `https://${'a'.repeat(32)}.r2.cloudflarestorage.com`,
    bucket: environment.R2_BUCKET_NAME,
  });
  expect(() => readR2Configuration({ ...environment, R2_ACCOUNT_ID: 'secret-invalid' })).toThrow(
    'R2_ACCOUNT_ID',
  );
  expect(() =>
    readR2Configuration({ ...environment, R2_ACCOUNT_ID: 'secret-invalid' }),
  ).not.toThrow('secret-invalid');
  expect(() => readR2Configuration({})).toThrow('R2_SECRET_ACCESS_KEY');
});
test('conditionally uploads with ownership metadata, explicit credentials and bounded requests', async () => {
  const storage = await mockedStorage();
  const key = createPhotoKeys(randomUUID(), 'png').original;
  const uploadId = randomUUID();
  await storage.upload({ key, uploadId, body: Buffer.from('fixture'), contentType: 'image/png' });
  expect(sdk.configure).toHaveBeenCalledWith(
    expect.objectContaining({
      region: 'auto',
      credentials: { accessKeyId: 'test-access', secretAccessKey: 'test-secret' },
      maxAttempts: 1,
    }),
  );
  expect(sdk.send.mock.calls[0][0].input).toMatchObject({
    Bucket: environment.R2_BUCKET_NAME,
    Key: key,
    IfNoneMatch: '*',
    Metadata: { 'upload-id': uploadId },
    ContentType: 'image/png',
  });
  expect(sdk.send.mock.calls[0][1].abortSignal).toBeInstanceOf(AbortSignal);
});
test('cleanup refuses another upload owner and removes only its own object', async () => {
  const storage = await mockedStorage();
  const key = createPhotoKeys(randomUUID(), 'png').original;
  const uploadId = randomUUID();
  sdk.send.mockResolvedValueOnce({ Metadata: { 'upload-id': 'someone-else' } });
  expect(await storage.remove(key, uploadId)).toBe('not-owned');
  expect(sdk.send).toHaveBeenCalledTimes(1);
  sdk.send
    .mockResolvedValueOnce({ Metadata: { 'upload-id': uploadId }, ETag: 'etag' })
    .mockResolvedValueOnce({});
  expect(await storage.remove(key, uploadId)).toBe('removed');
  expect(sdk.send.mock.calls[2][0].constructor.name).toBe('DeleteObjectCommand');
  expect(sdk.send.mock.calls[2][0].input.Key).toBe(key);
});
test('a missing object is harmless but a storage outage is not treated as absence', async () => {
  const storage = await mockedStorage();
  const key = createPhotoKeys(randomUUID(), 'png').original;
  sdk.send.mockRejectedValueOnce(
    Object.assign(new Error('Missing'), { $metadata: { httpStatusCode: 404 } }),
  );
  expect(await storage.remove(key, randomUUID())).toBe('absent');
  const unavailable = new Error('Storage unavailable');
  sdk.send.mockRejectedValueOnce(unavailable);
  await expect(storage.lookup(key)).rejects.toBe(unavailable);
});
test('signs only a display or thumbnail for five minutes and never an original', async () => {
  const storage = await mockedStorage();
  const keys = createPhotoKeys(randomUUID(), 'png');
  sdk.sign.mockResolvedValue('https://example.invalid/signed');
  await storage.signVariant(keys.original, 'thumbnail');
  expect(sdk.sign.mock.calls[0][1].input).toMatchObject({
    Key: keys.thumbnail,
    ResponseContentType: 'image/webp',
    ResponseCacheControl: 'private, no-store',
  });
  expect(sdk.sign.mock.calls[0][2]).toEqual({ expiresIn: 300 });
  expect(() => storage.signVariant(keys.original, 'original' as 'display')).toThrow();
  expect(sdk.send).not.toHaveBeenCalled();
});

test('signs the selected thumbnail revision but leaves the display path alone', async () => {
  const storage = await mockedStorage();
  const revision = randomUUID();
  const keys = createPhotoKeys(randomUUID(), 'jpg', revision);
  await storage.signVariant(keys.original, 'thumbnail', revision);
  expect(sdk.sign.mock.calls[0][1].input.Key).toBe(keys.thumbnail);
  await storage.signVariant(keys.original, 'display', revision);
  expect(sdk.sign.mock.calls[1][1].input.Key).toBe(keys.display);
});
test('server original read accepts only the retained original key and bounds actual received bytes', async () => {
  const storage = await mockedStorage();
  const keys = createPhotoKeys(randomUUID(), 'jpg');
  let cancelled = false;
  const responseBody = (chunks: Uint8Array[]) => ({
    transformToWebStream: () =>
      new ReadableStream({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(chunk);
          controller.close();
        },
        cancel() {
          cancelled = true;
        },
      }),
  });
  sdk.send.mockResolvedValueOnce({
    Body: responseBody([new Uint8Array([1, 2]), new Uint8Array([3])]),
  });
  expect(await storage.readOriginal(keys.original)).toEqual(Buffer.from([1, 2, 3]));
  expect(sdk.send.mock.calls[0][0].constructor.name).toBe('GetObjectCommand');
  await expect(storage.readOriginal(keys.display)).rejects.toThrow();
  const oversize = new Uint8Array(10 * 1024 * 1024 + 1);
  sdk.send.mockResolvedValueOnce({
    ContentLength: 1,
    Body: {
      transformToWebStream: () =>
        new ReadableStream({
          start(controller) {
            controller.enqueue(oversize);
          },
          cancel() {
            cancelled = true;
          },
        }),
    },
  });
  await expect(storage.readOriginal(keys.original)).rejects.toThrow('size limit');
  expect(cancelled).toBe(true);
});
test('original reads reject empty files and stop stalled streams', async () => {
  const storage = await mockedStorage();
  const key = createPhotoKeys(randomUUID(), 'png').original;
  sdk.send.mockResolvedValueOnce({
    Body: {
      transformToWebStream: () =>
        new ReadableStream({
          start(controller) {
            controller.close();
          },
        }),
    },
  });
  await expect(storage.readOriginal(key)).rejects.toThrow('empty');
  vi.useFakeTimers();
  try {
    sdk.send.mockResolvedValueOnce({ Body: { transformToWebStream: () => new ReadableStream() } });
    const pending = expect(storage.readOriginal(key)).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(20001);
    await pending;
  } finally {
    vi.useRealTimers();
  }
});
