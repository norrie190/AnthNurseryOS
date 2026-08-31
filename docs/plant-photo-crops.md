# Plant thumbnail crops

## Scope and image behaviour

The square crop controls thumbnails on Plant lists and gallery tiles. The main gallery still shows the full photograph in its natural proportions. This checkpoint adds no photo deletion, editing history, cleanup scanner, filters, rotation editor, other aspect ratios or new dependencies.

The original stays byte for byte unchanged in private R2. PlantPhoto.storageKey remains its immutable key. Display is the full oriented WebP, up to 2560 pixels on its longest side. Thumbnail is the selected square, up to 320 by 320 pixels. Neither derivative is enlarged and camera metadata is removed. Adjust Crop generates only a new thumbnail from the retained original; it never writes display.webp.

## Coordinates and persistence

PlantPhoto adds nullable cropX, cropY and cropSize as Prisma Float with PostgreSQL double precision, plus nullable derivativeRevision as UUID. All four values are null for legacy photos or populated for a saved crop. The new migration and its SQL checks are described in [database migrations](database-migrations.md). There is no backfill.

Coordinates refer to the original after Sharp autoOrient, including mirrored EXIF orientations. cropX is left divided by oriented width; cropY is top divided by oriented height; cropSize is square side divided by the shorter oriented side. The default is the largest centred square. For a 4000 by 6000 image this is x = 0, y = 1/6, size = 1, producing a 4000 pixel square at left 0, top 1000.

The service requires finite values, 0 <= x,y < 1 and 0 < size <= 1. It rejects rectangles outside the decoded image. Pixel conversion rounds side, left and top deterministically, with a minimum one pixel square and a final edge rounding clamp. A 0.0000001 pixel tolerance handles arithmetic noise only; it does not accept genuinely misplaced crops. UI dragging deliberately stops at the edges, independently of server validation. UI size controls range from 1 to 100 percent.

## Storage and delivery

New uploads use:

```text
plants/<plant UUID>/<asset UUID>/original.<detected extension>
plants/<plant UUID>/<asset UUID>/display.webp
plants/<plant UUID>/<asset UUID>/thumbnails/<revision UUID>.webp
```

derivativeRevision versions only the thumbnail. A null revision resolves to the legacy thumbnail.webp in the asset folder. The known display path never depends on the revision. Asset and revision UUIDs come from the server, never the filename or request. Delivery resolves the active revision from PostgreSQL; the browser URL's v marker only prompts an image refresh and cannot select a storage path. Private signing remains restricted to display and thumbnail.

Successful superseded thumbnails remain in R2 while the photo exists. This avoids interrupting an already issued signed read, at the cost of one small retained image per adjustment. The separately approved [photo deletion checkpoint](plant-photo-deletion.md) removes those revisions along with the original and display when the owner explicitly deletes that photo. There is no crop history UI or automatic bucket sweep.

## Preview and browser flow

The shared selector displays the full photograph, shades the outside area and offers a movable square with four corner handles. Mouse and touch use pointer capture. Arrow keys move the square; Shift makes a larger step. Resize handles also accept arrows, and a labelled size slider provides an alternative. Reset to centre, Save Crop and Cancel keep the workflow small.

For new uploads, selecting a file first sends it to POST /plants/[plantId]/photos/preview. This bounded, same origin request checks the Plant token and runs the same Sharp validation/orientation pipeline. It returns a metadata free WebP preview and the full oriented dimensions, but writes nothing to R2 or PostgreSQL. This extra preview transfer avoids relying on different browser interpretations of JPEG orientation. Upload then sends the unchanged file, selected crop and existing allowed fields. A missing crop at the service boundary uses the centred default; every successful new upload stores the effective crop and a revision.

For existing photos, GET /plants/[plantId]/photos/[photoId]/crop resolves the owned original, reads it with a byte limit and timeout, and returns oriented dimensions and saved crop metadata only. The editor image itself uses the existing full display derivative. The preview is laid out using the original oriented proportions, not rounded derivative dimensions. No original bytes or original signed URL reach the browser. Opening or cancelling the editor makes no saved changes.

POST on the same crop route sends only crop and expectedUpdatedAt to updatePlantPhotoCrop. Successful saves refresh the thumbnail URL immediately and refresh server data for list navigation. Main display URLs do not change. Failed saves retain the proposed existing crop and original token; stale requests do not silently adopt a newer token. File selection during a new upload may need repeating after failure, as explained by the existing form feedback.

## Service and transaction

```typescript
updatePlantPhotoCrop(plantId, photoId, {
  crop: { x, y, size },
  expectedUpdatedAt,
});
// Returns { photo, plantUpdatedAt, changed }
```

The strict input rejects keys, revisions, identity, timestamps, primary flags, ordering, caption changes and arbitrary Prisma operations. The service checks Plant/photo ownership and the Plant token before reading or processing the original. It uploads one fresh thumbnail before beginning the short Read Committed transaction. That transaction locks the Plant with FOR NO KEY UPDATE, rechecks ownership and token, switches all four crop fields, and advances Plant.updatedAt to at least its previous value plus one millisecond. Photo.updatedAt also advances. No database lock spans Sharp or R2 work.

An identical saved crop with a current token is checked again under lock and returns changed false without storage access or writes. A legacy photo has no applied square crop, so saving its centred default is a real change. Crop changes preserve primary selection, sortOrder, caption, takenAt, reference, status, archivedAt and all other nursery data. Archived Plants remain eligible.

## Failure recovery

Processing or original read failure writes nothing. A failed thumbnail PUT, including a lost acknowledgement, or a definite database rollback triggers targeted cleanup of only the attempted revision. Existing upload ownership checks apply. The original, display, previous active thumbnail and other revisions are never crop cleanup targets.

When the commit outcome is uncertain, a fresh transaction obtains the Plant lock before inspecting the current revision. The attempted revision means committed; the previous revision means the failed attempt can be cleaned up. A different revision could have superseded a committed save, so it is retained and the uncertainty logged. Database unavailability also retains the new object. Cleanup failure preserves the initial error and reports exact affected keys without provider secrets or signed URLs. No recovery path performs broad deletion.

## Verification and manual review

Automated tests use synthetic local images, fake storage and rolled back fixtures in the guarded test PostgreSQL database. Coverage includes all eight EXIF orientations, pixel selection, preview coordinate mapping, display preservation, square sizing, legacy delivery, metadata checks, stale tokens, no-op behaviour, SQL rollback, targeted cleanup and uncertain commits. Selector and browser boundary tests cover pointer types, keyboard controls, pending states, reset/cancel, retained selections and refresh markers.

Real crop saves are reserved for the owner's manual review. Open the existing Plant, choose Adjust Crop, position the square around the plant rather than the black filler, and first Cancel to check that nothing changes. Reopen, choose the crop and Save Crop. Confirm the gallery tile and /plants thumbnail change, the main photograph stays full size, and reopening the editor restores the selection. A new photo upload can be checked separately when the owner intends to retain another real photograph. Do not create duplicate real photos solely as automated fixtures.

## Files in this checkpoint

The working tree already contained the gallery/list browser checkpoint when crop work started. That work is preserved. The crop changes touch these files:

| Area             | Files                                                                                                                                                                                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Schema           | prisma/schema.prisma; prisma/migrations/20260831230000_add_plant_photo_thumbnail_crop/migration.sql                                                                                                                                                     |
| Shared mechanics | src/lib/photos/photo-crop.ts; photo-processing.ts; photo-limits.ts; photo-keys.ts; photo-storage.ts; photo-error.ts                                                                                                                                     |
| Plant wrappers   | src/modules/plants/plant-photo-crop.ts; plant-photo-keys.ts; plant-photo-processing.ts; plant-photo-storage.ts; plant-photo-errors.ts                                                                                                                   |
| Photo services   | src/modules/plants/plant-photo-input.ts; plant-photo-service.ts; plant-photo-queries.ts                                                                                                                                                                 |
| Browser boundary | src/modules/plants/plant-photo-http.ts; plant-photo-browser.ts                                                                                                                                                                                          |
| Routes           | src/app/plants/[plantId]/photos/preview/route.ts; src/app/plants/[plantId]/photos/[photoId]/crop/route.ts; src/app/plants/[plantId]/page.tsx                                                                                                            |
| Selector         | src/components/photos/photo-crop-selector.tsx; photo-crop-selector.module.css; src/modules/plants/components/plant-photo-crop-selector.tsx; plant-photo-crop-selector.test.tsx                                                                          |
| Gallery/list     | src/modules/plants/components/plant-photos.tsx; plant-photos.module.css; plant-photos.test.tsx; plant-list.tsx; plant-list.test.tsx; src/modules/plants/plant-queries.ts                                                                                |
| Tests            | tests/unit/shared-photo-keys.test.ts; shared-photo-processing.test.ts; plant-photo-crop.test.ts; plant-photo-processing.test.ts; plant-photo-service.test.ts; plant-photo-storage.test.ts; plant-photo-http.test.ts; tests/database/plant-photo.test.ts |
| Documentation    | README.md; docs/architecture.md; database-migrations.md; projectspec.md; mvp-roadmap.md; plant-data-model.md; plant-photo-storage.md; plant-photo-data-layer.md; plant-photo-browser-flow.md; plant-photo-crops.md                                      |

Other already pending browser files are the upload, primary and variant routes, PlantPhotoImage, PlantDetail and its page tests, list styling, list page tests, browser contract tests and Plant browser database tests. They are not unrelated new crop work. No dependency manifest, environment file or previous migration is changed by cropping.
