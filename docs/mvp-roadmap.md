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

## 4. Plant Management feature - current

Build Plant Management in small vertical slices rather than one large change.

Planned checkpoints:

1. Plant validation and creation data layer, complete and committed
2. Add Plant through the browser and view the saved Plant, complete and committed
3. Plant list with useful empty, loading, and error states, complete and committed
4. Edit Plant, including parentage and purchase changes, complete and committed
5. Archive and restore Plant, complete and committed
6. Plant photos, storage architecture approved; documentation checkpoint in review

Each checkpoint should include the tests needed for its rules and regressions.

The current checkpoint is `docs: define plant photo storage architecture`. Cloudflare R2 with private storage is approved, with original retention, processed display and thumbnail copies, targeted failure cleanup and a future primary photo uniqueness index. This checkpoint records the decisions only. It does not configure storage, install dependencies, change Prisma, create migrations or implement uploads, processing, the gallery or list thumbnails. See [Plant photo storage](plant-photo-storage.md) for the full design.

After documentation review, photo delivery is split into two further checkpoints. `feat: add plant photo storage and data layer` will add storage integration, validation and processing, restricted photo operations, targeted cleanup, the new reviewed partial unique index migration and tests. `feat: add plant photo gallery and list images` will connect the browser workflow and primary thumbnails to the existing pages.

The first implementation will not include photo deletion, a general orphan/reconciliation scanner, broad bucket cleanup, authentication, bulk uploads or advanced image tools. No production host has been selected, so keep the approved server side 10 MiB transport and revisit host limits at deployment rather than implementing hypothetical alternatives now.

## 5. Care tracking

- Watering events
- Fertiliser events
- Per plant care targets
- Calculated last watered and last fertilised dates
- Accessible care status indicators
- Care history

## 6. Equipment and expenses

- Equipment records and archive/status behaviour
- Purchase and maintenance information
- General nursery expenses
- Equipment running expenses
- Safe money calculations using minor units

## 7. Dashboard

Build the approved dashboard layout using real data from completed features.

- Plant totals
- Plant investment
- Equipment investment
- Total nursery investment
- Watering overview
- Recent useful activity where the available data supports it

## 8. MVP review

- Test the main nursery workflows on desktop and mobile
- Review accessibility and keyboard use
- Check error and empty states
- Test backup and recovery instructions
- Refine performance and image handling
- Review the documentation before tagging an MVP release

## After the MVP

Later phases can add breeding events and plans, pollen inventory, seed batches, seedlings, observations, ancestry, environmental data, sales, and reports. Each should receive its own data design stage before implementation.
