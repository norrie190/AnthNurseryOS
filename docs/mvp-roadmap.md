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

## 5. Equipment inventory - current

The owner has moved Equipment inventory ahead of Care. Equipment operating history, maintenance and electricity calculations are not part of this foundation.

The approved design is in [Equipment data model](equipment-data-model.md). The current checkpoint is schema only: Equipment, optional EquipmentPurchase, reuse of the existing Location model, purchase cost checks and a separate EQP sequence. Both new migrations have been reviewed and applied to development and the guarded test database. No Equipment records are seeded, no reference is allocated, and the Equipment page is still a placeholder. The sequence is included now at the owner's request, not delayed until the data layer.

Next reviewable checkpoints will add the restricted Equipment data layer, followed by the list/add/detail/edit/archive/restore browser flow. Those services and screens are not implemented yet. No category table, EquipmentStatus, photos, Order model or energy tables are included.

usesPower describes capability for consumption tracking, not current operation or inclusion in running cost totals. Shipping is allocated to each individual item. Historical energy periods, tariffs, fractional pence and numeric storage decisions require a separate future design.

## 6. Care tracking

- Watering events
- Fertiliser events
- Per plant care targets
- Calculated last watered and last fertilised dates
- Accessible care status indicators
- Care history

## 7. Expenses and later Equipment operation tracking

- General nursery expenses
- Equipment maintenance and operation history, after their own design review
- Electricity tariff history and running costs, after their own design review
- Safe recorded expense amounts without losing unknown versus zero values

Inventory alone does not calculate electricity use. Wattage/schedules, effective periods, tariff precision and historical calculation rules remain undecided implementation work. Do not add their tables or choose their numeric representation during the Equipment schema checkpoint.

## 8. Dashboard

Build the approved dashboard layout using real data from completed features.

- Plant totals
- Plant investment
- Equipment investment
- Total nursery investment
- Watering overview
- Recent useful activity where the available data supports it

## 9. MVP review

- Test the main nursery workflows on desktop and mobile
- Review accessibility and keyboard use
- Check error and empty states
- Test backup and recovery instructions
- Refine performance and image handling
- Review the documentation before tagging an MVP release

## After the MVP

Later phases can add breeding events and plans, pollen inventory, seed batches, seedlings, observations, ancestry, environmental data, sales, and reports. Each should receive its own data design stage before implementation.
