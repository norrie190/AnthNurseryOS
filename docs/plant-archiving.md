# Archiving and restoring Plants

## Scope

Archiving removes a Plant from the normal collection view, without deleting it or changing its biological status. A Growing Plant may be archived and a Deceased Plant may remain active. The record, purchase, parentage, Location, photo metadata and links from offspring all stay intact. There are no schema changes, migrations, new dependencies or delete operations.

The active collection remains `/plants`. A secondary View Archived link opens `/plants/archived`. Both lists use the same desktop columns and mobile cards, readable statuses and optional name and Location fallbacks. The active empty state says No active Plants because records may still exist in the archive.

## Service contract

```ts
archivePlant(plantId, { expectedUpdatedAt });
restorePlant(plantId, { expectedUpdatedAt });
// Both return Promise<{ plant: Plant; changed: boolean }>
```

These server only operations live in `src/modules/plants/plant-archive-service.ts`. The target must be a UUID. The strict input accepts only the original updatedAt ISO timestamp including milliseconds. Callers cannot supply archivedAt, identity, reference, status, related operations or other writable fields. The result contains the saved scalar Plant record, with Date values on the server, and whether a state change was made.

Archiving sets archivedAt to the current time. Restoring clears it. The only other changed column is updatedAt. A repeated archive returns changed false and preserves the original archive date and updatedAt. Restoring an already active Plant also returns changed false without writing. Neither operation allocates or resets the ANT sequence.

## Concurrency

Each operation runs in a short Read Committed transaction and locks the target with FOR NO KEY UPDATE, the same lock used by editing. A missing Plant produces NOT_FOUND. If the desired state already exists, it returns without writing before comparing the timestamp. This lets a repeated request with the original token remain harmless.

If a state change is needed, expectedUpdatedAt must match the locked row. A stale request returns STALE_UPDATE instead of merging, retrying or overwriting newer changes. A successful state change advances updatedAt to the greater of the current time and the previous timestamp plus one millisecond. An edit form loaded before an archive or restore is therefore stale, even if both writes happened very quickly.

This also protects an old archive request after the Plant has subsequently been restored. Since the requested state now differs again, the old token is rejected. Duplicate no op requests do not block on a stale comparison because they change nothing. This is small state based idempotency, not a request history or versioning system.

Only one Plant row is locked. There are no parentage writes, so no graph advisory lock or Location lock is needed. No new locking abstraction is introduced.

## Browser behaviour

Plant details remain readable while archived. The header shows Archived alongside the unchanged status, and the details include the archive date. The existing Edit Plant link remains available; editing an archived Plant does not restore it.

An active Plant offers Archive Plant. This opens an inline fieldset identifying its ANT reference and explaining that the Plant is not deleted, its history and status remain intact, and it can be restored later. Cancel receives keyboard focus and returns focus to Archive Plant when dismissed. Only Confirm Archive submits the write. The server action independently requires the confirmation value.

The confirmation retains the version shown when it opened. A background refresh cannot silently authorise archiving a newer version. Pending controls are disabled and a local guard prevents ordinary double submission. Restore Plant uses the same pending and success feedback without an unnecessary archive warning.

Successful actions refresh the detail route so the archive badge, date, action and navigation match the database. Returning to either list reads current data; no shared query cache is introduced. The archived query selects reference, name, status, Location name, internal linking ID and archivedAt. It orders by archive date descending, then reference ascending. Active ordering stays creation date descending, then reference ascending. Both routes read at request time, and both use the existing loading and error boundary.

Expected validation, missing Plant and stale state errors use the existing PlantError approach. The focused feedback announces success or failure; stale failures include a link to reload the current detail record. Unexpected server or database failures are logged on the server with their original cause and return a generic browser message. A failed transport gets the same safe guidance to reload and check the actual state before trying again.

## Verification boundaries

Unit, component and page tests cover strict input, confirmation, Cancel focus, pending protection, success refresh, stale confirmation tokens, safe errors, active and archived lists and detail controls. Existing Add, Edit and List tests remain regression coverage.

Database tests run only against the guarded PostgreSQL test database. Fixtures are enclosed in rolled back transactions, with savepoints around public service calls to preserve their normal failure boundary. They exercise real SQL, preservation of all current relationships, repeated operations, both lists, parent options, stale edits, strictly increasing timestamps, ordering, not found and a real SQL failure rollback. A real server action test archives, reads and restores its fixture. Counts and the ANT sequence are checked after every test. No fixture records are committed.

Manual verification must not archive the owner's ANT-0001 without explicit approval. The safe review checks navigation, existing details, archive confirmation and Cancel at desktop and mobile widths. The complete write cycle is covered by the test database checks; a live archive and restore remains an owner approved review step. No special browser fixture bypass or browser testing dependency is added.

### Review results, 31 August 2026

All 374 unit, component and page tests passed, along with 122 PostgreSQL tests. Prisma validation and client generation, lint, formatting, TypeScript and the production build passed. Both configured PostgreSQL databases were reachable after starting Docker Desktop and the existing Compose service. The existing pg deprecation warning about overlapping relation queries inside fixture transactions remains visible; it is not a failed check.

Manual review used the production build at 1440 and 390 pixel viewport widths. The active list showed ANT-0001, View Archived opened the empty archive, and View active Plants returned to the collection. Opening ANT-0001 preserved its name, status, parentage and £50.00 purchase details. Archive Plant opened the explicit confirmation with Cancel focused. Cancel closed it and returned focus to Archive Plant. There was no horizontal overflow at either width. Add Plant and Edit Plant navigation remained available.

No real archive or restore was submitted. There were no archived development records available for a live Restore check, so populated archive rows, archived details, Restore controls and the full write cycle were verified in component and PostgreSQL tests. A read only comparison of every current nursery table and the development sequence confirmed that the owner's data was unchanged. ANT-0001 remains active and the sequence remains at its existing value of 1.

### Files in this milestone

New files:

```text
docs/plant-archiving.md
src/app/plants/archived/page.tsx
src/app/plants/archived/page.test.tsx
src/modules/plants/plant-archive-service.ts
src/modules/plants/plant-archive-actions.ts
src/modules/plants/components/plant-archive-controls.tsx
src/modules/plants/components/plant-archive-controls.test.tsx
tests/unit/plant-archive-service.test.ts
tests/unit/plant-archive-actions.test.ts
tests/database/plant-archive.test.ts
```

Updated files:

```text
README.md
docs/architecture.md
docs/mvp-roadmap.md
docs/plant-browser-flow.md
docs/plant-data-model.md
src/app/plants/page.tsx
src/app/plants/page.test.tsx
src/app/plants/[plantId]/page.test.tsx
src/modules/plants/plant-queries.ts
src/modules/plants/components/plant-detail.tsx
src/modules/plants/components/plant-detail.test.tsx
src/modules/plants/components/plant-list.tsx
src/modules/plants/components/plant-list.test.tsx
src/modules/plants/components/plant-management.module.css
```
