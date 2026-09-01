// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { EquipmentError } from '../../src/modules/equipment/equipment-errors';
import {
  uploadEquipmentPhoto,
  setPrimaryEquipmentPhoto,
  updateEquipmentPhotoCrop,
  previewNewEquipmentPhoto,
  getEquipmentPhotoCropPreview,
  deleteEquipmentPhoto,
} from '../../src/modules/equipment/equipment-photo-service';
import { getEquipmentPhotoReadUrl } from '../../src/modules/equipment/equipment-photo-queries';
import {
  uploadEquipmentPhotoRequest,
  setPrimaryEquipmentPhotoRequest,
  deliverEquipmentPhoto,
  MAX_PHOTO_REQUEST_BYTES,
} from '../../src/modules/equipment/equipment-photo-http';
import { POST as uploadRoute } from '../../src/app/equipment/[equipmentId]/photos/route';
import { POST as primaryRoute } from '../../src/app/equipment/[equipmentId]/photos/[photoId]/primary/route';
import { GET as deliveryRoute } from '../../src/app/equipment/[equipmentId]/photos/[photoId]/[variant]/route';
import {
  POST as cropRoute,
  GET as cropPreviewRoute,
} from '../../src/app/equipment/[equipmentId]/photos/[photoId]/crop/route';
import { POST as newPreviewRoute } from '../../src/app/equipment/[equipmentId]/photos/preview/route';
import { DELETE as deleteRoute } from '../../src/app/equipment/[equipmentId]/photos/[photoId]/route';

vi.mock('server-only', () => ({}));
vi.mock('../../src/modules/equipment/equipment-photo-service', () => ({
  uploadEquipmentPhoto: vi.fn(),
  setPrimaryEquipmentPhoto: vi.fn(),
  updateEquipmentPhotoCrop: vi.fn(),
  previewNewEquipmentPhoto: vi.fn(),
  getEquipmentPhotoCropPreview: vi.fn(),
  deleteEquipmentPhoto: vi.fn(),
}));
vi.mock('../../src/modules/equipment/equipment-photo-queries', () => ({
  getEquipmentPhotoReadUrl: vi.fn(),
}));
const equipmentId = randomUUID();
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
  return new Request(`${origin}/equipment/${equipmentId}/photos`, {
    method: 'POST',
    headers,
    body: data,
  });
}
function primaryRequest(
  body: unknown = { expectedUpdatedAt: token },
  headers: Record<string, string> = {},
) {
  return new Request(`${origin}/equipment/${equipmentId}/photos/${photoId}/primary`, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.mocked(uploadEquipmentPhoto).mockResolvedValue({
    photo: { id: photoId, storageKey: 'private-key' },
    equipmentUpdatedAt: new Date(nextToken),
  } as Awaited<ReturnType<typeof uploadEquipmentPhoto>>);
  vi.mocked(setPrimaryEquipmentPhoto).mockResolvedValue({
    photo: { id: photoId, storageKey: 'private-key' },
    equipmentUpdatedAt: new Date(nextToken),
    changed: true,
  } as Awaited<ReturnType<typeof setPrimaryEquipmentPhoto>>);
  vi.mocked(getEquipmentPhotoReadUrl).mockResolvedValue({
    url: 'https://signed.invalid/display.webp?secret=never-log',
    expiresInSeconds: 300,
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function deleteRequest(
  body = JSON.stringify({ expectedUpdatedAt: token, confirmed: true }),
  headers: Record<string, string> = {},
) {
  return new Request(`${origin}/equipment/${equipmentId}/photos/${photoId}`, {
    method: 'DELETE',
    headers: { origin, 'content-type': 'application/json', ...headers },
    body,
  });
}
test.each([false, true])(
  'delete route returns committed deletion with cleanup warning %s and no storage details',
  async (cleanupPending) => {
    vi.mocked(deleteEquipmentPhoto).mockResolvedValue({
      deletedPhotoId: photoId,
      primaryPhotoId: null,
      equipmentUpdatedAt: new Date(nextToken),
      cleanupPending,
    });
    const response = await deleteRoute(deleteRequest(), {
      params: Promise.resolve({ equipmentId, photoId }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toMatchObject({
      success: true,
      deletedPhotoId: photoId,
      primaryPhotoId: null,
      equipmentUpdatedAt: nextToken,
      cleanupPending,
    });
    expect(deleteEquipmentPhoto).toHaveBeenCalledExactlyOnceWith(equipmentId, photoId, {
      expectedUpdatedAt: token,
      confirmed: true,
    });
  },
);
test.each([
  ['origin', 403],
  ['content-type', 415],
  ['oversize', 413],
  ['malformed', 400],
])('delete route rejects %s at the boundary', async (failure, status) => {
  const request = deleteRequest(
    failure === 'oversize' ? 'x'.repeat(1025) : '{',
    failure === 'origin'
      ? { origin: 'https://elsewhere.invalid' }
      : failure === 'content-type'
        ? { 'content-type': 'text/plain' }
        : {},
  );
  expect(
    (await deleteRoute(request, { params: Promise.resolve({ equipmentId, photoId }) })).status,
  ).toBe(status);
  expect(deleteEquipmentPhoto).not.toHaveBeenCalled();
});
test.each([
  ['NOT_FOUND', 404],
  ['STALE_UPDATE', 409],
  ['VALIDATION_FAILED', 400],
  ['unexpected', 500],
] as const)('delete route safely maps %s', async (code, status) => {
  vi.mocked(deleteEquipmentPhoto).mockRejectedValue(
    code === 'unexpected'
      ? new Error('provider secret')
      : new EquipmentError(code, 'Safe photo error'),
  );
  const response = await deleteRoute(deleteRequest(), {
    params: Promise.resolve({ equipmentId, photoId }),
  });
  expect(response.status).toBe(status);
  const body = await response.json();
  expect(body.success).toBe(false);
  expect(JSON.stringify(body)).not.toContain('provider secret');
  if (code === 'STALE_UPDATE') expect(body.stale).toBe(true);
  if (code === 'unexpected') expect(body.checkSaved).toBe(true);
});

test('upload passes an explicit crop but rejects malformed or expanded crop data', async () => {
  const crop = { x: 0.1, y: 0.2, size: 0.5 };
  const data = form();
  data.set('crop', JSON.stringify(crop));
  expect(
    (await uploadRoute(uploadRequest(data), { params: Promise.resolve({ equipmentId }) })).status,
  ).toBe(201);
  expect(vi.mocked(uploadEquipmentPhoto).mock.calls[0][1].crop).toEqual(crop);
  for (const invalid of [
    '{',
    JSON.stringify({ ...crop, storageKey: 'bad' }),
    JSON.stringify({ ...crop, size: -1 }),
  ]) {
    const bad = form();
    bad.set('crop', invalid);
    expect(
      (await uploadRoute(uploadRequest(bad), { params: Promise.resolve({ equipmentId }) })).status,
    ).toBe(400);
  }
  expect(uploadEquipmentPhoto).toHaveBeenCalledOnce();
});
test('new upload preview has bounded multipart and same origin rules, and never calls upload', async () => {
  const data = new FormData();
  data.set('image', new File(['test'], 'test.jpg'));
  data.set('expectedUpdatedAt', token);
  vi.mocked(previewNewEquipmentPhoto).mockResolvedValue({
    image: Buffer.from('processed-webp'),
    width: 200,
    height: 400,
  });
  const response = await newPreviewRoute(uploadRequest(data), {
    params: Promise.resolve({ equipmentId }),
  });
  expect(await response.json()).toEqual({
    success: true,
    width: 200,
    height: 400,
    preview: `data:image/webp;base64,${Buffer.from('processed-webp').toString('base64')}`,
  });
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(uploadEquipmentPhoto).not.toHaveBeenCalled();
  expect(
    (
      await newPreviewRoute(uploadRequest(data, { origin: 'https://elsewhere.invalid' }), {
        params: Promise.resolve({ equipmentId }),
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
  expect((await newPreviewRoute(huge, { params: Promise.resolve({ equipmentId }) })).status).toBe(
    413,
  );
});
test('crop boundary saves through the service and returns a refresh marker, never storage keys', async () => {
  const revision = randomUUID();
  const input = { crop: { x: 0, y: 0.25, size: 0.5 }, expectedUpdatedAt: token };
  vi.mocked(updateEquipmentPhotoCrop).mockResolvedValue({
    photo: { derivativeRevision: revision },
    equipmentUpdatedAt: new Date(nextToken),
    changed: true,
  } as Awaited<ReturnType<typeof updateEquipmentPhotoCrop>>);
  const response = await cropRoute(primaryRequest(input), {
    params: Promise.resolve({ equipmentId, photoId }),
  });
  expect(response.status).toBe(200);
  expect(updateEquipmentPhotoCrop).toHaveBeenCalledWith(equipmentId, photoId, input);
  expect(await response.json()).toMatchObject({
    photoId,
    derivativeRevision: revision,
    equipmentUpdatedAt: nextToken,
  });
  expect(
    (
      await cropRoute(primaryRequest(input, { origin: 'https://bad.invalid' }), {
        params: Promise.resolve({ equipmentId, photoId }),
      })
    ).status,
  ).toBe(403);
});
test.each(['stale', 'unexpected'])('crop errors remain safe (%s)', async (kind) => {
  vi.mocked(updateEquipmentPhotoCrop).mockRejectedValue(
    kind === 'stale'
      ? new EquipmentError('STALE_UPDATE', 'Equipment changed.')
      : new Error('SECRET provider key'),
  );
  const response = await cropRoute(
    primaryRequest({ crop: { x: 0, y: 0, size: 1 }, expectedUpdatedAt: token }),
    { params: Promise.resolve({ equipmentId, photoId }) },
  );
  expect(response.status).toBe(kind === 'stale' ? 409 : 500);
  expect(await response.text()).not.toContain('SECRET');
});
test('existing editor preview returns dimensions/crop without exposing an original or storage key', async () => {
  vi.mocked(getEquipmentPhotoCropPreview).mockResolvedValue({
    width: 200,
    height: 400,
    crop: null,
  });
  const response = await cropPreviewRoute(new Request(origin), {
    params: Promise.resolve({ equipmentId, photoId }),
  });
  expect(await response.json()).toEqual({ success: true, width: 200, height: 400, crop: null });
  expect(getEquipmentPhotoCropPreview).toHaveBeenCalledWith(equipmentId, photoId);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
});

test('upload route passes only approved fields and returns a new token, not storage metadata', async () => {
  const response = await uploadRoute(uploadRequest(), { params: Promise.resolve({ equipmentId }) });
  expect(response.status).toBe(201);
  expect(await response.json()).toEqual({
    success: true,
    message: 'Photo uploaded.',
    equipmentUpdatedAt: nextToken,
  });
  expect(uploadEquipmentPhoto).toHaveBeenCalledWith(equipmentId, {
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
    const request = new NextRequest(`${localOrigin}/equipment/${equipmentId}/photos`, {
      method: 'POST',
      headers,
      body: form(),
    });
    expect(new URL(request.url).hostname).toBe('localhost');
    const response = await uploadRoute(request, { params: Promise.resolve({ equipmentId }) });
    expect(response.status).toBe(201);
    const primary = new NextRequest(
      `${localOrigin}/equipment/${equipmentId}/photos/${photoId}/primary`,
      {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ expectedUpdatedAt: token }),
      },
    );
    expect(
      (await primaryRoute(primary, { params: Promise.resolve({ equipmentId, photoId }) })).status,
    ).toBe(200);
    expect(uploadEquipmentPhoto).toHaveBeenCalledOnce();
    expect(setPrimaryEquipmentPhoto).toHaveBeenCalledOnce();
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
    const request = new NextRequest(`${origin}/equipment/${equipmentId}/photos`, {
      method: 'POST',
      headers,
      body: form(),
    });
    expect((await uploadEquipmentPhotoRequest(request, equipmentId)).status).toBe(403);
    const primary = new NextRequest(
      `${origin}/equipment/${equipmentId}/photos/${photoId}/primary`,
      {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ expectedUpdatedAt: token }),
      },
    );
    expect((await setPrimaryEquipmentPhotoRequest(primary, equipmentId, photoId)).status).toBe(403);
    expect(uploadEquipmentPhoto).not.toHaveBeenCalled();
    expect(setPrimaryEquipmentPhoto).not.toHaveBeenCalled();
  },
);

test('forwarded headers cannot override the real loopback Host and Origin', async () => {
  const request = new NextRequest(`${origin}/equipment/${equipmentId}/photos`, {
    method: 'POST',
    headers: {
      host: '127.0.0.1:3000',
      origin,
      'x-forwarded-host': 'other.invalid',
      'x-forwarded-proto': 'https',
    },
    body: form(),
  });
  expect((await uploadEquipmentPhotoRequest(request, equipmentId)).status).toBe(201);
});
test('blank optional fields remain blank/null for service normalisation, MIME is not trusted', async () => {
  const data = form();
  data.set(
    'image',
    new File([new Uint8Array([1, 2, 3])], 'pretend.svg', { type: 'image/svg+xml' }),
  );
  data.set('caption', '');
  data.set('takenAt', '');
  await uploadEquipmentPhotoRequest(uploadRequest(data), equipmentId);
  expect(uploadEquipmentPhoto).toHaveBeenCalledWith(
    equipmentId,
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
  expect((await uploadEquipmentPhotoRequest(uploadRequest(data), equipmentId)).status).toBe(400);
  expect(uploadEquipmentPhoto).not.toHaveBeenCalled();
});
test.each(['image', 'caption', 'takenAt', 'expectedUpdatedAt'])(
  'rejects repeated %s instead of choosing one',
  async (key) => {
    const data = form();
    data.append(key, 'duplicate');
    expect((await uploadEquipmentPhotoRequest(uploadRequest(data), equipmentId)).status).toBe(400);
    expect(uploadEquipmentPhoto).not.toHaveBeenCalled();
  },
);
test.each([
  {},
  { origin: 'https://other.invalid' },
  { origin: 'null' },
  { origin, 'sec-fetch-site': 'cross-site' },
] as Record<string, string>[])('rejects absent/foreign Origin before writes', async (headers) => {
  expect(
    (await uploadEquipmentPhotoRequest(uploadRequest(form(), headers), equipmentId)).status,
  ).toBe(403);
  expect(uploadEquipmentPhoto).not.toHaveBeenCalled();
});
test('rejects wrong content type and malformed multipart', async () => {
  expect(
    (
      await uploadEquipmentPhotoRequest(
        new Request(origin, { method: 'POST', headers: { origin }, body: 'not multipart' }),
        equipmentId,
      )
    ).status,
  ).toBe(415);
  expect(
    (
      await uploadEquipmentPhotoRequest(
        new Request(origin, {
          method: 'POST',
          headers: { origin, 'content-type': 'multipart/form-data; boundary=x' },
          body: 'broken',
        }),
        equipmentId,
      )
    ).status,
  ).toBe(400);
  expect(uploadEquipmentPhoto).not.toHaveBeenCalled();
});
test('missing file and a text value in place of a file return an image issue', async () => {
  for (const value of [null, 'not a file', new File([], '')]) {
    const data = form();
    data.delete('image');
    if (value !== null) data.set('image', value);
    const response = await uploadEquipmentPhotoRequest(uploadRequest(data), equipmentId);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ issues: [{ field: 'image' }] });
  }
});
test('rejects a file over 10 MiB even within the multipart allowance', async () => {
  const data = form();
  data.set('image', new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'big.jpg'));
  expect((await uploadEquipmentPhotoRequest(uploadRequest(data), equipmentId)).status).toBe(413);
  expect(uploadEquipmentPhoto).not.toHaveBeenCalled();
});

test('accepts the exact 10 MiB file limit plus its bounded form envelope', async () => {
  const data = form();
  data.set('image', new File([new Uint8Array(10 * 1024 * 1024)], 'large.jpg'));
  const response = await uploadEquipmentPhotoRequest(uploadRequest(data), equipmentId);
  expect(response.status).toBe(201);
  expect(vi.mocked(uploadEquipmentPhoto).mock.calls[0][1].image.byteLength).toBe(10 * 1024 * 1024);
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
    expect((await uploadEquipmentPhotoRequest(request, equipmentId)).status).toBe(413);
    expect(cancel).toHaveBeenCalled();
    expect(uploadEquipmentPhoto).not.toHaveBeenCalled();
  },
);
test('rejects oversized declared length without parsing', async () => {
  const request = uploadRequest(form(), {
    origin,
    'content-length': String(MAX_PHOTO_REQUEST_BYTES + 1),
  });
  expect((await uploadEquipmentPhotoRequest(request, equipmentId)).status).toBe(413);
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
  const result = uploadEquipmentPhotoRequest(request, equipmentId);
  await vi.advanceTimersByTimeAsync(30_001);
  expect((await result).status).toBe(408);
  expect(cancel).toHaveBeenCalled();
  expect(uploadEquipmentPhoto).not.toHaveBeenCalled();
});
test.each([
  ['VALIDATION_FAILED', 400],
  ['NOT_FOUND', 404],
  ['STALE_UPDATE', 409],
] as const)('maps %s safely with field feedback', async (code, status) => {
  vi.mocked(uploadEquipmentPhoto).mockRejectedValue(
    new EquipmentError(code, 'Safe message', {
      cause: new Error('private diagnostics'),
      issues: [{ field: 'caption', message: 'Check caption' }],
    }),
  );
  const response = await uploadEquipmentPhotoRequest(uploadRequest(), equipmentId);
  expect(response.status).toBe(status);
  expect(await response.json()).toEqual({
    success: false,
    message: 'Safe message',
    issues: [{ field: 'caption', message: 'Check caption' }],
    ...(code === 'STALE_UPDATE' ? { stale: true } : {}),
  });
});
test.each([new Error('secret signed URL'), new EquipmentError('CONFLICT', 'raw constraint')])(
  'does not disclose unexpected diagnostics or log raw errors',
  async (error) => {
    vi.mocked(uploadEquipmentPhoto).mockRejectedValue(error);
    const response = await uploadEquipmentPhotoRequest(uploadRequest(), equipmentId);
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain(error.message);
    expect(console.error).toHaveBeenCalledWith(
      'Equipment photo request failed; check service recovery diagnostics.',
    );
  },
);
test('primary route sends only photo identity and the current token to the service', async () => {
  const response = await primaryRoute(primaryRequest(), {
    params: Promise.resolve({ equipmentId, photoId }),
  });
  expect(setPrimaryEquipmentPhoto).toHaveBeenCalledWith(equipmentId, {
    photoId,
    expectedUpdatedAt: token,
  });
  expect(await response.json()).toEqual({
    success: true,
    message: 'Primary photo saved.',
    equipmentUpdatedAt: nextToken,
  });
});
test('primary boundary rejects fields, cross origin, large bodies and wrong content type', async () => {
  expect(
    (
      await setPrimaryEquipmentPhotoRequest(
        primaryRequest({ expectedUpdatedAt: token, isPrimary: true }),
        equipmentId,
        photoId,
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await setPrimaryEquipmentPhotoRequest(
        primaryRequest(undefined, { origin: 'https://elsewhere.invalid' }),
        equipmentId,
        photoId,
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await setPrimaryEquipmentPhotoRequest(
        primaryRequest({ expectedUpdatedAt: 'x'.repeat(2000) }),
        equipmentId,
        photoId,
      )
    ).status,
  ).toBe(413);
  expect(
    (
      await setPrimaryEquipmentPhotoRequest(
        primaryRequest(undefined, { 'content-type': 'text/plain' }),
        equipmentId,
        photoId,
      )
    ).status,
  ).toBe(415);
  expect(setPrimaryEquipmentPhoto).not.toHaveBeenCalled();
});
test.each(['display', 'thumbnail'])(
  'delivery route redirects %s privately without caching or logging the URL',
  async (variant) => {
    const response = await deliveryRoute(new Request(origin), {
      params: Promise.resolve({ equipmentId, photoId, variant }),
    });
    expect(getEquipmentPhotoReadUrl).toHaveBeenCalledWith(equipmentId, photoId, variant);
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
    vi.mocked(getEquipmentPhotoReadUrl).mockRejectedValue(
      code === 'unexpected'
        ? new Error('private diagnostics')
        : new EquipmentError(code, 'private diagnostics'),
    );
    const response = await deliverEquipmentPhoto(equipmentId, photoId, 'original');
    expect(response.status).toBe(status);
    expect(response.headers.get('location')).toBeNull();
    expect(await response.text()).toBe('Photo unavailable.');
  },
);
