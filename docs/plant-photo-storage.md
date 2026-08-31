# Plant photo storage

## Decision and current checkpoint

Cloudflare R2 is the approved photo storage provider. Files live in a private bucket, while PostgreSQL holds PlantPhoto metadata only. A PostgreSQL partial unique index guarantees at most one primary photo per Plant. The separately approved square crop checkpoint adds crop metadata and a thumbnail revision; its current behaviour supersedes the original uncropped thumbnail design below where noted. See [thumbnail crops](plant-photo-crops.md).

The architecture and storage/data layer checkpoints are complete. The separately approved real R2 smoke test passed and its disposable object was removed without changing nursery data. Exact operation contracts and account setup are in [Plant photo data layer](plant-photo-data-layer.md). The current checkpoint, `feat: add plant photo gallery and list images`, connects the browser controls and private delivery described in [Plant photo browser workflow](plant-photo-browser-flow.md).

## Why R2

The application already has its PostgreSQL and Prisma foundation. R2 provides object storage without moving that database or tying the Next.js app to a particular hosting provider. Keeping ordinary files behind a small storage boundary makes a later storage move possible without changing Plant relationships.

Supabase Storage and Cloudinary were considered. Supabase offers a convenient storage platform, while Cloudinary provides a broader image transformation service. R2 was chosen because the first photo feature only needs private storage, controlled delivery and a small amount of image processing in the app. Current allowances and prices should be checked when the account is configured, rather than treated as permanent architecture guarantees.

Local filesystem storage is only a possible development option, not the production design or a second implementation required by this milestone. It must not become a reason to store local paths in PlantPhoto. Only the selected R2 integration will be built initially; tests will use a fake storage boundary and local fixtures.

## Files and metadata

One PlantPhoto record represents a photograph and its derived copies. Its existing fields remain id, plantId, storageKey, optional originalFilename, optional caption, optional takenAt, isPrimary, sortOrder, createdAt and updatedAt. No image bytes, permanent public URLs, expiring signed URLs or credentials belong in PostgreSQL.

The validated original is retained privately so later nursery work can use its original detail. Display remains the full photograph with its natural aspect ratio, in WebP with a longest side up to approximately 2560 pixels. New thumbnails use the selected square crop, up to 320 by 320 pixels. Processing avoids enlargement, applies the original orientation and removes EXIF/GPS metadata from both served derivatives. Originals may retain camera metadata and are not served by the gallery or list. Adjust Crop changes only the thumbnail.

The server will generate a new asset UUID and immutable storage keys for each upload. An example object layout is:

```text
plants/<plant UUID>/<asset UUID>/original.jpg
plants/<plant UUID>/<asset UUID>/display.webp
plants/<plant UUID>/<asset UUID>/thumbnails/<revision UUID>.webp
```

The original extension comes from the detected image format, not the supplied filename. PlantPhoto.storageKey identifies the original object. The storage boundary derives the known companion keys from that layout. Legacy records with a null derivativeRevision still use thumbnail.webp. These are storage objects, not separate PlantPhoto rows. Bucket names, endpoints and provider credentials belong in server configuration, outside the key.

Original filenames are metadata only. Keep a trimmed, length limited basename with path components and control characters removed. Never use a filename, ANT reference or browser supplied path to select an object key. Optional caption text is trimmed and blank becomes null. An unknown takenAt stays null; upload time and filesystem modification time must not be substituted for when the photo was taken. Any entered date/time must be parsed explicitly and handled consistently with the nursery timezone and existing UTC timestamp storage.

## Upload boundary and validation

The initial upload limits are:

| Setting                     | Approved behaviour                                    |
| --------------------------- | ----------------------------------------------------- |
| Accepted formats            | JPEG, PNG and static WebP                             |
| Maximum file size           | 10 MiB, or 10,485,760 bytes                           |
| Maximum decoded image size  | 50 MP, or 50,000,000 pixels                           |
| Files per submission        | One                                                   |
| HEIC and HEIF               | Deferred; explain that the user should export as JPEG |
| Other formats and animation | Rejected in the first implementation                  |

The browser can explain these limits before submission, but the server must enforce them. Check actual bytes and fully decode the image; the filename extension and supplied MIME type are not proof of a valid image. Reject malformed content, unsupported formats and animation. Apply decoded pixel limits and bounded processing time and resources as well as the compressed file limit.

The HTTP body must be bounded while receiving it, before parsing an unlimited multipart body into memory. Allow bounded multipart overhead in addition to the file limit, and separately check the file's actual size. Content-Length is only an early check, not a replacement for counting received bytes. Validate the Plant UUID and allowed metadata with the existing Zod boundary approach.

The upload form and endpoint must not accept caller supplied photo IDs, storage keys, primary flags, sort order, database timestamps or arbitrary Prisma operations. They will pass the file, allowed metadata and the existing expectedUpdatedAt concurrency token to a restricted Plant photo service. Reuse the small PlantError approach for expected failures and keep unexpected diagnostics on the server.

## Application boundaries

Routes and endpoint composition stay in src/app. Plant photo rules, validation, processing, queries and the small storage boundary stay in src/modules/plants. Database and provider credentials remain behind server only modules. No generic repository, upload framework or multiple provider implementations are needed.

The operations are uploadPlantPhoto and setPrimaryPlantPhoto, with small reads for the gallery, primary thumbnail and photo delivery. Exact signatures are recorded in the data layer notes. The upload endpoint handles the browser boundary; the service owns rules, storage coordination and the database transaction. Photo work stays outside createPlant and never allocates or resets an ANT reference.

Image processing runs in the Node server. Sharp is declared directly because application code imports it, alongside the R2 S3 SDK and signing package. There is no alternative provider or generic upload framework.

## Upload lifecycle

The service will validate the file, metadata, Plant and expectedUpdatedAt before attempting storage writes. It will decode the image and prepare the served derivatives, then upload the original and derivatives under the newly generated keys. Existing objects must not be overwritten.

After the objects are stored, start a short Read Committed database transaction. Lock the owning Plant with the same FOR NO KEY UPDATE approach used by editing and archiving. Recheck that it exists and that expectedUpdatedAt still matches. Assign gallery ordering and primary status, insert PlantPhoto, and advance Plant.updatedAt before committing. Do not hold the database lock open during image processing or R2 network operations.

A successful photo mutation must advance Plant.updatedAt to at least the previous timestamp plus one millisecond. This keeps existing edit and archive tokens meaningful, including for rapid or related only changes. Concurrent uploads and primary changes are serialised at the Plant row; stale state changing requests fail instead of overwriting newer work. No parentage advisory lock is needed because photo operations do not alter ancestry.

Only after the database transaction commits should the browser be told the photo was saved and refresh the gallery. A transport failure after commit does not prove the operation failed, so error guidance must ask the user to check the Plant before retrying. Ordinary duplicate click protection is included; durable request idempotency is not part of this first design.

## Failure handling and targeted cleanup

R2 and PostgreSQL cannot take part in one atomic transaction. Use targeted compensation for the exact objects belonging to an unsuccessful upload, not broad bucket cleanup.

| Outcome                                    | Required behaviour                                                                                                                                                                                          |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Validation or processing fails             | Return a useful error before creating objects or a PlantPhoto record.                                                                                                                                       |
| Storage upload fails partway through       | Do not create PlantPhoto. Attempt cleanup of the objects created by that upload, using its known generated keys.                                                                                            |
| Database transaction definitely rolls back | Attempt cleanup of that upload's new, unreferenced original and derivatives.                                                                                                                                |
| Database commit outcome is uncertain       | Do not blindly delete files. Resolve the outcome using the generated storage key after the transaction has settled; if the database cannot be checked reliably, retain the objects and log the uncertainty. |
| Targeted cleanup fails                     | Preserve the original failure and log the affected keys and cleanup outcome for later investigation. Do not hide one error behind the other.                                                                |
| Database commit succeeds                   | Preserve the metadata and all referenced objects. A later housekeeping or response failure must not undo the saved photo.                                                                                   |

Logs must identify the upload attempt, Plant, configured bucket, exact original and derivative keys, operation stage and cleanup results. They must not contain credentials, image bytes or signed URLs. This is operational diagnostic information, not a new nursery database table or background job system.

Successful uploads have no disposable staging object in this design: the original and both derivatives are intentionally retained. If later transport work introduces temporary objects, failure to remove a temporary object must not remove the saved PlantPhoto or its referenced files.

A process crash can still leave unreferenced objects. This limitation is accepted for the first implementation. Do not build an orphan scanner, reconciliation command, admin tool, scheduled sweep or automatic broad deletion. A future reconciliation tool needs its own design and approval if it becomes useful. Targeted removal of an unsuccessful upload's remnants is not user facing photo deletion.

## Primary photo and ordering

The first uploaded photo becomes primary automatically. Later uploads keep the selected primary. Assign sortOrder while the Plant is locked, appending after its current photos. Gallery reads should have a deterministic tie break for equal sortOrder values.

Choosing another primary must verify that the photo belongs to the target Plant, check expectedUpdatedAt under the Plant lock, clear the current primary and set the selected photo within the same transaction. Advance Plant.updatedAt when the selection changes. Choosing the already primary photo can return without an unnecessary write.

The approved PostgreSQL partial unique index will enforce uniqueness of plantId only for rows where isPrimary is true. Nonprimary photos remain unrestricted. This guarantees at most one primary; the service supplies the first primary and handles switching. It is not a requirement that every Plant have a photo.

The index is introduced in the new data layer migration, without editing either existing migration. The preflight inspection found zero photo rows in development and test, so there were no conflicting primaries to resolve. Future conflicting history must still be reviewed rather than silently rewritten. The index is documented and tested alongside the project's existing custom SQL. See [database migration notes](database-migrations.md).

The separately approved [photo deletion checkpoint](plant-photo-deletion.md) now adds explicit permanent deletion with confirmation. Primary replacement is atomic with metadata deletion, choosing the next deterministic photo or leaving no primary when none remain. Only after commit does targeted cleanup remove that photo's exact asset prefix, including the original and superseded thumbnails. Other nursery history remains preserved.

## Gallery, list and archived Plants

The UI checkpoint adds a Photos section to the existing detail page, with the primary image, a simple responsive thumbnail grid, captions and taken dates when recorded. A small Upload Photo form sits below the gallery. Other photos offer Set as Primary, and the current selection has a visible Primary label. It uses the existing nursery cards, spacing, keyboard access and error feedback.

Preserve entered metadata after validation failures where practical. File inputs cannot always be restored after a failed request; tell the user clearly when a file needs selecting again. Show an uploading state and prevent ordinary repeated submission. The approved square thumbnail selector supports new uploads and Adjust Crop. No advanced gallery, lightbox, general image editor or drag and drop ordering is planned.

The Plant list will retrieve only the primary photo information needed for its thumbnail, not the entire gallery. Existing ordering, active/archive separation and responsive behaviour stay unchanged. A Plant without a photo gets a neutral placeholder. An unavailable stored image should have a safe fallback rather than a broken image.

Archived Plants retain all photographs and may receive new photos or change their primary photo. This is consistent with the existing ability to edit historical records. Photo operations must preserve archivedAt, status, identity and all existing relationships. The archived form should make clear that adding a photograph does not restore the Plant. Sold and Deceased status do not prevent recording photographs either.

## Private delivery and local security

Keep the R2 bucket private, with no public bucket endpoint. Only processed display and thumbnail copies are delivered by the initial UI; retaining an original does not make it publicly accessible. The app will resolve a PlantPhoto and an allowed variant to a short lived signed read URL. It must not sign an arbitrary key, accept an arbitrary remote URL, or expose the original through a variant parameter.

A small application image endpoint can look up the photo and generate a fresh signed URL when needed, rather than storing expiring URLs in PostgreSQL. Signed URLs grant temporary access to anyone holding them; they are not user authentication and do not prevent someone retaining a downloaded image. Keep them out of logs and avoid shared caching of private delivery responses. See [R2 presigned URL documentation](https://developers.cloudflare.com/r2/api/s3/presigned-urls/).

Served copies are already resized, so private photo delivery should not depend on a shared Next.js image optimisation cache. Keep processing and delivery separate, with explicit allowed variants. The initial UI does not need an unrestricted transformation endpoint.

The app currently has no authentication. Continue binding development and local production commands to 127.0.0.1, and do not expose them through a public tunnel, network proxy or port forwarding. A private bucket does not secure a publicly reachable unauthenticated upload or signing endpoint.

Provider credentials must remain server only, outside Git and outside NEXT_PUBLIC environment variables. Restrict them to the intended bucket and required operations. Use separate development and production storage configuration with no fallback between them. Enforce trusted request origins and appropriate CSRF protection at the browser boundary; CORS and origin checks are not a substitute for authentication.

Before public deployment, add authentication and access checks to every upload, primary change, crop change, deletion, gallery read and image delivery operation. Also review HTTPS, upload quotas and rate limits, processing resources, secret management and diagnostics. Authentication is not being added in the photo milestone. Backups must cover both PostgreSQL metadata and R2 files; restoring the database alone will not restore the photographs.

## Hosting assumption

No production host has been selected. Keep the initial server side 10 MiB upload architecture on a Node server that supports the bounded request and processing requirements. R2 is the storage backend regardless of which host is chosen later.

At this decision point, Vercel documents a 4.5 MB function payload limit. That is smaller than the approved upload size; raising a Next.js setting cannot remove a hosting platform limit. A platform with that restriction would require a transport change, likely a private staged/direct presigned R2 upload followed by trusted server validation and processing. See [Vercel Functions limits](https://vercel.com/docs/functions/limitations).

Do not redesign this milestone around hypothetical Vercel deployment or implement staged uploads now. Revisit transport and recheck the host's current limits when hosting is selected. This would not change the decision to use R2 or to keep metadata in PostgreSQL.

## Testing and review boundaries

Use local image fixtures and a fake storage boundary for reproducible automated tests. Cover accepted metadata, invalid and spoofed file types, malformed images, oversized files and request bodies, decoded pixel limits, animation rejection, orientation, derivative dimensions and metadata removal. Key tests must cover generated uniqueness, filename independence and path traversal rejection.

Service tests must cover storage failure, partial upload cleanup, definite database rollback after upload, uncertain commit outcomes and failed cleanup logging. Verify that cleanup cannot remove another upload's files or files belonging to a committed record. There is no scanner to test in this milestone.

Use the existing guarded PostgreSQL test database and rolled back fixtures for metadata, ordering, the first primary, primary changes, the partial unique index, stale requests and archived Plant behaviour. Preserve the existing development data and ANT sequence. Component and query tests will cover the gallery, list thumbnail, no photos, unavailable images, pending states and safe errors, alongside the existing Add, Edit, List and Archive regressions.

Do not upload test images to the owner's real development storage or account without explicit approval. Any real provider check must be separately agreed with exact disposable objects and storage scope. No test may silently fall back from a fake or test configuration to real development or production storage.

## Delivery checkpoints

The architecture checkpoint, `docs: define plant photo storage architecture`, is complete and committed.

The completed checkpoint `feat: add plant photo storage and data layer` introduced the selected dependencies and storage configuration, processing and restricted operations, targeted failure cleanup, the new primary uniqueness migration and focused tests. Its migration was inspected before application. The owner separately approved the successful disposable real provider verification.

The current browser checkpoint is `feat: add plant photo gallery and list images`. It connects upload and primary selection to the detail page and adds the primary thumbnail to the responsive lists, with UI and workflow tests. No dependencies, schema changes or migrations are added. The owner will review and commit the work.

The subsequent square thumbnail crop checkpoint is documented in [thumbnail crops](plant-photo-crops.md). The owner has now also approved the separate [photo deletion checkpoint](plant-photo-deletion.md). A general reconciliation/admin tool, authentication, bulk uploads, advanced image editing, drag and drop sorting, Location CRUD, care, observations, breeding, pollen, seed batches, seedlings, sales and dashboard integration remain outside these checkpoints.
