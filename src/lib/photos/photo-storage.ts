import 'server-only';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { z } from 'zod';
import {
  assertPhotoObjectKey,
  parsePhotoStorageKey,
  photoVariantKey,
  photoAssetPrefix,
  assertPhotoAssetObjectKey,
  type PhotoVariant,
  type PhotoNamespace,
  photoNamespaceSchema,
} from './photo-keys';
import { MAX_PHOTO_BYTES } from './photo-limits';

export type PhotoObject = { key: string; body: Buffer; contentType: string; uploadId: string };
export type PhotoObjectInfo = { uploadId?: string; etag?: string };
export type PhotoCleanupResult = 'removed' | 'absent' | 'not-owned';
// This is the one photo boundary, not a provider registry. Tests replace this module
// with an in-memory fake; production operations never accept an injected provider.
export type PhotoStorage = {
  bucket: string;
  upload: (object: PhotoObject) => Promise<void>;
  lookup: (key: string) => Promise<PhotoObjectInfo | null>;
  remove: (key: string, uploadId: string) => Promise<PhotoCleanupResult>;
  signVariant: (
    originalKey: string,
    variant: PhotoVariant,
    revision?: string | null,
  ) => Promise<string>;
  readOriginal: (key: string) => Promise<Buffer>;
  removePhotoAsset: (originalKey: string) => Promise<void>;
};

const configurationSchema = z.object({
  R2_ACCOUNT_ID: z
    .string()
    .trim()
    .regex(/^[a-f0-9]{32}$/i),
  R2_ACCESS_KEY_ID: z.string().trim().min(1),
  R2_SECRET_ACCESS_KEY: z.string().trim().min(1),
  R2_BUCKET_NAME: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/),
});

export function readR2Configuration(environment: Record<string, string | undefined> = process.env) {
  const parsed = configurationSchema.safeParse(environment);
  if (!parsed.success) {
    // Name the missing/invalid settings, never include submitted credential values.
    const fields = [...new Set(parsed.error.issues.map((issue) => issue.path.join('.')))];
    throw new Error(`Configure photo storage in your private environment: ${fields.join(', ')}.`);
  }
  return {
    endpoint: `https://${parsed.data.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    bucket: parsed.data.R2_BUCKET_NAME,
    credentials: {
      accessKeyId: parsed.data.R2_ACCESS_KEY_ID,
      secretAccessKey: parsed.data.R2_SECRET_ACCESS_KEY,
    },
  };
}

const stores: Partial<Record<PhotoNamespace, PhotoStorage>> = {};

export function getPhotoStorage(namespace: PhotoNamespace): PhotoStorage {
  photoNamespaceSchema.parse(namespace);
  // Even an accidentally unmocked test cannot reach a configured real account.
  if (process.env.NODE_ENV === 'test' || process.env.VITEST) {
    throw new Error('Real R2 access is disabled in automated tests. Use the photo storage fake.');
  }
  const cached = stores[namespace];
  if (cached) return cached;
  const config = readR2Configuration();
  const client = new S3Client({
    region: 'auto',
    endpoint: config.endpoint,
    credentials: config.credentials,
    maxAttempts: 1,
    requestHandler: { connectionTimeout: 5000, requestTimeout: 15000 },
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
  const bucket = config.bucket;
  const lookup = async (key: string): Promise<PhotoObjectInfo | null> => {
    assertPhotoObjectKey(namespace, key);
    try {
      const result = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }), {
        abortSignal: AbortSignal.timeout(20000),
      });
      return { uploadId: result.Metadata?.['upload-id'], etag: result.ETag };
    } catch (error) {
      if (
        error instanceof Error &&
        '$metadata' in error &&
        (error.$metadata as { httpStatusCode?: number } | undefined)?.httpStatusCode === 404
      )
        return null;
      throw error;
    }
  };
  const storage: PhotoStorage = {
    bucket,
    async upload(object) {
      assertPhotoObjectKey(namespace, object.key);
      z.uuid().parse(object.uploadId);
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: object.key,
          Body: object.body,
          ContentType: object.contentType,
          ContentLength: object.body.length,
          IfNoneMatch: '*',
          Metadata: { 'upload-id': object.uploadId },
          CacheControl: 'private, no-store',
        }),
        { abortSignal: AbortSignal.timeout(20000) },
      );
    },
    lookup,
    async removePhotoAsset(originalKey) {
      const prefix = photoAssetPrefix(namespace, originalKey);
      const deadline = AbortSignal.timeout(60000);
      const options = () => ({
        abortSignal: AbortSignal.any([deadline, AbortSignal.timeout(20000)]),
      });
      const keys = new Set<string>();
      const tokens = new Set<string>();
      let continuation: string | undefined;
      // Collect and validate before deleting. A malformed/outside key fails closed.
      // Bound work even if a corrupt listing repeats pages or an asset is enormous.
      for (let page = 0; ; page++) {
        if (page >= 10) throw new Error('Photo asset cleanup exceeded its listing limit.');
        const result = await client.send(
          new ListObjectsV2Command({
            Bucket: bucket,
            Prefix: prefix,
            MaxKeys: 1000,
            ContinuationToken: continuation,
          }),
          options(),
        );
        for (const item of result.Contents ?? []) {
          if (!item.Key) throw new Error('Photo asset listing contained an invalid key.');
          assertPhotoAssetObjectKey(namespace, originalKey, item.Key);
          keys.add(item.Key);
        }
        if (!result.IsTruncated) break;
        continuation = result.NextContinuationToken;
        if (!continuation || tokens.has(continuation))
          throw new Error('Photo asset listing could not be completed safely.');
        tokens.add(continuation);
      }
      for (const key of keys) {
        if (deadline.aborted) throw new Error('Photo asset cleanup timed out.');
        try {
          await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }), options());
        } catch {
          // Continue with this asset only. The final listing also resolves a lost
          // DELETE acknowledgement; raw provider errors never reach diagnostics.
        }
      }
      const remaining = await client.send(
        new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, MaxKeys: 1 }),
        options(),
      );
      if (remaining.IsTruncated || (remaining.Contents?.length ?? 0) > 0)
        throw new Error('Some objects remain in the deleted photo asset.');
    },
    async remove(key, uploadId) {
      z.uuid().parse(uploadId);
      const existing = await lookup(key);
      if (!existing) return 'absent';
      // A PUT can reach R2 even if its response is lost. Ownership metadata makes
      // cleanup safe for that case without deleting a pre-existing collision.
      if (existing.uploadId !== uploadId) return 'not-owned';
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }), {
        abortSignal: AbortSignal.timeout(20000),
      });
      return 'removed';
    },
    async readOriginal(key) {
      parsePhotoStorageKey(namespace, key);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20000);
      try {
        const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }), {
          abortSignal: controller.signal,
        });
        if (!result.Body) throw new Error('Photo original is unavailable.');
        const body = result.Body.transformToWebStream();
        const reader = body.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        const aborted = new Promise<never>((_, reject) => {
          if (controller.signal.aborted) reject(new Error('Original read timed out.'));
          else
            controller.signal.addEventListener(
              'abort',
              () => reject(new Error('Original read timed out.')),
              { once: true },
            );
        });
        void aborted.catch(() => {});
        try {
          if ((result.ContentLength ?? 0) > MAX_PHOTO_BYTES)
            throw new Error('Photo original exceeds the size limit.');
          while (true) {
            const { value, done } = await Promise.race([reader.read(), aborted]);
            if (done) break;
            size += value.byteLength;
            if (size > MAX_PHOTO_BYTES) throw new Error('Photo original exceeds the size limit.');
            chunks.push(value);
          }
          if (!size) throw new Error('Photo original is empty.');
          return Buffer.concat(chunks, size);
        } finally {
          void reader.cancel().catch(() => {});
        }
      } finally {
        clearTimeout(timer);
        controller.abort();
      }
    },
    signVariant(originalKey, variant, revision) {
      return getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: bucket,
          Key: photoVariantKey(namespace, originalKey, variant, revision),
          ResponseContentType: 'image/webp',
          ResponseCacheControl: 'private, no-store',
        }),
        { expiresIn: 300 },
      );
    },
  };
  stores[namespace] = storage;
  return storage;
}
