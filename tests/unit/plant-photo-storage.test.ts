// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createPhotoKeys } from '../../src/modules/plants/plant-photo-keys';
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
