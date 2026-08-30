# Editing Plants

## Scope

This milestone adds Edit Plant to the existing detail page and `/plants/[plantId]/edit`. It changes the current Plant, parentage and purchase details, then returns to the same UUID detail route. The visible ANT reference stays unchanged. There are no schema changes, migrations, new dependencies, archive controls, deletion or photo handling.

## Operation and input

`updatePlant(plantId, input): Promise<UpdatedPlant>` is exported from `src/modules/plants/plant-update-service.ts`. It is server only and uses the existing Prisma runtime. Its result contains the saved Plant fields plus Location, parentage and purchase, each object or null. Dates remain JavaScript Date values on the server. Photos are not included.

The input requires `expectedUpdatedAt`, the exact ISO timestamp originally loaded by the edit page, including milliseconds. It is a comparison token, not a value to assign. The editable properties are name, status, locationId, notes, parentage and purchase. The target UUID is validated separately; it identifies the existing Plant and cannot replace its ID.

Omitting a property, or supplying undefined through a TypeScript caller, preserves its current value. Explicit null clears nullable fields. Optional text is trimmed and blank text becomes null. Status cannot be null and has no creation default during an update. Strict objects reject identity fields, createdAt, updatedAt, archivedAt, related record IDs and arbitrary Prisma operations.

Creation and editing share scalar rules in `plant-field-schemas.ts`. They do not share omission/default behaviour. In particular, editing never sends its input through the creation schema to fill missing values with null or GBP.

Parent choices are explicit:

```ts
parentage: {
  seedParent: { kind: 'plant', plantId: 'existing UUID' },
  pollenParent: { kind: 'external', name: 'Named parent' },
}
```

Each role can instead use `{ kind: 'unknown' }` to clear both its link and external name. Omitting a role preserves it. A choice cannot contain both a linked ID and a name. A blank external name is rejected with guidance to choose Unknown. Existing empty parentage rows are retained. No row is created when an absent parentage group remains completely unknown.

## Purchase semantics

Omitting purchase leaves it untouched. Supplying a purchase object creates the record if absent or patches the existing record. Its optional fields are seller, orderReference, purchaseDate, plantPriceMinor, shippingCostMinor, otherCostMinor and currency. Omitted fields preserve their values; explicit null clears an optional detail. Currency is required on the stored record, so it cannot be cleared.

An explicit `purchase: {}` creates a purchase with unknown details and GBP when none exists. If a purchase already exists, the empty object makes no changes to its fields or its own updatedAt. The successful Plant edit still advances Plant.updatedAt. `purchase: null` is rejected rather than interpreted as deletion. Existing purchase IDs and createdAt values are preserved.

Costs remain integer minor units with the existing bounds. Null means unknown and zero means known zero cost. Purchase dates use valid YYYY-MM-DD calendar dates. New purchases default to GBP; omitting currency for an existing purchase preserves its recorded currency.

The form shows normal decimal amounts. Prefilling converts minor units to exact decimal strings, and submission uses the existing string/bigint parser. Null becomes blank and GBP zero becomes 0.00. Neither path rounds values. Changing currency does not convert money: the form interprets the entered amounts using the selected currency's precision. A direct service patch that changes only currency preserves existing integer amounts. This is a correction to the recorded denomination, not an exchange operation.

## Location semantics

An omitted or unchanged Location preserves the current assignment, even if that Location has since been archived. A different assigned Location must exist and not be archived. Explicit null clears the assignment.

The form loads usable Locations and includes a clearly labelled current archived Location when necessary. Keeping that option is allowed, but the service checks it against the locked Plant record rather than trusting browser metadata. Once the Plant is moved elsewhere and saved, the old archived Location cannot be newly assigned again.

New assignments use `FOR SHARE` on the selected Location, as creation does, so archive state remains stable through the save. Location hierarchy and management remain outside this milestone.

## Parentage cycles and locking

Linked parents must exist and cannot be the edited Plant. Archived, Sold and Deceased Plants remain valid parents. One Plant may fill both roles.

For a proposed parent, a parameterised recursive PostgreSQL query follows both linked parent roles. If it reaches the Plant being edited, the new link would create a cycle and is rejected. External names are not traversed. The recursive result contains only Plant IDs and uses UNION, not UNION ALL, to deduplicate visits. Existing bad cyclic data therefore cannot make traversal loop forever. This check does not repair unrelated existing bad data or build a family tree UI.

Every update that supplies parentage first obtains `pg_advisory_xact_lock(1095650894, 1)`. This fixed namespace/key belongs only to existing Plant parentage mutations. It serialises their check and save phases across application connections, including edits to different Plants. Otherwise two individually valid checks could together create a cycle.

The lock is scoped to the transaction, not the session. It is released on commit or rollback. There is no lock table or generic locking framework. Ordinary service patches without a parentage group do not take it. The complete edit form supplies both roles, so its short save transaction does take the lock even when the user has not changed those controls.

Locks are acquired in a consistent order: parentage advisory lock when needed, target Plant `FOR NO KEY UPDATE`, then a new Location `FOR SHARE` when needed. The Plant lock prevents simultaneous changes to the target without unnecessarily blocking foreign key references to its immutable ID. Transactions explicitly use Read Committed; queries after an advisory lock wait see the latest committed parentage.

Creation still links a new UUID only to existing Plants and cannot introduce a cycle into a valid graph. Future code that rewrites existing parent links must use the same parentage locking and validation protocol. Direct privileged SQL and imports that bypass the service are not covered by this application rule.

## Stale edits and transaction boundary

The expectedUpdatedAt comparison happens while the target Plant is locked. If the stored timestamp differs, STALE_UPDATE is returned without writing any fields or related records. The form keeps its entered values and offers the latest detail page in a separate tab. It does not refresh its token and retry, merge edits or overwrite the newer version.

The form keeps the original token paired with its original values for the lifetime of the edit. A server rerender cannot swap in a newer token under retained input. Reloading the edit page deliberately loads a fresh version and replaces unsaved entries.

Every accepted save advances Plant.updatedAt, including related only edits and an otherwise empty patch. The server chooses the greater of its current time and the previous timestamp plus one millisecond. This prevents equal tokens during rapid saves and handles a server clock behind the previous timestamp. Future operations that change this logical Plant record must also advance that timestamp.

All Plant, parentage and purchase writes use one Prisma transaction. Any failure rolls them all back. The service returns only after commit. The ANT sequence is never read for allocation, advanced or reset by editing. Identity, reference, createdAt and archivedAt are not part of its write data. Editing an archived Plant through its direct URL does not restore it or change its archive timestamp.

## Browser boundary and errors

The edit page reuses getPlantById, getPlantParentOptions and getUsableLocationOptions. The target Plant is excluded from its own parent choices. Reads use connection() and the existing request time approach, with no new caching layer.

Add Plant and Edit Plant share the feature specific PlantForm and ParentSelector. Edit uses prefilled values, a visible immutable reference, Save Changes and Cancel. A purchase that already exists is always shown; there is no checkbox that removes it. The optional purchase checkbox remains available when no purchase exists. Add Plant keeps its existing behaviour.

The edit action handles FormData, parent choices, purchase interpretation, exact money conversion, safe errors and redirect. It requires a complete set of visible form controls so malformed omissions cannot acquire creation defaults and clear existing values. Inactive parent fields are not passed to the service. The service itself still accepts sparse patches.

PlantError now includes NOT_FOUND, ANCESTRY_CYCLE and STALE_UPDATE alongside VALIDATION_FAILED, INVALID_PARENT, LOCATION_UNAVAILABLE and CONFLICT. Expected errors map to fields or the focused form summary. Unexpected infrastructure errors retain their original cause for server diagnostics; the browser receives a safe message with no SQL or connection details. Redirect remains outside the error catch.

The shared form retains controlled values on errors, labels inputs, uses fieldsets and legends, focuses its error summary and disables submission while saving. This is ordinary duplicate click protection, not durable request idempotency. Authentication is still a separate requirement before public deployment.

## Verification

Unit and UI tests cover strict input, omissions and clearing, money round trips, edit defaults, parent choices, incomplete submissions, safe errors, retained values, stale token pairing and redirects. Existing Add Plant tests exercise the shared form as regression coverage.

PostgreSQL tests cover edits, unchanged identity, parentage transitions, direct and longer cycles through both roles, termination with preexisting cyclic data, purchase semantics, Locations, stale callers, strictly advancing timestamps and actual SQL failure rollback. A real action test exercises parsing, the update service, reading the result and the redirect target.

Fixtures use the guarded test database and are rolled back. Test wrappers use savepoints to give each service call an atomic failure boundary inside the fixture transaction; production code contains no testing hooks. Separate connections check advisory lock contention and release. Stale callers and cycle outcomes are exercised within fixture transactions, not claimed as a fully committed concurrent browser test. Tests assert unchanged fixture counts and unchanged test sequence values.

There is no installed browser test framework. Manual review should open a saved Plant, follow Edit Plant, check its prefilled sections at desktop and mobile widths, enter an invalid GBP amount such as 50.555, and confirm the error retains input without saving. Cancel must return to the unchanged detail page. A successful manual save should be a genuine correction approved by the owner, not a temporary mutation of nursery data.

### Review results, 31 August 2026

The complete suite passed with 307 unit/component/page tests and 106 PostgreSQL tests. Prisma formatting, validation and generation, lint, formatting checks, TypeScript and the production build also passed. The existing pg warning about overlapping relation queries inside fixture transactions remains visible; it is not a test failure and no dependency workaround was introduced.

Manual review used the existing ANT-0001 record. The detail link opened Editing ANT-0001 with its name, parent names, seller, purchase date and 50.00 GBP price prefilled. The form was checked at 1440 and 390 pixel widths without horizontal overflow. Submitting 50.555 produced a field error, focused the summary and preserved the entered amount. Following the summary link focused the amount field. Cancel returned to the saved detail page showing the original £50.00 price.

A read only database comparison confirmed unchanged Plant, parentage and purchase records and unchanged development sequence state. No successful live edit was submitted because there was no owner approved correction to make. The successful save, read and redirect path was exercised by the real action/service test against PostgreSQL, with its fixture rolled back. A successful manual save remains an owner review step.
