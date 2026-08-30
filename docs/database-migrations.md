# Database migrations and tests

## Initial Plant Management migration

`prisma/migrations/20260830195606_init_plant_management/migration.sql` was generated from the approved Prisma schema using `prisma migrate dev --name init_plant_management --create-only`. The generated SQL was reviewed before applying it. It creates only Plant, PlantParentage, PlantPurchase, PlantPhoto, Location, and PlantStatus. Prisma separately maintains its `_prisma_migrations` history table.

Three PostgreSQL check constraints reject negative `plantPriceMinor`, `shippingCostMinor`, and `otherCostMinor` values. A check such as `plantPriceMinor >= 0` permits null, so unknown costs remain different from a known zero cost. These checks protect both inserts and updates, including writes outside Prisma.

The generated `Location_parentLocationId_name_key` unique index uses PostgreSQL `NULLS NOT DISTINCT`. Locations with a null parent belong to the same root group for name uniqueness. Different parent locations can still contain children with the same name. The same index covers both cases, so no additional root index is needed. Archived location names remain reserved within their parent group.

The migration is enclosed in `BEGIN` and `COMMIT` so the schema and custom constraints are applied together. UUID generation and `updatedAt` remain Prisma responsibilities, as approved; this migration does not introduce database UUID defaults, timestamp triggers, or automatic ANT references.

## Keeping custom SQL

Prisma's schema cannot express these check constraints or the index's null handling. The migration is the source of truth for those details. Keep its SQL and `migration_lock.toml` in Git. Never edit an applied migration; use a new migration for any later change.

Review every future migration for accidental removal or replacement of these constraints. Prisma schema comparison alone is not proof that custom SQL is intact. The database tests check the installed constraints and their behaviour. Do not replace migration deployment with `prisma db push`, which is not a substitute for this reviewed migration history.

## Applying migrations

`pnpm db:deploy` applies existing migration files to `DATABASE_URL`. It does not generate a migration. `pnpm db:migrate:test` applies the same migration files to `TEST_DATABASE_URL` through a separate Prisma process, without changing `.env`.

The test migration command requires a local PostgreSQL URL, a database name ending in `_test`, the public schema, and a different database name from development. Only the optional `schema=public` URL parameter is accepted, so other parameters cannot redirect the connection. There is no fallback to the development database.

## Database tests

Run `pnpm test` for unit and UI tests without a database. Run `pnpm test:db` separately after starting PostgreSQL and applying the test migration. The database suite fails rather than skips if PostgreSQL or the migrated schema is unavailable.

Database tests use `pg` and its TypeScript definitions as development dependencies. Direct SQL lets tests assert PostgreSQL error codes and constraint names without introducing an application data layer. Prisma connection checks and migration commands remain separate.

The tests distinguish unique violations (`23505`), check violations (`23514`), missing foreign key targets (`23503`), and restricted deletion (`23001`). This checks the intended database rule rather than accepting any error as a passing test.

Each database test uses a single connection and a transaction that is always rolled back, including after an expected constraint error. Fixtures have random test references and IDs. There are no database resets, table truncations, or committed fixture records. Tests run sequentially and only use the guarded test database URL. The connection also checks the actual database name and PostgreSQL 18 version before any fixture is written.
