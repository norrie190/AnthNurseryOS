import 'server-only';
import sharp, { type Raw } from 'sharp';
import { PlantError } from './plant-errors';
import { MAX_PHOTO_BYTES, MAX_PHOTO_PIXELS } from './plant-photo-input';
import type { PhotoExtension } from './plant-photo-keys';
import { centredPhotoCrop, photoCropPixels, type PhotoCrop } from './plant-photo-crop';

const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const decodeOptions = { limitInputPixels: MAX_PHOTO_PIXELS, failOn: 'warning' as const };

function invalidPhoto(message: string, cause?: unknown): PlantError {
  return new PlantError('VALIDATION_FAILED', message, {
    cause,
    issues: [{ field: 'image', message }],
  });
}

function detectedExtension(bytes: Buffer): PhotoExtension {
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'jpg';
  if (bytes.subarray(0, 8).equals(pngSignature)) {
    // Some PNG decoders expose only the first APNG frame. Reject animation from its
    // chunk structure as well, rather than silently accepting that first frame.
    for (let offset = 8; offset + 12 <= bytes.length;) {
      const length = bytes.readUInt32BE(offset);
      if (offset + 12 + length > bytes.length)
        throw invalidPhoto('The image is incomplete or malformed.');
      const chunk = bytes.toString('ascii', offset + 4, offset + 8);
      if (chunk === 'acTL') throw invalidPhoto('Animated images are not supported.');
      offset += 12 + length;
      if (chunk === 'IEND') break;
    }
    return 'png';
  }
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    for (let offset = 12; offset + 8 <= bytes.length;) {
      const chunk = bytes.toString('ascii', offset, offset + 4);
      const length = bytes.readUInt32LE(offset + 4);
      if (offset + 8 + length > bytes.length)
        throw invalidPhoto('The image is incomplete or malformed.');
      if (
        chunk === 'ANIM' ||
        chunk === 'ANMF' ||
        (chunk === 'VP8X' && length > 0 && bytes[offset + 8] & 2)
      ) {
        throw invalidPhoto('Animated images are not supported.');
      }
      offset += 8 + length + (length % 2);
    }
    return 'webp';
  }
  throw invalidPhoto(
    'Choose a JPEG, PNG or static WebP image. Export HEIC/HEIF photos as JPEG first.',
  );
}

async function decodePhoto(bytes: Buffer) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > MAX_PHOTO_BYTES) {
    throw invalidPhoto('Choose a nonempty image no larger than 10 MiB.');
  }
  const extension = detectedExtension(bytes);
  try {
    const metadata = await sharp(bytes, decodeOptions).metadata();
    if (metadata.format !== (extension === 'jpg' ? 'jpeg' : extension))
      throw invalidPhoto('The image format is invalid.');
    if ((metadata.pages ?? 1) !== 1) throw invalidPhoto('Animated images are not supported.');
    if (
      !metadata.width ||
      !metadata.height ||
      metadata.width * metadata.height > MAX_PHOTO_PIXELS
    ) {
      throw invalidPhoto('Choose an image no larger than 50 million pixels.');
    }
    // A complete raw decode validates pixels, not just headers, before retaining the
    // original. Reuse the oriented pixels for both copies; no metadata is carried over.
    const decoded = await sharp(bytes, decodeOptions)
      .autoOrient()
      .timeout({ seconds: 20 })
      .raw()
      .toBuffer({ resolveWithObject: true });
    const raw = {
      width: decoded.info.width,
      height: decoded.info.height,
      channels: decoded.info.channels,
    };
    return { pixels: decoded.data, raw, extension };
  } catch (cause) {
    if (cause instanceof PlantError) throw cause;
    throw invalidPhoto(
      'The image could not be decoded safely. Check that it is complete and no larger than 50 million pixels.',
      cause,
    );
  }
}

async function displayPhoto(pixels: Buffer, raw: Raw) {
  return sharp(pixels, { raw })
    .resize({ width: 2560, height: 2560, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82 })
    .timeout({ seconds: 20 })
    .toBuffer();
}

async function thumbnailPhoto(pixels: Buffer, raw: Raw, crop: PhotoCrop) {
  return sharp(pixels, { raw })
    .extract(photoCropPixels(crop, raw))
    .resize({ width: 320, height: 320, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 78 })
    .timeout({ seconds: 20 })
    .toBuffer();
}

export async function processPlantPhoto(bytes: Buffer, selectedCrop?: PhotoCrop) {
  const { pixels, raw, extension } = await decodePhoto(bytes);
  const crop = selectedCrop ?? centredPhotoCrop(raw);
  photoCropPixels(crop, raw);
  const display = await displayPhoto(pixels, raw);
  const thumbnail = await thumbnailPhoto(pixels, raw, crop);
  return {
    original: bytes,
    display,
    thumbnail,
    extension,
    contentType: extension === 'jpg' ? 'image/jpeg' : `image/${extension}`,
    crop,
  };
}

export async function processPlantPhotoThumbnail(bytes: Buffer, crop: PhotoCrop) {
  const { pixels, raw } = await decodePhoto(bytes);
  return thumbnailPhoto(pixels, raw, crop);
}

export async function processPlantPhotoPreview(bytes: Buffer) {
  const { pixels, raw } = await decodePhoto(bytes);
  return { image: await displayPhoto(pixels, raw), width: raw.width, height: raw.height };
}

export async function readPlantPhotoDimensions(bytes: Buffer) {
  const { raw } = await decodePhoto(bytes);
  return { width: raw.width, height: raw.height };
}
