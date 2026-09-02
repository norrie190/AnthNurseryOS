# Anth Nursery OS MVP roadmap

The MVP is being built in small reviewable stages. Each stage should leave the project working, tested, and ready for a focused Git commit.

## 1. Project foundation - complete

- Next.js and strict TypeScript
- ESLint and Prettier
- Vitest and Testing Library
- Prisma with PostgreSQL 18
- Docker Compose development and test databases
- Environment and developer commands
- README and development guidance

## 2. Application shell - complete

- Shared desktop sidebar
- Mobile navigation
- Current MVP routes
- Initial visual tokens and component styling
- Placeholder pages without feature behaviour

## 3. Plant Management data design - complete

This stage is deliberately split before any Plant CRUD is built.

### Documentation checkpoint

- Agree the visible and internal plant identifiers
- Agree Plant fields, statuses, archive behaviour, and money handling
- Agree parentage, purchase, photo, and location relationships
- Record the approved model in `plant-data-model.md`

Suggested commit:

```text
docs: define initial plant data model
```

### Database checkpoint

The approved schema and first migration are committed and applied locally. Their constraints and relationships are covered by database tests.

- Add only the approved Plant Management models to Prisma
- Review the actual Prisma schema before generating any migration
- Create and review the first migration
- Add schema and domain rule tests where useful
- Do not add care, breeding, seed, pollen, observation, or sales tables

Suggested commit:

```text
feat: add initial plant management schema
```

## 4. Plant Management feature - complete

Build Plant Management in small vertical slices rather than one large change.

Planned checkpoints:

1. Plant validation and creation data layer, complete and committed
2. Add Plant through the browser and view the saved Plant, complete and committed
3. Plant list with useful empty, loading, and error states, complete and committed
4. Edit Plant, including parentage and purchase changes, complete and committed
5. Archive and restore Plant, complete and committed
6. Plant photos, storage, browser gallery, list images, thumbnail crops and confirmed photo deletion, complete

Each checkpoint should include the tests needed for its rules and regressions.

The owner has also approved square thumbnail crops during upload and on saved photos. This checkpoint adds four nullable photo fields in a new reviewed migration, an accessible shared selector and safe thumbnail revision replacement. Originals and full gallery display images remain unchanged. Legacy photos are not backfilled. See [thumbnail crops](plant-photo-crops.md).

The photo architecture checkpoint is committed. Cloudflare R2 with private storage is approved, with original retention, processed display and thumbnail copies, targeted failure cleanup and a primary photo uniqueness index. See [Plant photo storage](plant-photo-storage.md) for the full design.

The storage and data layer is complete, including its separately approved real R2 smoke test. The implementation and setup notes are in [Plant photo data layer](plant-photo-data-layer.md). The completed browser checkpoint, `feat: add plant photo gallery and list images`, connects a bounded upload form, primary selection, private image delivery and a gallery to Plant details, plus primary thumbnails on the responsive lists. It added no dependencies, schema changes or migrations. See [Plant photo browser workflow](plant-photo-browser-flow.md) for behaviour and review steps.

The subsequent approved [photo deletion checkpoint](plant-photo-deletion.md) adds only confirmed permanent photo removal, deterministic primary replacement and cleanup of that exact photo asset after the database commit. No schema change is needed. A general orphan/reconciliation scanner, broad bucket cleanup, authentication, bulk uploads and advanced image tools remain outside scope. No production host has been selected, so keep the approved server side 10 MiB transport and revisit host limits at deployment rather than implementing hypothetical alternatives now.

The approved shared photo infrastructure refactor moves only image processing, crop geometry, the private R2 transport, exact path safeguards, per asset cleanup and two small UI primitives behind compatible Plant wrappers. Plant behaviour and stored paths remain unchanged. EquipmentPhoto is the next separate consumer. See [Shared photo infrastructure](shared-photo-infrastructure.md).

## 5. Equipment inventory - complete

The owner has moved Equipment inventory ahead of Care. Equipment operating history, maintenance and electricity calculations are not part of this foundation.

The approved design is in [Equipment data model](equipment-data-model.md). The schema, data layer and [inventory browser workflow](equipment-browser-flow.md) checkpoints are committed: Equipment, optional EquipmentPurchase, reuse of Location, purchase cost checks, a separate EQP sequence and restricted creation/edit/archive/restore services and pages.

List, add, detail, edit, archive and restore are available through Equipment pages and server actions. No category table, EquipmentStatus, photos or Order model is included in inventory.

usesPower describes capability for consumption tracking, not current operation or inclusion in running cost totals. Shipping is allocated to each individual item. Energy history has its own approved design and checkpoints below.

## 6. Equipment energy history - current browser checkpoint

The owner approved [Equipment energy history](equipment-energy.md) before Care. The schema and [data layer checkpoint](energy-data-layer.md) are committed. The current [browser checkpoint](energy-browser-flow.md) adds Equipment energy forms/history and electricity tariff management using those services and calculations. No development energy records are seeded.

Decimal validation, Equipment stale protection, tariff timeline locking, explicit correction/void operations, exact derived calculations and missing coverage reporting are implemented and exposed in the browser. `/energy/tariffs` is the first Energy route; there is no Energy overview or main dashboard integration. Standing charges, time of use schedules, telemetry and cached monthly totals remain outside scope.

## 7. Equipment photos - schema checkpoint

The EquipmentPhoto schema checkpoint adds the separate metadata table, restrictive Equipment relationship, partial primary index and crop checks. The data-layer checkpoint adds Equipment-owned upload, primary, crop, deletion and metadata-read services using the shared mechanics and closed `equipment` namespace. The browser checkpoint adds private delivery routes, the Equipment detail gallery and active/archived list thumbnails without coupling Equipment to Plant composition. See [Equipment photo data model](equipment-photo-data-model.md) and [Equipment photo data layer](equipment-photo-data-layer.md).

## 8. Care tracking

- Watering events
- Fertiliser events
- Per plant care targets
- Calculated last watered and last fertilised dates
- Accessible care status indicators
- Care history

## 9. Expenses and later Equipment work

- General nursery expenses
- Equipment maintenance, after its own design review
- Safe recorded expense amounts without losing unknown versus zero values

Energy history and estimates have moved to the separate approved checkpoint above. General expenses must not double count future derived electricity estimates as recorded payments without a reviewed accounting rule.

## 9. Dashboard - read model checkpoint

The approved read-only coordination layer now provides Plant and Equipment counts, currency-separated acquisition coverage, current Energy projections through the existing exact calculator, the applicable tariff, and bounded recent-item metadata in one Repeatable Read snapshot. It does not contact photo storage and does not add schema, persistence, Care, Watering or homepage presentation.

The dashboard layout remains a separate reviewed checkpoint. Build it using real data from completed features.

- Plant totals
- Plant investment
- Equipment investment
- Total nursery investment
- Watering overview
- Recent useful activity where the available data supports it

## 10. MVP review

- Test the main nursery workflows on desktop and mobile
- Review accessibility and keyboard use
- Check error and empty states
- Test backup and recovery instructions
- Refine performance and image handling
- Review the documentation before tagging an MVP release

## After the MVP

Later phases can add breeding events and plans, pollen inventory, seed batches, seedlings, observations, ancestry, environmental data, sales, and reports. Each should receive its own data design stage before implementation.
