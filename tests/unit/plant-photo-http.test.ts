// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { PlantError } from '../../src/modules/plants/plant-errors';
import {
  uploadPlantPhoto,
  setPrimaryPlantPhoto,
  updatePlantPhotoCrop,
  previewNewPlantPhoto,
  getPlantPhotoCropPreview,
} from '../../src/modules/plants/plant-photo-service';
import { getPlantPhotoReadUrl } from '../../src/modules/plants/plant-photo-queries';
import {
  uploadPlantPhotoRequest,
  setPrimaryPlantPhotoRequest,
  deliverPlantPhoto,
  MAX_PHOTO_REQUEST_BYTES,
} from '../../src/modules/plants/plant-photo-http';
import { POST as uploadRoute } from '../../src/app/plants/[plantId]/photos/route';
import { POST as primaryRoute } from '../../src/app/plants/[plantId]/photos/[photoId]/primary/route';
import { GET as deliveryRoute } from '../../src/app/plants/[plantId]/photos/[photoId]/[variant]/route';
import {
  POST as cropRoute,
  GET as cropPreviewRoute,
} from '../../src/app/plants/[plantId]/photos/[photoId]/crop/route';
import { POST as newPreviewRoute } from '../../src/app/plants/[plantId]/photos/preview/route';

vi.mock('server-only', () => ({}));
vi.mock('../../src/modules/plants/plant-photo-service', () => ({
  uploadPlantPhoto: vi.fn(),
  setPrimaryPlantPhoto: vi.fn(),
  updatePlantPhotoCrop: vi.fn(),
  previewNewPlantPhoto: vi.fn(),
  getPlantPhotoCropPreview: vi.fn(),
}));
vi.mock('../../src/modules/plants/plant-photo-queries', () => ({ getPlantPhotoReadUrl: vi.fn() }));
const plantId = randomUUID();
const photoId = randomUUID();
const origin = 'http://127.0.0.1:3000';
const token = '2026-08-31T12:00:00.000Z';
const nextToken = '2026-08-31T12:00:00.001Z';
function form() {
  const data = new FormData();
  data.set('image', new File([new Uint8Array([1, 2, 3])], 'leaf.jpg', { type: 'image/jpeg' }));
  data.set('expectedUpdatedAt', token);
  data.set('caption', 'Leaf one');
  data.set('takenAt', '2026-08-30T10:00:00.000Z');
  return data;
}
function uploadRequest(data = form(), headers: Record<string, string> = { origin }) {
  return new Request(`${origin}/plants/${plantId}/photos`, { method: 'POST', headers, body: data });
}
function primaryRequest(
  body: unknown = { expectedUpdatedAt: token },
  headers: Record<string, string> = {},
) {
  return new Request(`${origin}/plants/${plantId}/photos/${photoId}/primary`, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.mocked(uploadPlantPhoto).mockResolvedValue({
    photo: { id: photoId, storageKey: 'private-key' },
    plantUpdatedAt: new Date(nextToken),
  } as Awaited<ReturnType<typeof uploadPlantPhoto>>);
  vi.mocked(setPrimaryPlantPhoto).mockResolvedValue({
    photo: { id: photoId, storageKey: 'private-key' },
    plantUpdatedAt: new Date(nextToken),
    changed: true,
  } as Awaited<ReturnType<typeof setPrimaryPlantPhoto>>);
  vi.mocked(getPlantPhotoReadUrl).mockResolvedValue({
    url: 'https://signed.invalid/display.webp?secret=never-log',
    expiresInSeconds: 300,
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

test('upload passes an explicit crop but rejects malformed or expanded crop data', async () => {
  const crop = { x: 0.1, y: 0.2, size: 0.5 };
  const data = form();
  data.set('crop', JSON.stringify(crop));
  expect(
    (await uploadRoute(uploadRequest(data), { params: Promise.resolve({ plantId }) })).status,
  ).toBe(201);
  expect(vi.mocked(uploadPlantPhoto).mock.calls[0][1].crop).toEqual(crop);
  for (const invalid of [
    '{',
    JSON.stringify({ ...crop, storageKey: 'bad' }),
    JSON.stringify({ ...crop, size: -1 }),
  ]) {
    const bad = form();
    bad.set('crop', invalid);
    expect(
      (await uploadRoute(uploadRequest(bad), { params: Promise.resolve({ plantId }) })).status,
    ).toBe(400);
  }
  expect(uploadPlantPhoto).toHaveBeenCalledOnce();
});
test('new upload preview has bounded multipart and same origin rules, and never calls upload', async () => {
  const data = new FormData();
  data.set('image', new File(['test'], 'test.jpg'));
  data.set('expectedUpdatedAt', token);
  vi.mocked(previewNewPlantPhoto).mockResolvedValue({
    image: Buffer.from('processed-webp'),
    width: 200,
    height: 400,
  });
  const response = await newPreviewRoute(uploadRequest(data), {
    params: Promise.resolve({ plantId }),
  });
  expect(await response.json()).toEqual({
    success: true,
    width: 200,
    height: 400,
    preview: `data:image/webp;base64,${Buffer.from('processed-webp').toString('base64')}`,
  });
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(uploadPlantPhoto).not.toHaveBeenCalled();
  expect(
    (
      await newPreviewRoute(uploadRequest(data, { origin: 'https://elsewhere.invalid' }), {
        params: Promise.resolve({ plantId }),
      })
    ).status,
  ).toBe(403);
  const huge = new Request(origin, {
    method: 'POST',
    headers: {
      origin,
      'content-type': 'multipart/form-data; boundary=x',
      'content-length': String(MAX_PHOTO_REQUEST_BYTES + 1),
    },
    body: 'small',
  });
  expect((await newPreviewRoute(huge, { params: Promise.resolve({ plantId }) })).status).toBe(413);
});
test('crop boundary saves through the service and returns a refresh marker, never storage keys', async () => {
  const revision = randomUUID();
  const input = { crop: { x: 0, y: 0.25, size: 0.5 }, expectedUpdatedAt: token };
  vi.mocked(updatePlantPhotoCrop).mockResolvedValue({
    photo: { derivativeRevision: revision },
    plantUpdatedAt: new Date(nextToken),
    changed: true,
  } as Awaited<ReturnType<typeof updatePlantPhotoCrop>>);
  const response = await cropRoute(primaryRequest(input), {
    params: Promise.resolve({ plantId, photoId }),
  });
  expect(response.status).toBe(200);
  expect(updatePlantPhotoCrop).toHaveBeenCalledWith(plantId, photoId, input);
  expect(await response.json()).toMatchObject({
    photoId,
    derivativeRevision: revision,
    plantUpdatedAt: nextToken,
  });
  expect(
    (
      await cropRoute(primaryRequest(input, { origin: 'https://bad.invalid' }), {
        params: Promise.resolve({ plantId, photoId }),
      })
    ).status,
  ).toBe(403);
});
test.each(['stale', 'unexpected'])('crop errors remain safe (%s)', async (kind) => {
  vi.mocked(updatePlantPhotoCrop).mockRejectedValue(
    kind === 'stale'
      ? new PlantError('STALE_UPDATE', 'Plant changed.')
      : new Error('SECRET provider key'),
  );
  const response = await cropRoute(
    primaryRequest({ crop: { x: 0, y: 0, size: 1 }, expectedUpdatedAt: token }),
    { params: Promise.resolve({ plantId, photoId }) },
  );
  expect(response.status).toBe(kind === 'stale' ? 409 : 500);
  expect(await response.text()).not.toContain('SECRET');
});
test('existing editor preview returns dimensions/crop without exposing an original or storage key', async () => {
  vi.mocked(getPlantPhotoCropPreview).mockResolvedValue({ width: 200, height: 400, crop: null });
  const response = await cropPreviewRoute(new Request(origin), {
    params: Promise.resolve({ plantId, photoId }),
  });
  expect(await response.json()).toEqual({ success: true, width: 200, height: 400, crop: null });
  expect(getPlantPhotoCropPreview).toHaveBeenCalledWith(plantId, photoId);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
});

test('upload route passes only approved fields and returns a new token, not storage metadata', async () => {
  const response = await uploadRoute(uploadRequest(), { params: Promise.resolve({ plantId }) });
  expect(response.status).toBe(201);
  expect(await response.json()).toEqual({
    success: true,
    message: 'Photo uploaded.',
    plantUpdatedAt: nextToken,
  });
  expect(uploadPlantPhoto).toHaveBeenCalledWith(plantId, {
    image: new Uint8Array([1, 2, 3]),
    originalFilename: 'leaf.jpg',
    caption: 'Leaf one',
    takenAt: '2026-08-30T10:00:00.000Z',
    expectedUpdatedAt: token,
  });
  expect(response.headers.get('cache-control')).toBe('private, no-store');
});

test.each(['127.0.0.1:3000', 'localhost:3000', '127.0.0.1:3001', 'localhost:3001'])(
  'accepts genuine same origin photo mutations at %s after Next URL normalisation',
  async (host) => {
    const localOrigin = `http://${host}`;
    const headers = { host, origin: localOrigin, 'sec-fetch-site': 'same-origin' };
    const request = new NextRequest(`${localOrigin}/plants/${plantId}/photos`, {
      method: 'POST',
      headers,
      body: form(),
    });
    expect(new URL(request.url).hostname).toBe('localhost');
    const response = await uploadRoute(request, { params: Promise.resolve({ plantId }) });
    expect(response.status).toBe(201);
    const primary = new NextRequest(`${localOrigin}/plants/${plantId}/photos/${photoId}/primary`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ expectedUpdatedAt: token }),
    });
    expect(
      (await primaryRoute(primary, { params: Promise.resolve({ plantId, photoId }) })).status,
    ).toBe(200);
    expect(uploadPlantPhoto).toHaveBeenCalledOnce();
    expect(setPrimaryPlantPhoto).toHaveBeenCalledOnce();
  },
);

test.each([
  { host: '127.0.0.1:3000', origin: 'http://localhost:3000' },
  { host: 'localhost:3000', origin: 'http://127.0.0.1:3000' },
  { host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3001' },
  { host: '127.0.0.1:3001', origin: 'http://127.0.0.1:3001' },
  { host: '127.0.0.1:3000', origin: 'https://127.0.0.1:3000' },
  { host: 'other.invalid:3000', origin: 'http://other.invalid:3000' },
  { host: 'other.invalid:3000', origin: 'http://localhost:3000' },
  { host: '127.0.0.2:3000', origin: 'http://127.0.0.2:3000' },
  { host: 'localhost.evil.invalid:3000', origin: 'http://localhost.evil.invalid:3000' },
  { host: '127.0.0.1:3000', origin: 'null' },
  { host: '127.0.0.1:3000', origin, 'sec-fetch-site': 'cross-site' },
  {
    host: '127.0.0.1:3000',
    origin: 'http://other.invalid:3000',
    'x-forwarded-host': 'other.invalid:3000',
  },
] as Record<string, string>[])(
  'rejects mismatched or untrusted origins after Next normalisation: %j',
  async (headers) => {
    const request = new NextRequest(`${origin}/plants/${plantId}/photos`, {
      method: 'POST',
      headers,
      body: form(),
    });
    expect((await uploadPlantPhotoRequest(request, plantId)).status).toBe(403);
    const primary = new NextRequest(`${origin}/plants/${plantId}/photos/${photoId}/primary`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ expectedUpdatedAt: token }),
    });
    expect((await setPrimaryPlantPhotoRequest(primary, plantId, photoId)).status).toBe(403);
    expect(uploadPlantPhoto).not.toHaveBeenCalled();
    expect(setPrimaryPlantPhoto).not.toHaveBeenCalled();
  },
);

test('forwarded headers cannot override the real loopback Host and Origin', async () => {
  const request = new NextRequest(`${origin}/plants/${plantId}/photos`, {
    method: 'POST',
    headers: {
      host: '127.0.0.1:3000',
      origin,
      'x-forwarded-host': 'other.invalid',
      'x-forwarded-proto': 'https',
    },
    body: form(),
  });
  expect((await uploadPlantPhotoRequest(request, plantId)).status).toBe(201);
});
test('blank optional fields remain blank/null for service normalisation, MIME is not trusted', async () => {
  const data = form();
  data.set(
    'image',
    new File([new Uint8Array([1, 2, 3])], 'pretend.svg', { type: 'image/svg+xml' }),
  );
  data.set('caption', '');
  data.set('takenAt', '');
  await uploadPlantPhotoRequest(uploadRequest(data), plantId);
  expect(uploadPlantPhoto).toHaveBeenCalledWith(
    plantId,
    expect.objectContaining({ originalFilename: 'pretend.svg', caption: '', takenAt: null }),
  );
});
test.each([
  'id',
  'photoId',
  'storageKey',
  'isPrimary',
  'sortOrder',
  'updatedAt',
  'photos',
  'delete',
  'url',
])('rejects caller supplied %s', async (key) => {
  const data = form();
  data.set(key, 'injected');
  expect((await uploadPlantPhotoRequest(uploadRequest(data), plantId)).status).toBe(400);
  expect(uploadPlantPhoto).not.toHaveBeenCalled();
});
test.each(['image', 'caption', 'takenAt', 'expectedUpdatedAt'])(
  'rejects repeated %s instead of choosing one',
  async (key) => {
    const data = form();
    data.append(key, 'duplicate');
    expect((await uploadPlantPhotoRequest(uploadRequest(data), plantId)).status).toBe(400);
    expect(uploadPlantPhoto).not.toHaveBeenCalled();
  },
);
test.each([
  {},
  { origin: 'https://other.invalid' },
  { origin: 'null' },
  { origin, 'sec-fetch-site': 'cross-site' },
] as Record<string, string>[])('rejects absent/foreign Origin before writes', async (headers) => {
  expect((await uploadPlantPhotoRequest(uploadRequest(form(), headers), plantId)).status).toBe(403);
  expect(uploadPlantPhoto).not.toHaveBeenCalled();
});
test('rejects wrong content type and malformed multipart', async () => {
  expect(
    (
      await uploadPlantPhotoRequest(
        new Request(origin, { method: 'POST', headers: { origin }, body: 'not multipart' }),
        plantId,
      )
    ).status,
  ).toBe(415);
  expect(
    (
      await uploadPlantPhotoRequest(
        new Request(origin, {
          method: 'POST',
          headers: { origin, 'content-type': 'multipart/form-data; boundary=x' },
          body: 'broken',
        }),
        plantId,
      )
    ).status,
  ).toBe(400);
  expect(uploadPlantPhoto).not.toHaveBeenCalled();
});
test('missing file and a text value in place of a file return an image issue', async () => {
  for (const value of [null, 'not a file', new File([], '')]) {
    const data = form();
    data.delete('image');
    if (value !== null) data.set('image', value);
    const response = await uploadPlantPhotoRequest(uploadRequest(data), plantId);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ issues: [{ field: 'image' }] });
  }
});
test('rejects a file over 10 MiB even within the multipart allowance', async () => {
  const data = form();
  data.set('image', new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'big.jpg'));
  expect((await uploadPlantPhotoRequest(uploadRequest(data), plantId)).status).toBe(413);
  expect(uploadPlantPhoto).not.toHaveBeenCalled();
});

test('accepts the exact 10 MiB file limit plus its bounded form envelope', async () => {
  const data = form();
  data.set('image', new File([new Uint8Array(10 * 1024 * 1024)], 'large.jpg'));
  const response = await uploadPlantPhotoRequest(uploadRequest(data), plantId);
  expect(response.status).toBe(201);
  expect(vi.mocked(uploadPlantPhoto).mock.calls[0][1].image.byteLength).toBe(10 * 1024 * 1024);
});
test.each([undefined, '1'])(
  'bounds streamed bytes before multipart parsing with content-length %s',
  async (length) => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_PHOTO_REQUEST_BYTES));
        controller.enqueue(new Uint8Array(1));
      },
      cancel,
    });
    const request = new Request(origin, {
      method: 'POST',
      headers: {
        origin,
        'content-type': 'multipart/form-data; boundary=x',
        ...(length ? { 'content-length': length } : {}),
      },
      body: stream,
      duplex: 'half',
    } as RequestInit);
    expect((await uploadPlantPhotoRequest(request, plantId)).status).toBe(413);
    expect(cancel).toHaveBeenCalled();
    expect(uploadPlantPhoto).not.toHaveBeenCalled();
  },
);
test('rejects oversized declared length without parsing', async () => {
  const request = uploadRequest(form(), {
    origin,
    'content-length': String(MAX_PHOTO_REQUEST_BYTES + 1),
  });
  expect((await uploadPlantPhotoRequest(request, plantId)).status).toBe(413);
  expect(request.bodyUsed).toBe(false);
});
test('times out and cancels a stalled upload', async () => {
  vi.useFakeTimers();
  const cancel = vi.fn();
  const request = new Request(origin, {
    method: 'POST',
    headers: { origin, 'content-type': 'multipart/form-data; boundary=x' },
    body: new ReadableStream({ cancel }),
    duplex: 'half',
  } as RequestInit);
  const result = uploadPlantPhotoRequest(request, plantId);
  await vi.advanceTimersByTimeAsync(30_001);
  expect((await result).status).toBe(408);
  expect(cancel).toHaveBeenCalled();
  expect(uploadPlantPhoto).not.toHaveBeenCalled();
});
test.each([
  ['VALIDATION_FAILED', 400],
  ['NOT_FOUND', 404],
  ['STALE_UPDATE', 409],
] as const)('maps %s safely with field feedback', async (code, status) => {
  vi.mocked(uploadPlantPhoto).mockRejectedValue(
    new PlantError(code, 'Safe message', {
      cause: new Error('private diagnostics'),
      issues: [{ field: 'caption', message: 'Check caption' }],
    }),
  );
  const response = await uploadPlantPhotoRequest(uploadRequest(), plantId);
  expect(response.status).toBe(status);
  expect(await response.json()).toEqual({
    success: false,
    message: 'Safe message',
    issues: [{ field: 'caption', message: 'Check caption' }],
    ...(code === 'STALE_UPDATE' ? { stale: true } : {}),
  });
});
test.each([new Error('secret signed URL'), new PlantError('CONFLICT', 'raw constraint')])(
  'does not disclose unexpected diagnostics or log raw errors',
  async (error) => {
    vi.mocked(uploadPlantPhoto).mockRejectedValue(error);
    const response = await uploadPlantPhotoRequest(uploadRequest(), plantId);
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain(error.message);
    expect(console.error).toHaveBeenCalledWith(
      'Plant photo request failed; check service recovery diagnostics.',
    );
  },
);
test('primary route sends only photo identity and the current token to the service', async () => {
  const response = await primaryRoute(primaryRequest(), {
    params: Promise.resolve({ plantId, photoId }),
  });
  expect(setPrimaryPlantPhoto).toHaveBeenCalledWith(plantId, { photoId, expectedUpdatedAt: token });
  expect(await response.json()).toEqual({
    success: true,
    message: 'Primary photo saved.',
    plantUpdatedAt: nextToken,
  });
});
test('primary boundary rejects fields, cross origin, large bodies and wrong content type', async () => {
  expect(
    (
      await setPrimaryPlantPhotoRequest(
        primaryRequest({ expectedUpdatedAt: token, isPrimary: true }),
        plantId,
        photoId,
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await setPrimaryPlantPhotoRequest(
        primaryRequest(undefined, { origin: 'https://elsewhere.invalid' }),
        plantId,
        photoId,
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await setPrimaryPlantPhotoRequest(
        primaryRequest({ expectedUpdatedAt: 'x'.repeat(2000) }),
        plantId,
        photoId,
      )
    ).status,
  ).toBe(413);
  expect(
    (
      await setPrimaryPlantPhotoRequest(
        primaryRequest(undefined, { 'content-type': 'text/plain' }),
        plantId,
        photoId,
      )
    ).status,
  ).toBe(415);
  expect(setPrimaryPlantPhoto).not.toHaveBeenCalled();
});
test.each(['display', 'thumbnail'])(
  'delivery route redirects %s privately without caching or logging the URL',
  async (variant) => {
    const response = await deliveryRoute(new Request(origin), {
      params: Promise.resolve({ plantId, photoId, variant }),
    });
    expect(getPlantPhotoReadUrl).toHaveBeenCalledWith(plantId, photoId, variant);
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain('https://signed.invalid/');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(await response.text()).toBe('');
    expect(console.error).not.toHaveBeenCalled();
  },
);
test.each([
  ['VALIDATION_FAILED', 400],
  ['NOT_FOUND', 404],
  ['unexpected', 503],
] as const)(
  'delivery %s returns safe unavailable response for image fallback',
  async (code, status) => {
    vi.mocked(getPlantPhotoReadUrl).mockRejectedValue(
      code === 'unexpected'
        ? new Error('private diagnostics')
        : new PlantError(code, 'private diagnostics'),
    );
    const response = await deliverPlantPhoto(plantId, photoId, 'original');
    expect(response.status).toBe(status);
    expect(response.headers.get('location')).toBeNull();
    expect(await response.text()).toBe('Photo unavailable.');
  },
);
