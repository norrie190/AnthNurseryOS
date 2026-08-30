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

1. Plant validation and creation data layer, implemented for review
2. Plant list with useful empty, loading, and error states
3. Add Plant
4. Plant details
5. Edit Plant
6. Archive and restore Plant
7. Parentage and purchase information
8. Plant photos after the storage approach is agreed

Each checkpoint should include the tests needed for its rules and regressions.

The current milestone is `feat: add plant creation data layer`. It adds strict creation input, the Prisma runtime connection, automatic ANT allocation through a new sequence migration, atomic Plant/Parentage/Purchase creation and tests. Parentage and purchase can already be supplied to the internal operation; their UI remains later work. No server actions, forms, updates, archive/restore operations or photo handling are included. See `plant-creation.md` for the operation contract.

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
