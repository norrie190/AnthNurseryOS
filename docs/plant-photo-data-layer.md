# Plant photo data layer

## Scope

This records the completed `feat: add plant photo storage and data layer` checkpoint. The approved design remains in [Plant photo storage](plant-photo-storage.md). This layer adds image validation and processing, a private R2 boundary, metadata operations, photo reads and the primary uniqueness migration. The separately approved real provider smoke test passed, with its disposable object removed and nursery data unchanged. Routes and browser controls are documented separately in [Plant photo browser workflow](plant-photo-browser-flow.md).

The direct dependencies are `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` at 3.1121.0, and `sharp` at 0.35.4. These versions support the project's Node 24 runtime. Sharp is declared directly because the application imports it. No upload framework or alternative storage provider is installed.

## Operations

The subsequent square thumbnail crop checkpoint extends upload with optional `crop: { x, y, size }`, adds `updatePlantPhotoCrop`, and introduces orientation safe previews and a bounded original read. New uploads store the selected or centred crop. Display remains full and unchanged by crop adjustments; thumbnails resolve through derivativeRevision with a legacy path fallback. The original lifecycle below still applies to upload, while revision specific crop recovery is documented in [thumbnail crops](plant-photo-crops.md).

The server only operations live in `src/modules/plants/plant-photo-service.ts`:

```typescript
type UploadPlantPhotoInput = {
  image: Uint8Array; // Buffer is accepted too; not a filesystem path or remote URL
  originalFilename?: string | null;
  caption?: string | null;
  takenAt?: string | null; // ISO instant with milliseconds and Z or an explicit offset
  expectedUpdatedAt: string; // Existing Plant.updatedAt as an ISO UTC string
  crop?: { x: number; y: number; size: number }; // Oriented normalised square; centred if omitted
};

uploadPlantPhoto(plantId, input);
// Returns { photo: PlantPhoto, plantUpdatedAt: Date }

setPrimaryPlantPhoto(plantId, {
  photoId,
  expectedUpdatedAt,
});
// Returns { photo: PlantPhoto, plantUpdatedAt: Date, changed: boolean }
```

Both inputs are strict. Identity, keys, primary flags, ordering, stored timestamps and arbitrary Prisma operations are rejected. The owning Plant UUID is a separate argument. The service copies the bounded input bytes before awaiting other work so a caller cannot change the original after validation. Blank caption and filename become null; caption is limited to 2000 characters. Filename input is limited to 4096 characters and its cleaned basename to 255 Unicode characters. No filename contributes to an object key.

An omitted takenAt stays null. The service accepts an explicit instant and stores it as UTC, not a guessed date from the filename, EXIF or upload time. The browser now interprets the entered time in the device timezone and labels that choice. IDs and concurrency tokens are validated before database access. Expected validation, missing records, stale state and constraint conflicts reuse PlantError. Unexpected processing diagnostics remain in the error cause; database and storage failures remain distinguishable from expected Plant errors. HTTP boundaries show safe messages rather than serialize unexpected errors or their causes.

The later [photo deletion checkpoint](plant-photo-deletion.md) adds `deletePlantPhoto(plantId, photoId, { expectedUpdatedAt, confirmed: true })`. It commits metadata deletion, primary replacement and Plant timestamp advancement before targeted storage cleanup. Its separate `removePhotoAsset` boundary lists only a validated known asset prefix and removes all its variants and crop revisions, rather than using the upload attempt ownership check. Cleanup failure returns a warning without recreating metadata. No schema, configuration or dependency change is needed.

## Processing

The file byte limit is 10,485,760 and the decoded pixel limit is 50,000,000. The service accepts bytes only. The browser milestone adds a streamed request limit before multipart parsing; its separate transport limits are recorded in the browser workflow document.

Signature checks admit only JPEG, PNG and WebP to the decoder. Sharp then checks the format and dimensions and fully decodes the pixels with warnings treated as errors. PNG animation control chunks and WebP animation flags/chunks are explicitly rejected, including when a decoder would otherwise expose just the first frame. HEIC/HEIF, GIF, SVG, TIFF, RAW and malformed content are rejected. Filename and browser MIME type are not validation evidence; MIME type is not part of this service input.

The original bytes are retained unchanged. Processing applies EXIF orientation, then uses the decoded pixels to generate display and thumbnail WebP copies. The display fits within 2560 by 2560, the thumbnail within 320 by 320. Both preserve proportions and never enlarge. Quality is 82 for display and 78 for thumbnail. EXIF, GPS, XMP and ICC metadata are not copied to the served derivatives.

Each decode or encoding pipeline has a 20 second processing timeout. The derivatives are encoded sequentially rather than keeping two large pipelines active at once. Full validation can require roughly 200 MB of raw pixels for a 50 MP RGBA input, plus codec overhead and copies. This is a bounded single image operation, not a global worker queue. Host sizing and request rate limits still need review before public deployment.

## Storage and delivery

The only production storage implementation is in `plant-photo-storage.ts`. Configuration is read lazily, so ordinary Plant operations and production builds do not require R2 credentials. Missing or invalid configuration names the settings to fix without printing their values. There is no default AWS credential chain, public bucket URL or fallback account.

The server generates separate asset and upload UUIDs. Keys follow the approved `plants/<plant UUID>/<asset UUID>/` layout. PlantPhoto.storageKey holds `original.jpg`, `original.png` or `original.webp`, based on detected format. The companion keys end in `display.webp` and `thumbnail.webp`. Helpers validate the exact layout and UUIDs before deriving or accessing companions.

PUT uses `If-None-Match: *` so an existing object is not overwritten. Each object has an `upload-id` metadata value belonging to this attempt. Targeted removal first checks ownership with HEAD; it will not delete an object owned by a different upload. R2 requests have bounded timeouts and automatic retries are disabled, keeping uncertain writes explicit. The SDK uses the R2 `auto` region and only required checksum behaviour. These choices follow [R2 S3 compatibility](https://developers.cloudflare.com/r2/api/s3/api/).

`getPlantPhotoGallery(plantId)` returns metadata ordered by sortOrder, then createdAt, then id. `getPrimaryPlantPhoto(plantId)` returns the primary metadata or null. These reads include archived Plants, omit storage keys and do not contact R2. The browser checkpoint separately extends the list queries with just the primary photo ID.

`getPlantPhotoReadUrl(plantId, photoId, variant)` finds a photo belonging to the Plant, verifies its stored key belongs to the same Plant, and returns `{ url, expiresInSeconds: 300 }`. Only `display` and `thumbnail` are allowed. Arbitrary keys, URLs and original delivery are not public operation inputs. The low level signing helper remains server only. Signed reads specify WebP and private, no-store caching. Do not persist or log these URLs; anyone with one can access the derivative until it expires. The browser checkpoint uses this helper in its private delivery redirect.

## Transactions and recovery

Upload first checks the Plant and token without a row lock, prepares the images, then uploads the three objects. Only afterwards does a short Read Committed transaction lock the Plant with FOR NO KEY UPDATE. It rechecks the token, appends ordering, inserts metadata and advances Plant.updatedAt. No database lock is held during decoding, processing or R2 calls.

The first photo gets sortOrder 0 and isPrimary true. Subsequent photos append after the maximum sortOrder and do not replace the selected primary. The PostgreSQL integer ordering limit is checked before insertion. Primary selection verifies ownership under the same Plant lock, clears the old selection and sets the new one atomically. Selecting the already primary photo with a current token returns changed false. Stale requests fail even for that selection. All actual mutations set Plant.updatedAt to at least its previous value plus one millisecond.

Archived Plants can upload and select photos. Neither operation changes archive state, status, reference, Location, parentage, purchase or the ANT sequence. Existing Add, Edit, List and Archive operations are unchanged.

On partial storage failure, cleanup includes each attempted key, even one whose PUT acknowledgement was lost. HEAD ownership checks keep that safe. A definite transaction failure cleans this attempt's objects after rollback. Cleanup reports removed, absent, not-owned or cleanup-failed outcomes, with the exact keys, upload identifier, Plant, bucket and stage. It preserves the original failure and never logs raw provider errors or signed URLs.

If the transaction callback completed but the commit acknowledgement failed, the outcome is uncertain. A fresh transaction obtains the same Plant lock, waiting for the original transaction to settle, then looks up the generated original key. A committed photo is returned and its objects retained. Confirmed absence allows cleanup. If that check fails or times out, all objects are retained and the uncertainty is logged with their keys. The caller receives an unexpected error with the original cause and guidance to check the Plant before retrying. No blind deletion, scanner, scheduled task or reconciliation framework is introduced. A process crash can still leave an orphan, as accepted in the design.

## Database migration

`20260831113000_add_primary_plant_photo_index` adds one partial unique index. There are no Prisma field changes and no edits to previous migrations. The preflight inspection found zero PlantPhoto rows in both local databases, so there was no history to resolve. Development had one existing Plant; it was not altered. The reviewed SQL and preservation rules are in [database migration notes](database-migrations.md).

## Tests

Local synthetic image fixtures are generated from recipes in `tests/fixtures/plant-photo-images.ts`; no nursery images are copied or uploaded. Unit tests mock the storage module with a small memory fake. Adapter tests mock the SDK itself, including signing. The real R2 factory refuses to run when NODE_ENV is test or VITEST is set, even if real credentials happen to be present. Tests do not fall back to a real account.

Image and unit coverage checks formats, corrupt and oversized content, animation, excessive dimensions, orientation, metadata removal, safe keys, strict input, storage requests, cleanup ownership, partial failures and uncertain commits. Database coverage uses the existing guarded PostgreSQL test URL, real Prisma queries and operation savepoints inside fixture transactions that always roll back. Temporary failure triggers also roll back. Tests cover the installed index, ordering, primary changes, stale tokens, archived history, safe reads and transaction failures. The photo database tests assert that their fixture counts and ANT sequence remain unchanged.

## Configure a real development bucket only when ready

The owner's development bucket has passed the separately approved disposable smoke test. The instructions below remain for a fresh setup. Setting up another account does not authorise test uploads. Do not paste secret keys into chat.

1. Open the Cloudflare dashboard and activate R2 if needed. Check the account's current charges and allowances before agreeing to billing. Create a dedicated Standard bucket named, for example, `anth-nursery-os-dev-photos`. Use the default jurisdiction for the endpoint configured here. Keep public access disabled: no r2.dev access and no public custom domain. Do not share the production bucket. See [creating R2 buckets](https://developers.cloudflare.com/r2/buckets/create-buckets/).
2. Create R2 S3 credentials with Object Read & Write permission, scoped only to that development bucket. The runtime does not need bucket administration. This permission supports PUT, HEAD, GET/signing and targeted DELETE. Record the account ID, Access Key ID and Secret Access Key securely. These are S3 credentials, not a Cloudflare global API key. See [Cloudflare's S3 setup](https://developers.cloudflare.com/r2/get-started/s3/).
3. Add the following settings to the ignored `.env` in the project root. Leave database settings as they are. Do not replace `.env` wholesale or change `.env.example` to contain real values. Restart the local server after changing settings.

```dotenv
R2_ACCOUNT_ID="your_account_id"
R2_ACCESS_KEY_ID="your_r2_access_key_id"
R2_SECRET_ACCESS_KEY="your_r2_secret_access_key"
R2_BUCKET_NAME="anth-nursery-os-dev-photos"
```

The derived endpoint is `https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com`. No browser CORS upload policy or public URL is needed for this server side design. Keep the unauthenticated app on 127.0.0.1. Before any public deployment it still needs authentication, access checks, a review of proxy/origin configuration, resource limits and a backup plan for both metadata and objects. The local browser boundary now requires matching origins for mutations.

For an approved real smoke test, the proposed disposable object is a synthetic 320 by 240 WebP at `plants/<new disposable UUID>/<new asset UUID>/thumbnail.webp`. These UUIDs would be generated and the exact key shown before the write; they do not correspond to a saved Plant or consume an ANT reference. The test would PUT this single object, HEAD it, sign and read that thumbnail, verify its decoded dimensions, then remove only that object using the matching upload identifier and confirm HEAD returns absent. No PlantPhoto row is needed, and no nursery photo is involved. If cleanup fails, report the exact bucket and key for targeted manual removal, never sweep a prefix or bucket. Wait for the owner's approval before this write.
