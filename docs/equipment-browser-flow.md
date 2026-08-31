# Equipment browser workflow

## Scope

Equipment inventory now has list, add, detail, edit, archive and restore pages. They use the existing Equipment services and PostgreSQL schema. There are no new migrations, dependencies, photos, maintenance records, power periods, tariffs, running costs or dashboard changes.

## Routes and reads

/equipment shows non archived items. /equipment/archived shows archived items with their archive date and a link to open the detail page and restore them. Active ordering stays createdAt descending then reference ascending; archived ordering stays archivedAt descending then reference ascending. List rows include reference, name, brand/model where recorded, category, power capability, Location and date.

The list is one semantic list styled as columns on desktop and stacked cards below 64rem. There is no duplicate mobile markup. Both lists have useful empty states and navigation back to the other inventory view.

/equipment/new loads usable Location choices and the shared form. /equipment/[equipmentId] reads by internal UUID and displays the permanent EQP reference prominently. Missing or malformed IDs produce a not found page. /equipment/[equipmentId]/edit preloads the same form with the current details and timestamp. Archived Equipment can still be viewed and edited.

All five routes use connection() before reading PostgreSQL. Reads remain fresh per request, without a cache layer. Server actions redirect after create/edit. Archive/restore refresh the detail route after success; returning to either list runs its appropriate query again.

## Form behaviour

EquipmentForm is shared by Add and Edit. It uses React state and useActionState, with labelled controls, focused error summaries, field messages, pending feedback and duplicate submit protection. No form framework is added. The category field provides the approved suggestions through a native datalist while allowing custom text. Uses power begins unselected on creation and requires an explicit Yes or No; choosing a category never changes it.

The optional purchase checkbox reveals seller, order reference, calendar date, currency and amounts. GBP is first and selected by default. An existing purchase cannot be unchecked or deleted; its individual fields can be cleared to unknown. Hiding an unsaved optional purchase keeps its text locally but sends no purchase changes.

Blank amounts are null; 0 and 0.00 are known zero. Exact conversion uses the existing string/BigInt parser, now shared in src/lib/purchase-money.ts. Plant's previous money exports remain aliases to the unchanged functions. Other currency precision comes from Intl, with service validation retaining the recognised currency check. Changing currency does not convert values. Allocated shipping is explicitly labelled as the portion assigned to this physical item, not automatically the whole order's shipping cost.

New Location assignments only offer usable choices. Edit also includes the current archived Location, clearly labelled as archived and current. The service remains the authority if a Location changes between loading and saving. Clearing the selection sends null; missing fields in a partial request remain omitted.

## Action boundary and stale edits

equipment-form-data.ts accepts only known form fields, single text values and Next action metadata. It interprets the Yes/No choice, optional purchase group and money text. It does not implement Equipment business rules or expose Prisma operations. Unknown fields, duplicated values and file payloads are rejected. Editable blanks are passed to the service for normalisation; missing fields are not filled from creation defaults during editing. An amount supplied in a partial patch requires its currency rather than assuming GBP.

Create and update actions call the existing services and redirect only after success. Bound UUID and expectedUpdatedAt arguments identify the existing item and version; neither identity nor reference is an editable field. The form keeps its initial token paired with its retained inputs across server rerenders. Stale errors keep entered values and offer a link to the latest details in a new tab. There is no automatic merge or stale retry.

Expected Equipment errors become useful field or summary messages. Unexpected database failures and conflicts are logged on the server and return a safe message asking the user to check the saved state before retrying. Database diagnostics are not returned to the browser.

## Archive and restore

The detail page offers Archive Equipment for active items and Restore Equipment for archived ones. Archive opens an inline confirmation fieldset, focuses Cancel and explains that the record is not deleted, its history is retained and it can be restored. Cancel closes the confirmation without a write and returns focus to Archive. Confirmation captures the timestamp shown when it opened, so a background refresh cannot silently authorise a newer version.

The archive action requires one explicit confirmation value and rejects extra fields. Restore needs no destructive warning. Both actions use the existing expectedUpdatedAt service semantics, pending feedback, safe errors and a route refresh after success. No hard delete is exposed. Purchase, Location, reference and all other Equipment information stay intact.

## Security and verification

The app remains for trusted local use without authentication, bound to loopback by the development/start scripts. Server actions retain Next's built in origin protections. This is not permission to expose the application publicly; authentication and per record authorisation must be designed before public deployment.

Component tests cover the shared form, retained inputs, explicit power choices, category suggestions/custom input, nullable fields, pending states, archive confirmation, restore and page composition. Action tests cover exact money parsing, restricted input, safe errors and redirects. The database suite also runs the browser actions through the actual Equipment services inside rolled back fixtures, including create/edit/archive/restore, stale rejection and related data preservation. Tests use the guarded test database, never development records or R2.

Manual review may read development routes and change unsaved form presentation, but must not save, edit or archive real Equipment without approval. When the development inventory is empty, populated list/detail/edit and successful mutation behaviour are covered by component and PostgreSQL tests rather than inserting demo records.

For this checkpoint, the browser review opened the active list, Add Equipment and archived list. It expanded the optional purchase section without submitting. Layout checks at 1440px and 390px confirmed desktop columns, stacked mobile form fields and no horizontal overflow. There were no browser console errors. Development Equipment is empty, so no real creation, editing, archive or restore was performed. Database fingerprints confirmed development records and both reference sequences were unchanged.

## Files in this checkpoint

```text
docs/architecture.md
docs/equipment-browser-flow.md
docs/equipment-data-model.md
docs/mvp-roadmap.md
docs/projectspec.md
src/app/equipment/page.tsx
src/app/equipment/new/page.tsx
src/app/equipment/[equipmentId]/page.tsx
src/app/equipment/[equipmentId]/edit/page.tsx
src/app/equipment/archived/page.tsx
src/lib/purchase-money.ts
src/modules/equipment/equipment-actions.ts
src/modules/equipment/equipment-actions.test.ts
src/modules/equipment/equipment-archive-actions.ts
src/modules/equipment/equipment-edit-values.ts
src/modules/equipment/equipment-form-data.ts
src/modules/equipment/equipment-form-state.ts
src/modules/equipment/equipment-queries.ts
src/modules/equipment/components/equipment-archive-controls.tsx
src/modules/equipment/components/equipment-archive-controls.test.tsx
src/modules/equipment/components/equipment-detail.tsx
src/modules/equipment/components/equipment-form.tsx
src/modules/equipment/components/equipment-form.test.tsx
src/modules/equipment/components/equipment-list.tsx
src/modules/equipment/components/equipment-management.module.css
src/modules/equipment/components/equipment-pages.test.tsx
src/modules/plants/plant-money.ts
tests/database/equipment-service.test.ts
```
