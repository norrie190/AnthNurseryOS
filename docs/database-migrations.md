# Database migrations and tests

## Initial Plant Management migration

`prisma/migrations/20260830195606_init_plant_management/migration.sql` was generated from the approved Prisma schema using `prisma migrate dev --name init_plant_management --create-only`. The generated SQL was reviewed before applying it. It creates only Plant, PlantParentage, PlantPurchase, PlantPhoto, Location, and PlantStatus. Prisma separately maintains its `_prisma_migrations` history table.

Three PostgreSQL check constraints reject negative `plantPriceMinor`, `shippingCostMinor`, and `otherCostMinor` values. A check such as `plantPriceMinor >= 0` permits null, so unknown costs remain different from a known zero cost. These checks protect both inserts and updates, including writes outside Prisma.

The generated `Location_parentLocationId_name_key` unique index uses PostgreSQL `NULLS NOT DISTINCT`. Locations with a null parent belong to the same root group for name uniqueness. Different parent locations can still contain children with the same name. The same index covers both cases, so no additional root index is needed. Archived location names remain reserved within their parent group.

The migration is enclosed in `BEGIN` and `COMMIT` so the schema and custom constraints are applied together. UUID generation and `updatedAt` remain Prisma responsibilities, as approved; this migration does not introduce database UUID defaults, timestamp triggers, or automatic ANT references.

## Keeping custom SQL

Prisma's schema cannot express these check constraints or the index's null handling. The migration is the source of truth for those details. Keep its SQL and `migration_lock.toml` in Git. Never edit an applied migration; use a new migration for any later change.

Review every future migration for accidental removal or replacement of these constraints. Prisma schema comparison alone is not proof that custom SQL is intact. The database tests check the installed constraints and their behaviour. Do not replace migration deployment with `prisma db push`, which is not a substitute for this reviewed migration history.

## Plant reference sequence migration

`prisma/migrations/20260830222017_add_plant_reference_sequence/migration.sql` is a new custom SQL migration. Prisma has no model change to generate for this standalone sequence, so its reviewed SQL is written directly in the migration history. The original migration and Prisma models are unchanged.

It creates `public.plant_reference_sequence` as a persistent bigint sequence starting at 1, incrementing by 1, with `CACHE 1`, `NO CYCLE` and no column ownership. Both databases contained zero Plant rows before it was applied, so there is no import or maximum reference detection logic. The sequence must survive later migrations along with the existing custom constraints.

The creation operation calls `nextval` inside its transaction, then formats the result as an ANT reference. Sequence advances are not rolled back. Failed creations, test rollbacks and database recovery may leave gaps. Archiving or deleting a row does not rewind the sequence. Never reset it to tidy the numbering. Imports of existing ANT references must coordinate sequence advancement before normal creation resumes, and restoring an older backup requires attention to references issued since that backup.

The sequence is allocation infrastructure, not an additional Plant property or future feature model. It does not enforce reference immutability against direct SQL. That remains an application responsibility, with the existing unique constraint as duplicate protection.

## Primary photo index migration

`prisma/migrations/20260831113000_add_primary_plant_photo_index/migration.sql` adds a PostgreSQL partial unique index on PlantPhoto.plantId, limited to rows where isPrimary is true. It rejects a second primary for the same Plant while allowing multiple nonprimary photographs and independent primaries on other Plants. Atomic selection changes in the photo service complement this database constraint. No new PlantPhoto fields are required.

This is a new migration, enclosed in BEGIN and COMMIT; neither earlier migration was edited. Before application, both local databases had zero photo records and no conflicting primaries. Development had one existing Plant, which was left untouched. The migration was reviewed before deployment. On another database, check for conflicting existing primary records before applying it; if any exist, stop for review rather than silently changing data. Retain the constraint in migration history and review future migrations for accidental removal, alongside the existing cost checks, Location uniqueness and ANT sequence.

The photo database tests verify the installed index and migration, reject multiple primaries, permit multiple nonprimary rows, and exercise atomic primary changes and rollback. They use only the guarded PostgreSQL test database and rolled back fixtures. The approved design is in [Plant photo storage](plant-photo-storage.md), with operation details in [Plant photo data layer](plant-photo-data-layer.md).

## Thumbnail crop migration

`20260831230000_add_plant_photo_thumbnail_crop` adds nullable cropX, cropY and cropSize as double precision and derivativeRevision as UUID. The reviewed SQL uses BEGIN/COMMIT and adds PlantPhoto_crop_consistency_check (all four null or all four populated) and PlantPhoto_crop_ranges_check (x/y from zero inclusive to one exclusive, size greater than zero and at most one). PostgreSQL NaN and infinity fail the upper/lower bounds. Image dependent bounds remain a service rule. Prisma cannot express these checks, so retain the custom migration SQL.

Preflight found one Plant with one legacy photo in development and no PlantPhoto records in test. The existing photo had a valid original key. Both databases had none of the new columns. The migration was inspected before applying it to development and the guarded test database. There is no backfill, object rewrite or ANT sequence change. Previous migrations, the primary index and historical records remain intact. See [thumbnail crops](plant-photo-crops.md).

## Equipment inventory foundation

This schema only checkpoint adds two new migrations. Existing migrations are unchanged.

`20260831233000_init_equipment_inventory` contains Prisma generated SQL from `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`. This read only generation step produced only the two approved new tables, their keys and the Equipment Location index. The SQL was inspected before being saved as a new migration, then three custom CHECK constraints and BEGIN/COMMIT were added and reviewed before deployment. No shadow database reset or db push was used.

Equipment has a UUID primary key, unique required text reference, required name, text category default Other, optional brand/model/serialNumber/notes, required boolean usesPower without a default, optional Location and archive date, and millisecond timestamptz creation/update fields. EquipmentPurchase has a UUID primary key, unique required Equipment relationship, optional seller/order/date/costs, GBP currency default in varchar(3), and the same timestamp convention. The only Location schema addition is a Prisma reverse relation; it produces no Location table alteration. UUID generation and updatedAt remain Prisma responsibilities.

Equipment_locationId_fkey and EquipmentPurchase_equipmentId_fkey both specify ON DELETE RESTRICT ON UPDATE RESTRICT. Indexes are Equipment_pkey, Equipment_reference_key, Equipment_locationId_idx, EquipmentPurchase_pkey and EquipmentPurchase_equipmentId_key. There are no unrelated indexes.

Prisma cannot express the three EquipmentPurchase CHECK constraints. They are kept in the reviewed migration SQL, just like the Plant cost checks:

```sql
ALTER TABLE "EquipmentPurchase"
    ADD CONSTRAINT "EquipmentPurchase_equipmentPriceMinor_nonnegative" CHECK ("equipmentPriceMinor" >= 0),
    ADD CONSTRAINT "EquipmentPurchase_shippingCostMinor_nonnegative" CHECK ("shippingCostMinor" >= 0),
    ADD CONSTRAINT "EquipmentPurchase_otherCostMinor_nonnegative" CHECK ("otherCostMinor" >= 0);
```

Null passes a check and remains unknown; zero remains a known zero cost. shippingCostMinor is the share allocated to that individual item, not an automatic copy of total shared order shipping. There is no Order model or automatic allocation. These rules must survive future migrations.

`20260831233100_add_equipment_reference_sequence` creates only the independent sequence. Its complete SQL is:

```sql
-- Independent allocation infrastructure for the later Equipment creation service.
-- No records or references are allocated here. Imports must coordinate the sequence.
BEGIN;

CREATE SEQUENCE public.equipment_reference_sequence
    AS BIGINT
    START WITH 1
    INCREMENT BY 1
    MINVALUE 1
    NO MAXVALUE
    CACHE 1
    NO CYCLE
    OWNED BY NONE;

COMMIT;
```

The later data layer will format its bigint allocation as EQP-0001 and beyond EQP-9999. Neither migration creates Equipment records, calls nextval or connects reference to a column default. There is no import/backfill logic because the Equipment tables are new. Do not reset numbering to remove gaps. Equipment reference immutability, validation, stale editing and archive operations are future application behaviour, not added SQL triggers.

Preflight found no Equipment tables or EQP sequence in either local database. Development contained one Plant, its parentage and purchase, two photos and no Locations; the test database contained no nursery rows. Existing row fingerprints, custom constraints/indexes and ANT sequence states were captured before deployment. Both new migrations were inspected and deployed to development and the guarded test database; both histories contain six completed migrations. The existing rows, constraints, indexes and ANT definitions/states matched afterwards. Both new Equipment tables remain empty and EQP remains at last_value 1 with is_called false in both databases.

`equipment-schema.test.ts` uses rolled back fixtures and checks the actual PostgreSQL catalogue, costs, defaults, required fields, foreign keys, indexes, dates and generated Prisma relationships. It only reads sequence state. For this checkpoint the relevant database regression command is:

```text
pnpm test:db --exclude tests/database/plant-service.test.ts --exclude tests/database/plant-browser-boundary.test.ts
```

Those two existing creation suites intentionally allocate ANT values, so they are excluded here to preserve even the test ANT state. The full unit/component suite still runs. This does not disable those tests in the repository or change the normal full database command for later milestones. No test resets a database, truncates a table or changes development fixtures.

## Equipment energy history foundation

`20260831235000_add_equipment_energy_history` creates EquipmentPowerPeriod and ElectricityTariff only, plus the Equipment period lookup index and restricted Equipment FK. Prisma generated the table/index/FK SQL with `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`. That read only output was inspected, then saved as a new migration with the reviewed custom SQL and BEGIN/COMMIT. Previous migrations are unchanged. There is no shadow database reset, db push, backfill, energy seed or sequence allocation.

Preflight verified both local PostgreSQL 18 databases offered btree_gist 1.8 and had neither energy table. The migration deliberately installs it with `CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA public`. Hosted PostgreSQL must support this extension and permit installation; stop if it cannot, rather than weakening overlap protection. The extension and table creation are transactional.

Custom CHECK constraints enforce power from 0 to 100000 W, hours from 0 to 24, tariffs from 0 to 1000 p/kWh, GBP currency, finite calendar dates with end later than start, and a nonblank correctionReason whenever voidedAt is populated. The reason check explicitly rejects null and whitespace only text; notes/reasons stay TEXT. Bounded numeric comparisons also reject NaN. Declared decimal columns reject numeric infinities, but round excess fractional input, which later application validation must reject before insertion.

`EquipmentPowerPeriod_no_overlap` is an EXCLUDE USING gist constraint combining equipmentId equality with `daterange(effectiveFrom, effectiveTo, '[)') &&`, limited to `voidedAt IS NULL`. `ElectricityTariff_no_overlap` uses the same range/predicate without Equipment scoping: there is one nursery tariff timeline. Adjacent and gapped intervals are valid; open ends overlap all later covered dates. Voided rows stay stored but no longer block dates. These constraints also protect updates and unvoiding. They are not fully represented in Prisma, so migration SQL and behavioural tests remain the source of truth.

The indexes are the two UUID primary keys, the two GiST indexes created by exclusion constraints, and `EquipmentPowerPeriod_equipmentId_effectiveFrom_idx`. There are no extra reporting indexes or generated range columns. The only new FK is `EquipmentPowerPeriod_equipmentId_fkey`, with ON DELETE RESTRICT ON UPDATE RESTRICT. Equipment's reverse relation requires no stored Equipment column. ElectricityTariff has no Equipment FK. Existing Plant/Equipment cost checks, Location root uniqueness, photo checks/indexes and ANT/EQP sequences must remain intact.

The [energy schema tests](../tests/database/energy-schema.test.ts) use the guarded test database with all fixtures rolled back, including generated Prisma model coverage. This new suite does not allocate ANT or EQP references. Existing full regression tests do allocate test references and may leave intentional test sequence gaps. Development row fingerprints and both development sequence states are compared before and after verification. No services, calculations or energy UI are included; see [Equipment energy history](equipment-energy.md).

## Applying migrations

`pnpm db:deploy` applies existing migration files to `DATABASE_URL`. It does not generate a migration. `pnpm db:migrate:test` applies the same migration files to `TEST_DATABASE_URL` through a separate Prisma process, without changing `.env`.

The test migration command requires a local PostgreSQL URL, a database name ending in `_test`, the public schema, and a different database name from development. Only the optional `schema=public` URL parameter is accepted, so other parameters cannot redirect the connection. There is no fallback to the development database.

## Database tests

Run `pnpm test` for unit and UI tests without a database. Run `pnpm test:db` separately after starting PostgreSQL and applying the test migration. The database suite fails rather than skips if PostgreSQL or the migrated schema is unavailable.

The original database tests use `pg` and its TypeScript definitions as development dependencies. Direct SQL lets them assert PostgreSQL error codes and constraint names. The creation tests additionally use the actual Prisma PostgreSQL adapter and the public `createPlant` operation. Prisma connection checks and migration commands remain separate.

The tests distinguish unique violations (`23505`), check violations (`23514`), missing foreign key targets (`23503`), and restricted deletion (`23001`). This checks the intended database rule rather than accepting any error as a passing test.

Each fixture transaction is always rolled back, including after an expected constraint error. There are no database resets, table truncations, or committed fixture records. Test files run sequentially and only use the guarded test database URL. The connection also checks the actual database name and PostgreSQL 18 version before any fixture is written.

Creation tests replace the application connection binding with a guarded test client. A test only wrapper around that client's transaction boundary adds fixtures, runs the real creation callback, then forces a rollback on success. Prisma executes all queries normally; failed SQL still escapes the real transaction and causes rollback. No test hooks or injectable dependencies were added to production code.

The concurrency test starts six real transactions on separate PostgreSQL connections and holds them at a barrier before creation. Every fixture transaction is rolled back. The rollback failure test installs a temporary function and transactional trigger that reject a purchase insert only after confirming the Plant and parentage already exist. The function, trigger and rows all disappear on rollback, and the test verifies there are no retained records or trigger. Sequence tests compare allocations rather than expecting the counter to start at 1 on each run.
