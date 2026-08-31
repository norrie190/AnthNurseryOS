import 'server-only';
import { z } from 'zod';
import { PlantError } from './plant-errors';
import { MAX_PHOTO_BYTES } from './plant-photo-input';
import {
  uploadPlantPhoto,
  setPrimaryPlantPhoto,
  updatePlantPhotoCrop,
  previewNewPlantPhoto,
  getPlantPhotoCropPreview,
  deletePlantPhoto,
} from './plant-photo-service';
import { photoCropSchema } from './plant-photo-crop';
import { getPlantPhotoReadUrl } from './plant-photo-queries';
import type { PhotoVariant } from './plant-photo-keys';
import type { PhotoResponse } from './plant-photo-browser';

const privateHeaders = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' };
export const MAX_PHOTO_REQUEST_BYTES = MAX_PHOTO_BYTES + 64 * 1024;

class PhotoRequestError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

function json(body: PhotoResponse, status = 200) {
  return Response.json(body, { status, headers: privateHeaders });
}

function checkOrigin(request: Request) {
  const target = new URL(request.url);
  let expectedOrigin = target.origin;
  const host = request.headers.get('host')?.toLowerCase();
  // NextRequest normalises 127.0.0.1 to localhost. Recover the browser's actual
  // address only for our two explicit HTTP loopback hosts on the same port.
  // Never trust arbitrary Host or forwarded headers as an allowed origin.
  if (target.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(target.hostname) && host) {
    const port = target.port ? `:${target.port}` : '';
    if (![`localhost${port}`, `127.0.0.1${port}`].includes(host)) {
      throw new PhotoRequestError('This photo request must come from the nursery app.', 403);
    }
    expectedOrigin = `http://${host}`;
  }
  if (
    request.headers.get('origin') !== expectedOrigin ||
    request.headers.get('sec-fetch-site') === 'cross-site'
  ) {
    throw new PhotoRequestError('This photo request must come from the nursery app.', 403);
  }
}

async function boundedBody(request: Request, limit: number): Promise<Buffer> {
  const declared = request.headers.get('content-length');
  if (declared && Number(declared) > limit)
    throw new PhotoRequestError('The photo request is too large.', 413);
  if (!request.body) throw new PhotoRequestError('The photo request was empty.');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new PhotoRequestError('The upload took too long. Please try again.', 408)),
      30_000,
    );
  });
  try {
    while (true) {
      const { value, done } = await Promise.race([reader.read(), timeout]);
      if (done) return Buffer.concat(chunks, size);
      size += value.byteLength;
      if (size > limit) throw new PhotoRequestError('The photo request is too large.', 413);
      chunks.push(value);
    }
  } finally {
    clearTimeout(timer);
    // Do not wait for a stalled sender to acknowledge cancellation.
    void reader.cancel().catch(() => {});
  }
}

function photoFailure(error: unknown): Response {
  if (error instanceof PhotoRequestError)
    return json({ success: false, message: error.message }, error.status);
  if (error instanceof PlantError && error.code !== 'CONFLICT') {
    return json(
      {
        success: false,
        message: error.message,
        issues: [...error.issues],
        ...(error.code === 'STALE_UPDATE' ? { stale: true } : {}),
      },
      error.code === 'NOT_FOUND' ? 404 : error.code === 'STALE_UPDATE' ? 409 : 400,
    );
  }
  // Services retain causes and log targeted recovery context. Never log a raw R2
  // error here: it can contain credentials or signed URL query parameters.
  console.error('Plant photo request failed; check service recovery diagnostics.');
  return json(
    {
      success: false,
      message:
        'We could not confirm the photo change. Check the Plant details before trying again.',
      checkSaved: true,
    },
    500,
  );
}

export async function uploadPlantPhotoRequest(
  request: Request,
  plantId: string,
  previewOnly = false,
): Promise<Response> {
  try {
    checkOrigin(request);
    const contentType = request.headers.get('content-type') ?? '';
    if (!/^multipart\/form-data\s*;/i.test(contentType))
      throw new PhotoRequestError('Choose a photo using the upload form.', 415);
    const bytes = await boundedBody(request, MAX_PHOTO_REQUEST_BYTES);
    let form: FormData;
    try {
      form = await new Response(new Uint8Array(bytes), {
        headers: { 'Content-Type': contentType },
      }).formData();
    } catch {
      throw new PhotoRequestError('The photo form could not be read. Select the file again.');
    }
    const allowed = new Set(
      previewOnly
        ? ['image', 'expectedUpdatedAt']
        : ['image', 'caption', 'takenAt', 'expectedUpdatedAt', 'crop'],
    );
    for (const key of form.keys()) {
      if (!allowed.has(key) || form.getAll(key).length !== 1)
        throw new PhotoRequestError('The photo form contains unsupported or repeated fields.');
    }
    const file = form.get('image');
    if (!(file instanceof File) || file.size === 0)
      throw new PlantError('VALIDATION_FAILED', 'Choose an image to upload.', {
        issues: [{ field: 'image', message: 'Choose one JPEG, PNG or static WebP image.' }],
      });
    if (file.size > MAX_PHOTO_BYTES)
      throw new PhotoRequestError('Choose one image up to 10 MiB.', 413);
    function text(name: string) {
      const value = form.get(name);
      if (value !== null && typeof value !== 'string')
        throw new PhotoRequestError('Photo details must be text.');
      return value;
    }
    let crop;
    try {
      const value = text('crop');
      crop = value ? photoCropSchema.parse(JSON.parse(value)) : undefined;
    } catch {
      throw new PhotoRequestError('Choose a valid square crop.');
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
      const preview = await previewNewPlantPhoto(plantId, input);
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
    const result = await uploadPlantPhoto(plantId, input);
    return json(
      {
        success: true,
        message: 'Photo uploaded.',
        plantUpdatedAt: result.plantUpdatedAt.toISOString(),
      },
      201,
    );
  } catch (error) {
    return photoFailure(error);
  }
}

export async function cropPlantPhotoRequest(request: Request, plantId: string, photoId: string) {
  try {
    checkOrigin(request);
    if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json')
      throw new PhotoRequestError('The crop request must use JSON.', 415);
    const bytes = await boundedBody(request, 2048);
    let input;
    try {
      input = JSON.parse(bytes.toString('utf8'));
    } catch {
      throw new PhotoRequestError('The crop request could not be read.');
    }
    const result = await updatePlantPhotoCrop(plantId, photoId, input);
    return json({
      success: true,
      message: result.changed
        ? 'Thumbnail crop saved. Your full photo is unchanged.'
        : 'This crop is already saved.',
      plantUpdatedAt: result.plantUpdatedAt.toISOString(),
      photoId,
      derivativeRevision: result.photo.derivativeRevision!,
    });
  } catch (error) {
    return photoFailure(error);
  }
}

export async function cropPlantPhotoPreviewRequest(plantId: string, photoId: string) {
  try {
    return Response.json(
      { success: true, ...(await getPlantPhotoCropPreview(plantId, photoId)) },
      { headers: privateHeaders },
    );
  } catch (error) {
    return photoFailure(error);
  }
}

export async function setPrimaryPlantPhotoRequest(
  request: Request,
  plantId: string,
  photoId: string,
): Promise<Response> {
  try {
    checkOrigin(request);
    if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json')
      throw new PhotoRequestError('The primary photo request must use JSON.', 415);
    const bytes = await boundedBody(request, 1024);
    let input: unknown;
    try {
      input = JSON.parse(bytes.toString('utf8'));
    } catch {
      throw new PhotoRequestError('The primary photo request could not be read.');
    }
    const parsed = z.strictObject({ expectedUpdatedAt: z.string() }).safeParse(input);
    if (!parsed.success)
      throw new PhotoRequestError('The primary photo request contains invalid fields.');
    const result = await setPrimaryPlantPhoto(plantId, { photoId, ...parsed.data });
    return json({
      success: true,
      message: 'Primary photo saved.',
      plantUpdatedAt: result.plantUpdatedAt.toISOString(),
    });
  } catch (error) {
    return photoFailure(error);
  }
}

export async function deletePlantPhotoRequest(request: Request, plantId: string, photoId: string) {
  try {
    checkOrigin(request);
    if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json')
      throw new PhotoRequestError('The delete photo request must use JSON.', 415);
    const bytes = await boundedBody(request, 1024);
    let input;
    try {
      input = JSON.parse(bytes.toString('utf8'));
    } catch {
      throw new PhotoRequestError('The delete photo request could not be read.');
    }
    const result = await deletePlantPhoto(plantId, photoId, input);
    return json({
      success: true,
      message: result.cleanupPending
        ? 'Photo deleted from the nursery record, but storage cleanup could not be completed. Some files may remain in R2. Check the server diagnostics before any manual cleanup.'
        : 'Photo permanently deleted.',
      deletedPhotoId: result.deletedPhotoId,
      primaryPhotoId: result.primaryPhotoId,
      plantUpdatedAt: result.plantUpdatedAt.toISOString(),
      cleanupPending: result.cleanupPending,
    });
  } catch (error) {
    return photoFailure(error);
  }
}

export async function deliverPlantPhoto(
  plantId: string,
  photoId: string,
  variant: string,
): Promise<Response> {
  try {
    // The existing read helper validates the variant and both UUIDs, verifies
    // ownership, and signs only a known derivative. It never serves originals.
    const { url } = await getPlantPhotoReadUrl(plantId, photoId, variant as PhotoVariant);
    return new Response(null, { status: 307, headers: { ...privateHeaders, Location: url } });
  } catch (error) {
    const status = error instanceof PlantError ? (error.code === 'NOT_FOUND' ? 404 : 400) : 503;
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
