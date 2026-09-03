# Initial application architecture

## What this project is

Anth Nursery OS is a management app for one small nursery. It starts with my own Anthurium collection and breeding programme, so it needs to be useful day to day as well as a good software project to show in a portfolio.

The first MVP is plants, equipment inventory, energy estimates, care, expenses, and a dashboard. Equipment inventory is complete, and the owner has moved energy history ahead of Care. Its schema is committed; the current checkpoint adds services, queries and exact calculations, with browser features still separate. Maintenance, breeding and ancestry are later phases and should not make the first version more complicated than it needs to be.

## Choices made for the foundation

The app uses Next.js with React and TypeScript. Keeping the frontend and server side in one TypeScript project makes sense for a small single user application and keeps the local setup simple.

Features will live in `src/modules`. For example, when Plant Management starts, its components, validation, rules, and data access should sit together in a `plants` module. This should stop the app becoming one large folder of unrelated files as more nursery areas are added.

Prisma with PostgreSQL 18 is the database foundation. Development, testing, and production use the same database engine so local migrations and database behaviour match the eventual production environment. Docker Compose runs PostgreSQL locally with a persistent named volume. The development and test databases are separate but run in the same local container.

SQLite was used briefly during the empty foundation stage because it required no database server. It was removed before any application models or migrations were created, so there is no application data or migration history to convert.

Zod is there for checking data at the edges of the app. Vitest and Testing Library are used for tests. Styling starts with ordinary CSS so the UI can develop naturally before deciding whether a design system is actually needed.

## Application shell

The main layout is shared by every route. It uses a fixed sidebar on larger screens and a slide out menu on smaller screens, so each feature can keep the same navigation without rebuilding it. The navigation is the only client side part of the shell because it needs the current route and the mobile menu state. The rest stays server rendered by default.

Shared colours, spacing, borders, and type values are kept as CSS variables in `src/app/globals.css`. Individual components use CSS Modules so their layout rules stay with them. Lucide React supplies the simple line icons used throughout the shell. This avoids drawing and maintaining our own icons, while keeping them consistent and accessible.

Only the current MVP areas are shown in the main navigation: Dashboard, Plants, Care, Equipment, and Expenses. Later features should be added when their phase starts, rather than appearing as empty promises in the app now. Search, notifications, and theme controls are present only as disabled layout placeholders and have no behaviour yet.

## Folder structure

```text
src/
  app/              Next.js routes and layouts
  components/       Shared presentational UI, only when it is genuinely shared
  lib/              Shared infrastructure helpers
  modules/
    <feature>/      Code that belongs to one feature
  generated/        Prisma generated code; ignored by Git
prisma/
  schema.prisma     The source database schema
  migrations/       Reviewed migration history
tests/              Shared test setup and helpers
docs/               Project and technical notes
```

The `components`, `lib`, and `modules` folders are not being created just to make the tree look finished. They should appear when there is code that belongs in them.

## Database starting point

The original Plant foundation contains Plant, PlantParentage, PlantPurchase, PlantPhoto, Location, PlantStatus and the ANT sequence. Plant creation, browsing, editing, archive/restore and photo features are implemented. Equipment, EquipmentPurchase, EquipmentPhoto and an independent EQP sequence reuse the same foundation and Location. Equipment creation, editing, archive/restore, reads, inventory pages and the complete Equipment photo browser slice are implemented.

Internal IDs use Prisma generated UUIDs stored in PostgreSQL UUID columns. Timestamps use `timestamptz` with millisecond precision, while the purchase date uses a calendar `date`. Foreign keys restrict deletion and ID updates so referenced nursery records cannot disappear through a cascade. Schema limitations and rules reserved for the migration or data layer are recorded in `docs/plant-data-model.md`.

The migration includes three cost check constraints and `NULLS NOT DISTINCT` on the Location name index. Those SQL details and the later reference sequence are documented in `docs/database-migrations.md` and must survive future migrations. Database tests exercise both direct SQL constraints and the real Prisma creation operation, with fixture transactions rolled back. A shared URL guard restricts tests and test migrations to a separate local database. Unit and UI tests remain independent of PostgreSQL.

## Plant creation data layer

`src/modules/plants` owns Plant input validation, reference formatting, creation and expected errors. `createPlant` is a server only operation, not a server action. Its strict input schema rejects IDs, references, timestamps and arbitrary nested Prisma operations. The implementation maps allowed fields explicitly and relies on the existing UUID defaults.

`src/lib/prisma.ts` creates the shared Prisma client on first use, using `@prisma/adapter-pg` with the existing Prisma version. Development reuses the client across module reloads. The client and creation operation have `server-only` boundaries. No generic repository or service framework is introduced.

A standalone PostgreSQL sequence allocates ANT numbers safely across concurrent transactions. Formatting uses bigint values without rounding and pads to at least four digits. The full reference stays on Plant. Allocation order need not match commit order, and failed transactions leave gaps. Neither archive nor row deletion rewinds the sequence. Resetting a database or restoring an older backup can lose sequence history, so future imports and restores must take reference allocation into account.

Plant, parentage and purchase writes use one short Prisma transaction. The selected Location is checked with `FOR SHARE` so its archive state cannot change between the check and assignment. Parent links must already exist; archived and historical parents remain valid. Creation cannot add a cycle to an otherwise valid graph because the child has a fresh UUID and links only to existing parents. Editing adds the separate cycle protection described below.

Purchase dates are calendar dates, not instants to shift between timezones. Currency validation uses the Node runtime's `Intl.supportedValuesOf('currency')` list rather than a new dependency. That list follows the runtime's currency data and is not an exhaustive historical currency catalogue. The complete input, transaction and error contract is in `docs/plant-creation.md`.

The original project specification already gives a few important rules for later work. Historical records need to be kept through archive or status logic rather than deletion. Care should be stored as events, and values such as last watered or last fertilised should be worked out from those events instead of being separate editable fields. When breeding is built, real breeding events and possible future crosses should be separate. Seedlings should use the main Plant record and link back to their origin rather than becoming a disconnected set of records.

The reviewed Plant Management design is kept in `docs/plant-data-model.md` before it is translated into Prisma. This keeps product decisions separate from the implementation details of a particular database tool and gives the schema migration a clear review point.

## Plant browser workflow

`/plants` lists non archived Plants and links to their detail pages. `/plants/new` loads the Add Plant form, while `/plants/[plantId]` reads the saved record by internal UUID. The visible ANT reference remains the main identifier on the list and detail page. Route files compose the page; feature components, form parsing, the server action and read queries stay in `src/modules/plants`.

The form uses React state and `useActionState`, without a form library. Submission captures FormData before disabling controls and dispatches the action in a transition. This avoids the automatic form reset after an unsuccessful action, preserving parent modes and the purchase checkbox as well as text. A pending state and a local submission guard prevent ordinary repeated clicks. They are not durable idempotency protection.

The action only handles the browser boundary. It reads an explicit set of form fields, interprets parent modes and the optional purchase section, converts amounts using decimal strings and bigint, and calls the existing `createPlant`. Business validation, sequence allocation and the transaction remain in that service. Expected errors become safe field or form messages. Unexpected errors retain their server diagnostics and return a generic message. Redirect runs outside the error catch, after the service succeeds.

The list, new, edit, archived and detail routes use Next's `connection()` before database reads so their content is loaded for each request, not during a production build. Small server only queries load active and archived lists, a single Plant, available parent options and usable Locations. There is no repository framework or shared query cache.

`getPlantList` selects just the internal ID, reference, name, status, Location name, creation timestamp and the primary photo ID if present. It excludes records with `archivedAt` set, without excluding Sold or Deceased Plants that have not been archived. Ordering is `createdAt` descending, then the unique reference ascending for equal timestamps. Reference ordering is a deterministic text tie break, not a replacement for the creation date or a numeric sequence sort.

The list is a semantic list of links laid out in columns on desktop and stacked cards on narrower screens. It renders the records once, with one keyboard focus target per Plant. The existing status labels and badge styles are reused. The current detail route, creation action and schema are unchanged. Returning through the Plants links reads the list again, so a newly created Plant appears without a new cache layer. The existing route error boundary handles read failures and a small loading state covers pending Plant routes.

GBP is the default browser currency. Runtime internationalisation data supplies other currency choices and decimal precision; the existing service remains responsible for recognising currency codes and enforcing integer bounds. Amounts are not rounded into validity. Blank remains unknown, while zero remains a known zero cost.

There is no authentication in this milestone. The local run commands bind to loopback to avoid exposing write actions to other machines by default. Authentication and a deployment security review are required before any public use. Full workflow details and test boundaries are in `docs/plant-browser-flow.md`.

## Plant editing

`updatePlant` is a separate server only operation in the Plant module. It shares scalar validation with creation, but keeps its own strict patch semantics: omitted means preserve and explicit null clears nullable fields. Identity, reference, createdAt and archivedAt are never assigned by the update. Plant, parentage and purchase changes are atomic and editing never allocates an ANT number.

Existing parentage mutations obtain one PostgreSQL transaction advisory lock before locking the target Plant. A recursive query follows linked parents through both roles, deduplicating Plant IDs with UNION, and rejects any proposed parent that reaches the target. This prevents cycles across simultaneous edits to different Plants without adding ancestry tables or a generic lock service. Future existing parentage writers must follow the same protocol. Transactions use Read Committed so validation after a lock wait sees the latest committed relationships.

The target Plant uses FOR NO KEY UPDATE. Its updatedAt is compared to the original expectedUpdatedAt while locked. Each accepted save advances it to at least the previous timestamp plus one millisecond, including related only changes. Stale edits fail without automatic merge or retry. No version column is needed for this milestone. New Location assignments use the existing FOR SHARE check, while a currently assigned archived Location may be preserved.

The shared Plant form supports Add and Edit without a form framework. `/plants/[plantId]/edit` reuses the existing reads and preloads values, parent modes and exact decimal money. The action performs only browser boundary work. The original token stays paired with retained values; a server rerender cannot quietly refresh it. Existing purchases can have fields cleared but cannot be deleted. Complete behaviour and test boundaries are in `plant-editing.md`.

## Plant archive and restore

Archive state is independent of biological status. Restricted server only operations change archivedAt and advance updatedAt, without changing status, reference, identity, Location or any related record. They never allocate an ANT reference or delete anything.

Archive and restore use the same target row lock and expectedUpdatedAt token as editing. A state change requires a matching token under FOR NO KEY UPDATE, and its replacement timestamp is strictly later than the previous value. This also makes older edit forms stale. A request whose desired state already exists returns without writing, even with the token from the original request. Repeated archive therefore preserves the first archive date. No parentage advisory lock is needed because relationships are not changed.

The detail page uses a small inline confirmation before archiving. Server actions validate the confirmation and call the service; client controls show pending, safe failure or success feedback. On success, router.refresh reloads the current detail record and clears the client route cache so returning to either list reads current data. This is a local refresh after a write, not a shared cache or invalidation framework.

`/plants/archived` reuses the existing responsive Plant list with an archive date column. Its query selects only archived records, ordered by archivedAt descending and reference ascending. The active list keeps its original ordering and excludes archived records regardless of status. Archived details and historical parent options remain accessible. The complete operation contract and testing boundaries are in `plant-archiving.md`.

## Approved Plant photo architecture

Cloudflare R2 holds photographs in a private bucket while PostgreSQL retains PlantPhoto metadata only. Storage keys are generated on the server and identify the retained original; known display and thumbnail copies share its asset folder. Filenames are metadata, not object paths. Provider settings and credentials stay in server configuration, and R2 does not determine where Next.js or PostgreSQL must be hosted.

The first implementation will accept JPEG, PNG and static WebP, one file at a time, up to 10 MiB and 50 MP decoded. HEIC/HEIF is deferred. Server validation must inspect and decode the content, with bounded request and processing resources. Retain the validated original privately and generate display WebP up to approximately 2560 pixels and thumbnail WebP up to approximately 320 pixels on the longest side. Served derivatives have orientation applied and EXIF/GPS removed. The initial UI will not serve originals.

Neutral image processing, crop geometry, exact photo key validation, R2 transport and per asset cleanup now live in the small shared photo infrastructure. A Plant wrapper fixes the namespace to `plants`, so existing Plant keys remain unchanged and Equipment keys are rejected before provider access. The Plant module still owns PlantPhoto rules, persistence, queries, transactions and browser boundaries. Upload files before opening a short database transaction, then lock the Plant, recheck expectedUpdatedAt, insert metadata and update its timestamp. First photos become primary; primary changes are atomic under the same Plant lock. A PostgreSQL partial unique index guarantees at most one primary photo per Plant. Full shared and domain specific boundaries are recorded in [Shared photo infrastructure](shared-photo-infrastructure.md).

Failed uploads will attempt targeted cleanup of their own new objects. Cleanup failures must preserve the original error and log exact affected keys. An uncertain database commit must not trigger blind deletion, and a housekeeping failure after commit must not undo saved metadata or referenced files. There is no general orphan scanner, reconciliation tool or broad bucket cleanup in the initial implementation.

Archived Plants may receive photos and change their primary photo without changing archivedAt or status. The gallery and list use processed copies delivered through short lived signed URLs. Private storage does not make the unauthenticated app safe to expose publicly: local use stays on loopback, credentials stay server only, and authentication and access checks remain prerequisites for public deployment. Backup planning must cover both metadata and objects.

No production host is selected. Keep the server side 10 MiB upload design; a host with a smaller request limit would require a later transport change, likely staged/direct presigned R2 uploads, without changing the storage backend. Do not implement that alternative now. Full security, hosting, lifecycle and test decisions are recorded in [Plant photo storage](plant-photo-storage.md).

The current data layer uses directly declared Sharp and AWS S3 SDK packages. The shared lazy R2 factory requires an explicit approved namespace and private configuration, and refuses automated test environments; tests use a memory fake or mock the SDK. Conditional PUT and upload ownership metadata protect targeted cleanup. Recovery of an uncertain database commit remains Plant specific and acquires the Plant lock in a new transaction before checking the generated storage key, so files are not deleted on an unconfirmed outcome. No R2 network operation runs while a database lock is held. The Plant read boundary signs only the display or thumbnail of a known PlantPhoto for five minutes.

Operation contracts, memory and timeout limits, testing and development bucket instructions are in [Plant photo data layer](plant-photo-data-layer.md). The separately approved real R2 smoke test passed and removed its disposable object without changing nursery records.

The browser layer uses Node route handlers for multipart upload, primary selection and private derivative delivery. The upload boundary counts bytes before multipart parsing, caps the form at 10 MiB plus 64 KiB, limits receiving time to 30 seconds and rejects unsupported fields. Mutations require a matching Origin; the primary JSON body is capped at 1 KiB. This avoids raising the global Server Action limit or adding an upload framework. Existing services retain all business rules and transaction handling.

Next normalises the request URL's loopback hostname to localhost. The photo Origin check therefore consults the original Host only for HTTP requests to the explicitly supported localhost and 127.0.0.1 addresses on the same port. It still requires an exact Origin match, rejects other hosts and ignores forwarded headers. This keeps the documented local address working without permitting arbitrary origins or changing deployment assumptions.

The client Photos section owns pending feedback and retained metadata, using expectedUpdatedAt without silently adopting another edit's token. Successful mutations refresh the route. Taken time is interpreted explicitly in the device timezone, stored as UTC and displayed in Europe/London. Known photo delivery redirects to a five minute signed derivative with private no-store headers; originals and arbitrary keys are not exposed. Already resized images bypass the shared Next optimiser and render a placeholder on failure. Details and review steps are in [Plant photo browser workflow](plant-photo-browser-flow.md).

## Square thumbnail crops

The approved square thumbnail crop checkpoint adds normalised cropX, cropY, cropSize and a thumbnail only derivativeRevision to PlantPhoto. A new migration enforces all-or-none metadata and independent coordinate ranges; legacy rows stay null with no backfill. Original and full display remain unchanged. New thumbnails use immutable thumbnails/<revision UUID>.webp paths; only the database selects the active revision. Crop adjustment writes one new thumbnail, then locks the Plant, checks expectedUpdatedAt and switches metadata atomically. It preserves archive state and advances Plant.updatedAt strictly. Failed attempts clean up only their new thumbnail; uncertain commits are resolved by revision or retained with diagnostics. Superseded successful revisions are retained, without a history UI or scanner.

The shared square selector uses oriented image dimensions and supports pointer and keyboard input. A new upload first obtains a server generated preview through the bounded same origin photo boundary. This extra read only processing pass guarantees the same EXIF orientation as Sharp rather than relying on browser JPEG decoding. Existing editors reuse the full display and read oriented dimensions from the private original server side. Originals are never delivered to the browser. Full behaviour, storage paths and manual review are in [thumbnail crops](plant-photo-crops.md). No new dependency or provider is added.

## Plant photo deletion

The approved photo deletion checkpoint is a narrow exception to preserving nursery records. A strict `deletePlantPhoto` operation locks the Plant, checks expectedUpdatedAt and photo ownership, removes the selected metadata and promotes a deterministic remaining primary in one transaction. Plant.updatedAt advances strictly; status, archive state, identity and historical relationships stay unchanged. After confirmed commit, the R2 boundary lists and removes only the validated photo asset prefix, including superseded crop revisions. Database failure never triggers blind cleanup. Storage failure after commit leaves the database consistent and returns a warning with safe server diagnostics, without recreating metadata. There is no schema change, job framework or broad cleanup. The route retains the existing local origin protection; public deployment still needs authentication and access checks. Full rules and recovery limits are in [Plant photo deletion](plant-photo-deletion.md).

## Equipment energy persistence foundation

The committed [energy schema](equipment-energy.md) contains EquipmentPowerPeriod and ElectricityTariff. Equipment has a reverse powerPeriods relationship; the required period FK restricts Equipment deletion and ID changes. The tariff is a single nursery timeline, not an Equipment purchase or a tariff copied onto each item.

Power uses numeric(8,2) watts, hours use numeric(4,2) and GBP tariffs use numeric(9,5) pence per kWh. Both histories use DATE [start, end) intervals, nullable open ends, optional notes/correction reasons and retained voided records. Custom SQL checks enforce bounds, finite/ordered dates, GBP only and nonblank void reasons. Nonvoid daterange exclusion constraints prevent concurrent overlaps. btree_gist provides Equipment UUID equality and is required on future hosted PostgreSQL too. Migration details are in [database migrations](database-migrations.md).

Gaps mean unknown data, not zero consumption. Archive state does not close operating periods or change history. The [energy data layer](energy-data-layer.md) combines source periods and tariffs using exact scaled bigint arithmetic, reports missing coverage and rejects excess input precision before PostgreSQL rounds it. There are no saved monthly totals.

Energy services live in src/modules/energy. Power writes lock Equipment with FOR NO KEY UPDATE, check expectedUpdatedAt and strictly advance the Equipment timestamp for changes. Explicit corrections can adjust reviewed adjacent boundaries atomically; void preserves records without stretching neighbours. Equipment editing now blocks disabling usesPower while current/future nonvoid periods remain. Bounded past history can still be entered for an item that is no longer marked as powered.

Tariffs use the stable transaction advisory lock namespace 0x414e5448, key 1. Their SHA-256 timeline token covers sorted IDs/timestamps and retained void markers so an old empty token cannot become valid again after add/void. Repeatable Read report transactions combine bulk Equipment/period queries with the tariff snapshot. No schema, generic repository, singleton version record or cache is added. Dashboard integration remains a later checkpoint.

The [energy browser workflow](energy-browser-flow.md) adds an Equipment detail section and `/energy/tariffs`. A small energy-specific shared editor calls strict server actions, which map text/date inputs to existing services. Open forms retain their original stale token; shared boundary corrections require explicit adjacent-change confirmation. Inclusive human end dates are translated to exclusive service boundaries. Exact calculations run before rendering and are presented as strings, with projections distinguished from calendar history and incomplete subtotals. Archive confirmation warns about ongoing settings without changing them. No persistence rules or dependencies change.

## Dashboard read model

The dashboard coordination boundary lives in `src/modules/dashboard` and exposes one read-only summary rather than coupling future homepage components to Plant, Equipment and Energy persistence. One Prisma Repeatable Read transaction performs a fixed set of batched reads for inventory, acquisition costs, current power settings, the one applicable tariff and recent primary-photo metadata. It uses no row or advisory locks and resolves no storage URLs.

Plant and Equipment acquisition coverage includes active and archived records. Known cost components are subtotalled even when another component is unknown, and missing purchases remain in the coverage denominator. Totals are grouped by currency; only matching Plant and Equipment currencies are combined. Current energy projections reuse the established exact calculation layer, keep unconfigured active powered Equipment separate from archived Equipment with ongoing settings, and do not represent measurements or bills. Recent lists contain at most four active records ordered by `createdAt` descending and UUID ascending, with only primary photo identity and revision.

The homepage is a request-time Server Component that calls this boundary once and passes the result to a dashboard presentation component. The UI keeps currencies separate, labels incomplete amounts and projection coverage, and links tariff configuration without adding mutations. Recent thumbnails use the existing domain-safe delivery paths and neutral client-side image fallback; the dashboard never sees storage keys or signs provider URLs. Responsive CSS collapses overview, energy, investment and recent-item grids without adding a chart or widget framework.

## Equipment inventory foundation

Equipment represents individual physical items, not quantities. Its UUID is the relationship key; createEquipment assigns the unique text reference as EQP-XXXX using the independent sequence. Category is flexible text defaulting to Other. Name is required; brand, model, serial number, notes, Location and archive date are optional. No EquipmentStatus or category table is added.

usesPower means “This equipment is capable of having electrical consumption tracked by AnthNurseryOS.” It is required without a default and is not a current operating flag or automatic inclusion in cost calculations. The separate approved energy schema now stores historical watts/hours and tariffs; it does not add energy services or calculations to inventory.

EquipmentPurchase is optional and unique per item. Costs use the same integer minor units and null versus zero distinction as Plant purchases, with three custom PostgreSQL nonnegative checks. Shipping is the amount allocated to this item, not automatically an entire shared order's shipping cost. Currency defaults to GBP in varchar(3), and purchaseDate is a calendar date. No Order model or calculated acquisition total is stored.

Both Equipment relationships use Restrict for delete and update. Location gains only its reverse Equipment relation; its hierarchy, uniqueness and existing Plant relationships are unchanged. Equipment has only its primary/reference indexes and locationId index, and EquipmentPurchase has its primary and unique equipmentId indexes. UUIDs and @updatedAt remain Prisma responsibilities, consistent with Plants.

The committed schema migrations introduced the inventory tables/checks and separate public.equipment_reference_sequence. The persistent BIGINT sequence starts at 1 with CACHE 1, NO CYCLE and no column ownership. The data layer adds no migrations or dependencies. Equipment allocation never calls the ANT sequence; rollback gaps are expected for both domains' creation tests in the guarded test database.

src/modules/equipment owns strict inputs, small Equipment errors, reference formatting, operations and reads. It does not call Plant services. The only Plant change extracts unchanged scalar cost/currency/calendar date validation into src/lib/purchase-field-schemas.ts so both domains use the same rules. Creation saves Equipment and optional Purchase atomically, with a Location FOR SHARE check. Editing locks Equipment with FOR NO KEY UPDATE, rechecks expectedUpdatedAt, then checks any changed Location. Transactions use READ COMMITTED and no parentage advisory lock. Explicit field mapping keeps identity/reference/history outside editable inputs, with omitted patch fields preserved and null clearing nullable values.

Every accepted logical edit advances updatedAt to max(server time, previous time + 1 millisecond), including purchase only edits. Archive/restore use the same row lock and Plant idempotency semantics: a repeated request for the existing state keeps both timestamps, while a real transition needs a current token. Small fresh reads provide active/archived lists, detail including purchase/Location, and usable Location options. There are no server actions, pages or broad caching layers in this checkpoint. Full inputs, errors, tests and scope are in [Equipment data model](equipment-data-model.md), with SQL history in [database migrations](database-migrations.md).

## Equipment browser workflow

The Equipment browser checkpoint uses one shared Add/Edit form and small server actions that call the existing services. Its list query adds only brand/model to the selected fields. Exact money parsing/formatting is shared in src/lib/purchase-money.ts; the previous Plant exports remain compatible aliases. Routes use connection() for fresh reads, create/edit redirect to UUID detail URLs, and archive/restore refresh the current page. Forms retain values and their original expectedUpdatedAt token rather than silently authorising a newer edit. The archived list links to each detail page for restoration. No schema, dependency, energy, photo or dashboard changes are included. The full boundary, security and UX decisions are in [Equipment browser workflow](equipment-browser-flow.md).

## Equipment photo schema foundation

EquipmentPhoto is a separate required Equipment ownership model, not a polymorphic PlantPhoto replacement. It mirrors the approved metadata needed for a private original, natural aspect display derivative and square cropped revision thumbnail. `storageKey` uniquely identifies only the immutable original. The Equipment foreign key restricts deletion and ID updates; archive state remains independent.

A PostgreSQL partial unique index allows zero or one primary photo per Equipment while leaving nonprimary photos unrestricted. Migration checks require cropX, cropY, cropSize and derivativeRevision to be all null or all populated, and protect their independent normalised ranges. Full image bounds remain a later service rule. The table has only its primary key, unique storage key, `(equipmentId, sortOrder)` index and partial primary index.

Equipment photo services consume the shared photo infrastructure through the closed `equipment/<equipment UUID>/<asset UUID>/...` namespace. Equipment owns its storage wrapper, validation mapping, transactions, primary selection, crop revision switch, database-first deletion and `Equipment.updatedAt` concurrency. Metadata reads remain storage free, while the restricted browser route resolves only a known photo's display or current thumbnail variant before signing. Equipment detail and list pages use Equipment-specific composition; only the crop selector and safe image fallback are shared with Plants. Details are in [Equipment photo data model](equipment-photo-data-model.md) and [Equipment photo data layer](equipment-photo-data-layer.md).

## Keeping it tidy as it grows

## Nursery Watering queue read model

The nursery-wide Watering queue read model lives in `src/modules/watering` and exposes `getWateringQueue(nurseryDate?)`. It includes only current active-care Plants (unarchived Growing or Quarantine), while retaining historical records for other lifecycle states outside the queue. One Repeatable Read transaction loads minimal Plant/location/primary-photo metadata, applicable non-void schedules, and latest qualifying events in three batched reads; the existing pure due-state calculator then supplies category state, counts and deterministic operational ordering in memory. The model never loads histories or storage URLs and does not contact R2. Queue UI, Location filtering, batch recording and Dashboard Care integration remain pending.

Any meaningful architecture change should be recorded here with a short reason. New dependencies need to help with the current phase, not a vague future idea. When the database starts, each migration should be reviewed and committed with the code and tests that use it.
