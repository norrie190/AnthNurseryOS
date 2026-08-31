# Plant photo deletion

This checkpoint adds permanent deletion of an explicitly selected photo. It is an intentional exception to retaining nursery history: Plant records, parentage, purchases, Locations and other relationships are not deleted. There is no schema change, migration or new dependency.

## Browser and service

Each saved gallery photo offers Delete. An inline confirmation identifies the photo and explains that its original and all copies will be permanently removed and cannot be recovered through the app. Cancel receives focus first; Escape also cancels. Pending deletion disables photo mutations and repeated clicks. Archived Plants have the same controls without being restored.

`DELETE /plants/[plantId]/photos/[photoId]` accepts only `expectedUpdatedAt` and `confirmed: true`. The route uses the existing same origin check, a 1 KiB JSON limit and safe error mapping. Neither keys nor prefixes are browser inputs. It calls:

```typescript
deletePlantPhoto(plantId, photoId, {
  expectedUpdatedAt,
  confirmed: true,
});
// Returns { deletedPhotoId, primaryPhotoId, plantUpdatedAt, cleanupPending }
```

The service uses the same short Read Committed transaction and Plant row lock as other photo mutations. It checks the token under lock, verifies the photo belongs to this Plant, validates its original storage key and rejects any other metadata record sharing the asset prefix. It then deletes just that PlantPhoto row. Deleting a primary promotes the remaining photo with the lowest sortOrder, then earliest createdAt, then lowest UUID. Deleting a nonprimary leaves the existing primary unchanged. Deleting the last photo leaves none.

The transaction advances Plant.updatedAt to at least its previous value plus one millisecond. It preserves Plant status, archive date, identity, reference, notes, Location and all other relationships. It does not allocate an ANT number or renumber remaining photos. A missing photo returns Not Found; a repeated delete cannot trigger another storage cleanup. Stale requests fail without removing anything.

Successful responses remove the photo from the local gallery immediately, show the replacement primary and refresh server data. Existing dynamic list reads then show the new primary or the neutral placeholder. Unsaved upload text stays intact. Validation, stale state and uncertain failures retain the confirmation and give safe feedback rather than silently retrying.

## Targeted storage cleanup

Database consistency comes first. Only after a confirmed commit does the server call `removePhotoAsset(originalKey)`. No database lock is held during R2 requests. The helper derives `plants/<Plant UUID>/<asset UUID>/` from the validated saved original key, including the trailing slash. It lists only that exact prefix and follows continuation tokens to find the original, display.webp, legacy thumbnail.webp and every thumbnails/<revision UUID>.webp, including superseded crop revisions.

Every listed key is checked for the exact prefix and approved photo key layout before any object is deleted. Missing, malformed or foreign keys stop cleanup. The helper deletes exact keys individually, continues past individual request failures, then checks the same prefix for remaining objects. A lost DELETE acknowledgement can therefore be resolved by confirmed absence. Empty assets are harmless. It never lists the bucket root or another Plant/photo folder.

Work is bounded to ten pages of up to 1000 keys and a 60 second total cleanup deadline, with the existing 20 second request limits. Exceeding a limit or failing to list/verify is a cleanup failure, not permission to broaden the target. There is no scanner, scheduler, retry queue, bulk action or general cleanup framework. The existing bucket scoped Object Read & Write credentials must permit object listing as well as reads and writes; no bucket administration or new environment values are needed.

## Failure behaviour

An ordinary database rollback leaves the photo and primary selection intact and performs no storage calls. If a transaction callback completed but its commit acknowledgement is uncertain, a fresh transaction takes the same Plant lock and checks for the photo ID or any metadata still referring to its asset prefix. Confirmed absence permits cleanup; a remaining record does not. If the database cannot resolve the outcome, files are retained and the exact validated prefix is logged for review. The browser is asked to reload before trying again.

After a committed deletion, failed R2 cleanup does not recreate metadata or undo primary promotion. The response remains a confirmed database success with `cleanupPending: true`. The gallery refreshes and displays a warning that files may remain. Server diagnostics record the Plant ID, photo ID and exact validated asset prefix, but not credentials, signed URLs or raw provider errors. Keep those diagnostics for any later, explicitly scoped manual cleanup. The UI does not offer a blind retry using a now deleted metadata record.

A process crash after commit can still leave objects without delivering a warning. An already running crop may also finish uploading after the cleanup listing; its final Plant/token/photo check then fails and its existing compensation removes only its attempted revision. If that process also crashes, an orphan can remain. This is the accepted limit of targeted cleanup without a durable job table or scanner. Superseded successful crop revisions remain stored while a photo exists, but explicit photo deletion now removes them with that asset.

Deletion cannot retract copies someone already downloaded or stored outside R2. The private delivery route stops issuing URLs once metadata is gone. Already issued URLs stop reading successfully once their objects are removed. If cleanup fails, a previously issued URL may work until its short expiry or object removal.

## Security and verification

The app remains local and unauthenticated. Bind it to loopback; matching Origin is not authentication. Public deployment must protect deletion with authentication and access checks alongside every other photo operation.

Tests use the fake storage boundary and rolled back fixtures in the guarded PostgreSQL test database. They cover deletion and primary replacement, archived Plants, preserved nursery relationships, stale and missing records, strict inputs, database rollback, shared asset conflicts, uncertain commits and cleanup failures. Mocked SDK tests cover exact prefix pagination, legacy and revised thumbnails, missing objects, unsafe keys and incomplete listings. Component and route tests cover confirmation, cancellation, focus, pending state, duplicate prevention, safe errors, retained text and gallery refresh.

No real development photo is deleted for automated or manual verification. For a safe browser review, open a saved Plant, choose Delete, read the warning and Cancel. Confirm the photograph is still visible. Only confirm deletion yourself when you genuinely want to remove that photograph permanently.
