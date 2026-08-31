# Plant photo browser workflow

This is the `feat: add plant photo gallery and list images` checkpoint. It connects the existing photo service to the Plant detail and list pages. There are no new dependencies, schema changes or migrations. The storage, processing, compensation and database rules remain in [Plant photo data layer](plant-photo-data-layer.md).

The subsequent approved thumbnail crop checkpoint extends this workflow with a shared selector, a read only upload preview, and Adjust Crop for saved photos. Its four nullable fields and new migration are separate from the original browser checkpoint. Crop metadata is now an allowed upload field, list queries also select derivativeRevision, and thumbnails use the saved square while the main display remains full. See [thumbnail crops](plant-photo-crops.md) for the current routes, limits, coordinate rules and failure behaviour.

## Uploading and viewing

The Photos section on `/plants/[plantId]` shows the primary display image above a responsive thumbnail grid. Each saved photo keeps its caption and taken time when recorded. The current selection is labelled Primary and other photos offer Set as Primary. The upload form accepts one file, an optional caption and an optional taken date and time. The later crop checkpoint adds Adjust Crop, and the separately approved [photo deletion checkpoint](plant-photo-deletion.md) adds Delete with confirmation. There is no lightbox or ordering control.

The file guidance is JPEG, PNG or static WebP, no more than 10 MiB and 50 megapixels. HEIC/HEIF is not supported. The browser accept setting is a convenience only. The existing service validates and decodes the actual bytes, applies orientation and produces the private original plus the display and thumbnail WebP copies.

Taken date and time uses the device's local timezone, stated beside the field. The browser converts this to an explicit UTC instant before submission, rejecting invalid dates and local times that do not exist during a clock change. During a repeated autumn hour, JavaScript uses the earlier occurrence. Exact historical timezone selection is not part of this small form; leave the time blank if it is unknown. Gallery dates are displayed in Europe/London, consistent with existing Plant dates. No time is inferred from EXIF, filenames or the upload date.

## Browser boundaries

| Route                                              | Purpose                                           |
| -------------------------------------------------- | ------------------------------------------------- |
| `POST /plants/[plantId]/photos`                    | Bounded multipart upload to `uploadPlantPhoto`    |
| `POST /plants/[plantId]/photos/[photoId]/primary`  | Small JSON request to `setPrimaryPlantPhoto`      |
| `GET /plants/[plantId]/photos/[photoId]/[variant]` | Private redirect for a known display or thumbnail |

Route files compose the request and delegate to `plant-photo-http.ts` in the Plant module. Both mutations require an Origin matching the request URL and reject an explicitly cross site request. They do not trust forwarded host headers. Upload reads count actual streamed bytes before multipart parsing, allowing 10 MiB plus 64 KiB for the form envelope. A declared length can reject an oversized request early but cannot bypass the actual limit. Receiving the body is limited to 30 seconds. The individual file still has the 10 MiB limit, with decode limits enforced by the service. Primary JSON bodies are limited to 1 KiB.

NextRequest rewrites `127.0.0.1` to `localhost` internally, even when the browser uses the documented IP address. For HTTP loopback requests only, the boundary uses the original Host to distinguish those two addresses, requiring the same port as the request URL. Origin must exactly match that address. Arbitrary Host values, other loopback IPs, different ports, different schemes and cross origin alias requests remain rejected. Forwarded headers cannot grant access. Regression tests use the real NextRequest class so this framework behaviour is exercised, not hidden by plain Request mocks.

Only image, caption, takenAt and expectedUpdatedAt are accepted in multipart data. Duplicate and unsupported fields are rejected. The original filename comes from the file metadata and is sanitised by the existing service. The primary request accepts only expectedUpdatedAt; the selected photo UUID comes from its route. Neither route accepts storage keys, primary flags, ordering, new photo IDs, stored timestamps or Prisma operations.

A route handler is used for uploads so the file size allowance does not require raising the global Server Action limit. No new multipart framework is installed. These application limits cannot override a production host's smaller payload limit; the hosting caveat in [Plant photo storage](plant-photo-storage.md#hosting-assumption) still applies. No host or alternative upload transport is introduced here.

## Saving, errors and concurrency

The upload form calls the route with FormData. The route calls the existing service, which checks the Plant token, processes the file, uploads the three objects and commits metadata in its short locked transaction. A successful response includes only a safe message and the new Plant timestamp, not the storage key or full Prisma record. The page refreshes only after confirmed success.

Upload and primary controls share a pending guard. Controls are disabled during a mutation and show Uploading Photo or Saving feedback. This prevents ordinary repeated clicks, not duplicate requests across tabs or retries after a lost response. The service's timestamp check remains the final concurrency protection.

The form keeps its original token alongside entered text; another server render cannot silently refresh that token. Its own confirmed mutation replaces the token. An unsuccessful upload retains caption and taken time but clears the file input and explicitly asks for reselection. Primary selection does not clear an unsaved upload draft. Expected errors appear in a focused accessible summary, with links to relevant field errors. A stale response asks the user to review their text and reload. Unexpected or lost responses ask them to check saved photos before retrying, since the operation might already have committed. Reloading clears the unsaved form and is labelled accordingly.

Storage failures still use the existing targeted compensation. HTTP responses never serialize error causes, credentials or provider diagnostics, and the boundary does not log raw R2 errors or signed URLs.

## Private images and lists

The delivery route delegates to the existing read helper, which validates UUIDs and the variant, looks up the photo within its Plant, verifies storage ownership and signs the approved derivative for five minutes. Originals, arbitrary keys and arbitrary remote URLs are not accepted. Redirect responses are private and no-store, with no-referrer. Signed URLs are not persisted in page data or PostgreSQL.

The browser uses ordinary images because the copies are already resized. They do not pass through the shared Next image optimisation cache. A missing photo or failed delivery shows a neutral placeholder without hiding Plant details, captions or actions. Refreshing the page can retry an unavailable image.

Active and archived list queries fetch only the primary photo ID alongside the existing list fields. They do not load whole galleries or contact R2. Both lists use the thumbnail route and keep their existing ordering and desktop columns/mobile cards. A Plant without a primary has a No photo placeholder.

Archived Plants keep their galleries and can upload or choose a primary. The page explains that these actions do not restore the Plant or change its status. No photo operation allocates ANT references or changes archive state.

## Local safety and review

The app is still unauthenticated and must stay on loopback. Origin checks are CSRF protection, not authentication; they do not make a public deployment safe. Before deployment, review authentication, ownership checks, proxy origins, request quotas, rate limits and processing resources. Private delivery also needs access control at that point.

Automated component and request tests use mocks, and PostgreSQL workflow tests use the guarded test database, rolled back fixtures and fake storage. Coverage includes successful uploads, gallery/primary/list reads, archived Plants, stale state, rejected fields, streamed size limits, pending states, retained text and unavailable images. Tests never use the real R2 account. There is no special browser fixture route or new browser testing framework.

For the owner's final real photo review, start the app, open a saved Plant and upload one intended nursery photograph through Photos. Confirm the success message, primary image, thumbnail, caption/time and the thumbnail on `/plants`. A second intended photograph can verify Set as Primary. These are real saved photographs, not disposable test fixtures. Do not upload or delete them on the owner's behalf without approval. Safe manual layout review can use existing records, navigation, missing file validation, and opening then cancelling deletion without saving anything.
