import 'server-only';
import { z } from 'zod';
import { MAX_PHOTO_BYTES } from '../../lib/photos/photo-limits';
import { photoCropSchema } from '../../lib/photos/photo-crop';
import { EquipmentError } from './equipment-errors';
import type { EquipmentPhotoResponse } from './equipment-photo-browser';
import type { PhotoVariant } from './equipment-photo-keys';
import { getEquipmentPhotoReadUrl } from './equipment-photo-queries';
import {
  deleteEquipmentPhoto,
  getEquipmentPhotoCropPreview,
  previewNewEquipmentPhoto,
  setPrimaryEquipmentPhoto,
  updateEquipmentPhotoCrop,
  uploadEquipmentPhoto,
} from './equipment-photo-service';
import type {
  DeleteEquipmentPhotoInput,
  UpdateEquipmentPhotoCropInput,
} from './equipment-photo-input';

const privateHeaders = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' };
export const MAX_EQUIPMENT_PHOTO_REQUEST_BYTES = MAX_PHOTO_BYTES + 64 * 1024;
export const MAX_PHOTO_REQUEST_BYTES = MAX_EQUIPMENT_PHOTO_REQUEST_BYTES;

class EquipmentPhotoRequestError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

function json(body: EquipmentPhotoResponse, status = 200) {
  return Response.json(body, { status, headers: privateHeaders });
}

function checkOrigin(request: Request) {
  const target = new URL(request.url);
  let expectedOrigin = target.origin;
  const host = request.headers.get('host')?.toLowerCase();
  if (target.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(target.hostname) && host) {
    const port = target.port ? `:${target.port}` : '';
    if (![`localhost${port}`, `127.0.0.1${port}`].includes(host))
      throw new EquipmentPhotoRequestError(
        'This photo request must come from the nursery app.',
        403,
      );
    expectedOrigin = `http://${host}`;
  }
  if (
    request.headers.get('origin') !== expectedOrigin ||
    request.headers.get('sec-fetch-site') === 'cross-site'
  )
    throw new EquipmentPhotoRequestError('This photo request must come from the nursery app.', 403);
}

async function boundedBody(request: Request, limit: number): Promise<Buffer> {
  const declared = request.headers.get('content-length');
  if (declared && Number(declared) > limit)
    throw new EquipmentPhotoRequestError('The photo request is too large.', 413);
  if (!request.body) throw new EquipmentPhotoRequestError('The photo request was empty.');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(new EquipmentPhotoRequestError('The upload took too long. Please try again.', 408)),
      30_000,
    );
  });
  try {
    while (true) {
      const { value, done } = await Promise.race([reader.read(), timeout]);
      if (done) return Buffer.concat(chunks, size);
      size += value.byteLength;
      if (size > limit)
        throw new EquipmentPhotoRequestError('The photo request is too large.', 413);
      chunks.push(value);
    }
  } finally {
    clearTimeout(timer);
    void reader.cancel().catch(() => {});
  }
}

function photoFailure(error: unknown): Response {
  if (error instanceof EquipmentPhotoRequestError)
    return json({ success: false, message: error.message }, error.status);
  if (error instanceof EquipmentError && error.code !== 'CONFLICT')
    return json(
      {
        success: false,
        message: error.message,
        issues: [...error.issues],
        ...(error.code === 'STALE_UPDATE' ? { stale: true } : {}),
      },
      error.code === 'NOT_FOUND' ? 404 : error.code === 'STALE_UPDATE' ? 409 : 400,
    );
  console.error('Equipment photo request failed; check service recovery diagnostics.');
  return json(
    {
      success: false,
      message:
        'We could not confirm the photo change. Check the Equipment details before trying again.',
      checkSaved: true,
    },
    500,
  );
}

export async function uploadEquipmentPhotoRequest(
  request: Request,
  equipmentId: string,
  previewOnly = false,
): Promise<Response> {
  try {
    checkOrigin(request);
    const contentType = request.headers.get('content-type') ?? '';
    if (!/^multipart\/form-data\s*;/i.test(contentType))
      throw new EquipmentPhotoRequestError('Choose a photo using the upload form.', 415);
    const bytes = await boundedBody(request, MAX_EQUIPMENT_PHOTO_REQUEST_BYTES);
    let form: FormData;
    try {
      form = await new Response(new Uint8Array(bytes), {
        headers: { 'Content-Type': contentType },
      }).formData();
    } catch {
      throw new EquipmentPhotoRequestError(
        'The photo form could not be read. Select the file again.',
      );
    }
    const allowed = new Set(
      previewOnly
        ? ['image', 'expectedUpdatedAt']
        : ['image', 'caption', 'takenAt', 'expectedUpdatedAt', 'crop'],
    );
    for (const key of form.keys()) {
      if (!allowed.has(key) || form.getAll(key).length !== 1)
        throw new EquipmentPhotoRequestError(
          'The photo form contains unsupported or repeated fields.',
        );
    }
    const file = form.get('image');
    if (!(file instanceof File) || file.size === 0)
      throw new EquipmentError('VALIDATION_FAILED', 'Choose an image to upload.', {
        issues: [{ field: 'image', message: 'Choose one JPEG, PNG or static WebP image.' }],
      });
    if (file.size > MAX_PHOTO_BYTES)
      throw new EquipmentPhotoRequestError('Choose one image up to 10 MiB.', 413);
    function text(name: string) {
      const value = form.get(name);
      if (value !== null && typeof value !== 'string')
        throw new EquipmentPhotoRequestError('Photo details must be text.');
      return value;
    }
    let crop;
    try {
      const value = text('crop');
      crop = value ? photoCropSchema.parse(JSON.parse(value)) : undefined;
    } catch {
      throw new EquipmentPhotoRequestError('Choose a valid square crop.');
    }
    const input = {
      image: new Uint8Array(await file.arrayBuffer()),
      originalFilename: file.name,
      caption: text('caption'),
      takenAt: text('takenAt') || null,
      expectedUpdatedAt: text('expectedUpdatedAt') ?? '',
      crop,
    };
    if (previewOnly) {
      const preview = await previewNewEquipmentPhoto(equipmentId, input);
      return Response.json(
        {
          success: true,
          width: preview.width,
          height: preview.height,
          preview: `data:image/webp;base64,${preview.image.toString('base64')}`,
        },
        { headers: privateHeaders },
      );
    }
    const result = await uploadEquipmentPhoto(equipmentId, input);
    return json(
      {
        success: true,
        message: 'Photo uploaded.',
        equipmentUpdatedAt: result.equipmentUpdatedAt.toISOString(),
      },
      201,
    );
  } catch (error) {
    return photoFailure(error);
  }
}

export async function cropEquipmentPhotoRequest(
  request: Request,
  equipmentId: string,
  photoId: string,
) {
  try {
    checkOrigin(request);
    if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json')
      throw new EquipmentPhotoRequestError('The crop request must use JSON.', 415);
    const bytes = await boundedBody(request, 2048);
    let input: unknown;
    try {
      input = JSON.parse(bytes.toString('utf8'));
    } catch {
      throw new EquipmentPhotoRequestError('The crop request could not be read.');
    }
    const result = await updateEquipmentPhotoCrop(
      equipmentId,
      photoId,
      input as UpdateEquipmentPhotoCropInput,
    );
    return json({
      success: true,
      message: result.changed
        ? 'Thumbnail crop saved. Your full photo is unchanged.'
        : 'This crop is already saved.',
      equipmentUpdatedAt: result.equipmentUpdatedAt.toISOString(),
      photoId,
      derivativeRevision: result.photo.derivativeRevision!,
    });
  } catch (error) {
    return photoFailure(error);
  }
}

export async function cropEquipmentPhotoPreviewRequest(equipmentId: string, photoId: string) {
  try {
    return Response.json(
      { success: true, ...(await getEquipmentPhotoCropPreview(equipmentId, photoId)) },
      { headers: privateHeaders },
    );
  } catch (error) {
    return photoFailure(error);
  }
}

export async function setPrimaryEquipmentPhotoRequest(
  request: Request,
  equipmentId: string,
  photoId: string,
): Promise<Response> {
  try {
    checkOrigin(request);
    if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json')
      throw new EquipmentPhotoRequestError('The primary photo request must use JSON.', 415);
    const bytes = await boundedBody(request, 1024);
    let input: unknown;
    try {
      input = JSON.parse(bytes.toString('utf8'));
    } catch {
      throw new EquipmentPhotoRequestError('The primary photo request could not be read.');
    }
    const parsed = z.strictObject({ expectedUpdatedAt: z.string() }).safeParse(input);
    if (!parsed.success)
      throw new EquipmentPhotoRequestError('The primary photo request contains invalid fields.');
    const result = await setPrimaryEquipmentPhoto(equipmentId, { photoId, ...parsed.data });
    return json({
      success: true,
      message: 'Primary photo saved.',
      equipmentUpdatedAt: result.equipmentUpdatedAt.toISOString(),
    });
  } catch (error) {
    return photoFailure(error);
  }
}

export async function deleteEquipmentPhotoRequest(
  request: Request,
  equipmentId: string,
  photoId: string,
) {
  try {
    checkOrigin(request);
    if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json')
      throw new EquipmentPhotoRequestError('The delete photo request must use JSON.', 415);
    const bytes = await boundedBody(request, 1024);
    let input: unknown;
    try {
      input = JSON.parse(bytes.toString('utf8'));
    } catch {
      throw new EquipmentPhotoRequestError('The delete photo request could not be read.');
    }
    const result = await deleteEquipmentPhoto(
      equipmentId,
      photoId,
      input as DeleteEquipmentPhotoInput,
    );
    return json({
      success: true,
      message: result.cleanupPending
        ? 'Photo deleted from the Equipment record, but storage cleanup could not be fully confirmed. Some files may remain in R2. Check the server diagnostics before any manual cleanup.'
        : 'Photo permanently deleted.',
      deletedPhotoId: result.deletedPhotoId,
      primaryPhotoId: result.primaryPhotoId,
      equipmentUpdatedAt: result.equipmentUpdatedAt.toISOString(),
      cleanupPending: result.cleanupPending,
    });
  } catch (error) {
    return photoFailure(error);
  }
}

export async function deliverEquipmentPhoto(
  equipmentId: string,
  photoId: string,
  variant: string,
): Promise<Response> {
  try {
    const { url } = await getEquipmentPhotoReadUrl(equipmentId, photoId, variant as PhotoVariant);
    return new Response(null, { status: 307, headers: { ...privateHeaders, Location: url } });
  } catch (error) {
    const status = error instanceof EquipmentError ? (error.code === 'NOT_FOUND' ? 404 : 400) : 503;
    return new Response('Photo unavailable.', {
      status,
      headers: {
        ...privateHeaders,
        'Content-Type': 'text/plain',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }
}
