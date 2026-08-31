# Equipment inventory data model

## Checkpoint and scope

This is the approved Equipment inventory foundation. The schema checkpoint adds only Equipment, EquipmentPurchase, the reverse Equipment relation on the existing Location model, and an independent PostgreSQL reference sequence. It does not implement Equipment services, reference formatting, forms, pages, archive actions, maintenance, photos or energy tracking. The current /equipment page remains a placeholder.

Equipment inventory now follows Plant Management, before Care, as requested by the owner. The sequence is included in this schema checkpoint rather than waiting for the later data layer. The migration details are in [database migrations](database-migrations.md).

## Relationships

```text
Equipment
├── 0 or 1 EquipmentPurchase
└── 0 or 1 current Location

Location
├── 0 to many Plants
├── 0 to many Equipment items
└── 0 or 1 parent Location
```

Each Equipment record is one physical item. Two identical grow lights have two records and two references, not one shared quantity. An EquipmentPurchase belongs to exactly one Equipment record; equipmentId is unique. Existing Location hierarchy and name uniqueness rules remain unchanged. A grow tent as equipment is a physical asset; a Location named Grow Tent 1 represents a space. Neither record automatically creates the other.

Both foreign keys use Restrict for deletion and ID updates. There is no cascade. Those foreign keys protect referenced records, but are not a complete prohibition on privileged SQL deletion. The eventual application must offer archive and restore rather than hard deletion.

## Equipment fields

| Field        | Prisma / PostgreSQL        | Required and default         | Meaning                                            |
| ------------ | -------------------------- | ---------------------------- | -------------------------------------------------- |
| id           | String / uuid              | Required, Prisma uuid()      | Internal identity for relationships                |
| reference    | String / text              | Required, unique, no default | Permanent human reference, eventually EQP-0001     |
| name         | String / text              | Required, no default         | Useful name for this physical item                 |
| category     | String / text              | Required, Other              | Flexible category without a category table or enum |
| brand        | String? / text             | Optional, null               | Manufacturer or brand when known                   |
| model        | String? / text             | Optional, null               | Product model when known                           |
| serialNumber | String? / text             | Optional, null               | Item identifier; not globally unique               |
| notes        | String? / text             | Optional, null               | Other inventory notes                              |
| usesPower    | Boolean / boolean          | Required, no default         | Capability for electrical consumption tracking     |
| locationId   | String? / uuid             | Optional, null               | Existing current Location                          |
| archivedAt   | DateTime? / timestamptz(3) | Optional, null               | Hidden from active inventory when populated        |
| createdAt    | DateTime / timestamptz(3)  | Required, now()              | Record creation instant                            |
| updatedAt    | DateTime / timestamptz(3)  | Required, Prisma @updatedAt  | Current record timestamp                           |

Names, brands, models and serial numbers are not unique: similar or identical physical items remain separate records. There is no EquipmentStatus. Active means not archived, not switched on, working or in service. UUID generation and updatedAt behaviour follow Plants: Prisma supplies them, not new database triggers or UUID defaults. Direct SQL inserts must supply id and updatedAt.

Category uses text because new types should not require a database migration or a category administration workflow. Suggested categories and custom entry belong in the later form. A category does not determine usesPower. The current database requires nonnull names/categories; trimming, blank rejection, text length rules and category suggestions are application validation for the next checkpoint, not implemented here.

usesPower means: “This equipment is capable of having electrical consumption tracked by AnthNurseryOS.” It does not mean currently switched on, connected, consuming electricity, or automatically included in running cost calculations. The caller will explicitly choose it during creation. Later EquipmentPowerPeriod records, not this boolean, will determine historical operating consumption.

## EquipmentPurchase fields

| Field               | Prisma / PostgreSQL       | Required and default        | Meaning                                           |
| ------------------- | ------------------------- | --------------------------- | ------------------------------------------------- |
| id                  | String / uuid             | Required, Prisma uuid()     | Internal purchase identity                        |
| equipmentId         | String / uuid             | Required, unique            | Owning Equipment record                           |
| seller              | String? / text            | Optional, null              | Seller or source                                  |
| orderReference      | String? / text            | Optional, null              | Seller order reference; not unique                |
| purchaseDate        | DateTime? / date          | Optional, null              | Calendar date, not an instant                     |
| equipmentPriceMinor | Int? / integer            | Optional, null              | Item price in integer minor units                 |
| shippingCostMinor   | Int? / integer            | Optional, null              | Shipping amount allocated to this individual item |
| otherCostMinor      | Int? / integer            | Optional, null              | Other acquisition costs for this item             |
| currency            | String / varchar(3)       | Required, GBP               | Currency for all three purchase amounts           |
| createdAt           | DateTime / timestamptz(3) | Required, now()             | Purchase record creation instant                  |
| updatedAt           | DateTime / timestamptz(3) | Required, Prisma @updatedAt | Purchase record timestamp                         |

Costs are integers from zero through PostgreSQL's signed integer maximum, 2147483647. Each field has a PostgreSQL CHECK constraint rejecting negative values. Null means unknown, while 0 is a known zero or free amount. Currency defaults to GBP without locking the schema to it. The varchar length is database enforced; recognised currency validation belongs in the later service.

shippingCostMinor is not automatically the full shipping cost of a shared order. If two items arrive in one £10 shipment, the user can allocate £2.50 to one and £7.50 to the other, recording 250 and 750. Both may retain the same orderReference. There is no Order model, automatic allocation or order total enforcement in this checkpoint.

An item may have no purchase record because it was gifted, already owned or its acquisition is not being recorded. Neither absence nor an unknown amount means zero. Do not store a calculated total acquisition cost. Later totals must distinguish unknown components and must not blindly combine different currencies.

## Indexes and reference sequence

The primary keys index id on both new tables. Equipment.reference and EquipmentPurchase.equipmentId each have a unique index. The only additional Equipment index is locationId, supporting its real current relationship. There are no category, archive, maintenance or future energy indexes.

public.equipment_reference_sequence is a persistent BIGINT sequence starting at 1, incrementing by 1, with CACHE 1, NO CYCLE and OWNED BY NONE. It is independent of public.plant_reference_sequence. This checkpoint creates it without calling nextval, connecting it to a column default or creating Equipment records.

The later creation service will allocate a value and format EQP-0001 through EQP-9999, then EQP-10000 and beyond, using at least four digits. Gaps are intentional: rollback does not return a number, and archive/restore must not rewind the sequence. Allocation and commit order may differ. Imports and backup restores must coordinate sequence state rather than reset numbering. Reference immutability will follow Plant application rules; the unique index alone does not prohibit changing it through direct privileged SQL.

## Approved next stages, not implemented

The Equipment module will use strict inputs, explicit field mapping and small Equipment errors following Plant patterns. Creation must save Equipment and optional Purchase atomically. Editing must reject IDs, reference, createdAt, archivedAt and arbitrary Prisma operations. Nullable fields use omitted means preserve and explicit null means clear. An omitted purchase is unchanged; purchase: {} creates an unknown record if absent or preserves fields if present. A purchase record cannot be deleted through editing.

New Location assignments must exist and not be archived. Editing may preserve a currently assigned archived Location or explicitly move/clear it. Use the existing selected Location rules, without inventing ancestor archive behaviour or Location management here.

Equipment edits will lock the Equipment row with FOR NO KEY UPDATE, compare expectedUpdatedAt while locked, then take any required Location FOR SHARE lock. Each accepted logical edit, including purchase only changes, must advance Equipment.updatedAt strictly beyond its prior millisecond value. Archive/restore will use the same stale state rules as Plants, with unchanged repeated requests preserving existing timestamps. There is no need for a Plant parentage advisory lock.

Later browser routes are /equipment, /equipment/new, /equipment/[equipmentId], /equipment/[equipmentId]/edit and /equipment/archived. Keep services, validation, forms and reads in the Equipment module. None of those screens or actions is added by this checkpoint.

EquipmentPhoto may later attach through Equipment.id and reuse appropriate image/R2 infrastructure without making PlantPhoto polymorphic. EquipmentPowerPeriod may later attach through Equipment.id, with effective operating periods combined with electricity tariff history. There are no power/tariff tables, wattage, schedule, hours per day, running totals, electricity calculations or dashboard integration now. Numeric storage for future wattage, tariffs and calculations is deliberately undecided; fractional pence and precision must be reviewed in that future design.

## Verification

Database tests run only against the guarded local test database. Equipment, purchase, Location and any Plant relationship fixtures live in transactions that are always rolled back. The schema tests inspect the EQP sequence catalogue without allocating it and compare both sequence states before and after. They also cover generated Prisma UUIDs/timestamps, nullable fields, costs, references, foreign keys, archive field preservation, shared Locations, category text, repeated order references and the applied migrations.

For this checkpoint, regression database tests exclude the existing Plant creation and browser creation suites because those deliberately advance the test ANT sequence. The remaining database regressions and full unit/component suite still run. Existing Plant/Location row fingerprints, custom constraints/indexes and ANT state are compared before and after migration and testing. No development fixtures, real storage writes or schema resets are used.
