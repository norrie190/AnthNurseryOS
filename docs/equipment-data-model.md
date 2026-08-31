# Equipment inventory data model

## Checkpoint and scope

This is the approved Equipment inventory foundation. The committed schema contains Equipment, EquipmentPurchase, the reverse Equipment relation on Location, and an independent PostgreSQL reference sequence. Its restricted data layer handles creation, editing, archive/restore and reads. The current checkpoint adds the [Equipment browser workflow](equipment-browser-flow.md) using those services, without schema changes, maintenance, photos or energy tracking.

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

Both foreign keys use Restrict for deletion and ID updates. There is no cascade. Those foreign keys protect referenced records, but are not a complete prohibition on privileged SQL deletion. The application operations offer archive and restore rather than hard deletion.

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

Category uses text because new types should not require a database migration or a category administration workflow. The browser form offers suggested categories and custom entry. A category does not determine usesPower. Application validation now trims text, rejects blank names/categories, enforces the lengths below and normalises suggested category labels. The database itself requires nonnull names/categories.

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

Costs are integers from zero through PostgreSQL's signed integer maximum, 2147483647. Each field has a PostgreSQL CHECK constraint rejecting negative values. Null means unknown, while 0 is a known zero or free amount. Currency defaults to GBP without locking the schema to it. The varchar length is database enforced; the service uses the same runtime currency validation as Plant purchases.

shippingCostMinor is not automatically the full shipping cost of a shared order. If two items arrive in one £10 shipment, the user can allocate £2.50 to one and £7.50 to the other, recording 250 and 750. Both may retain the same orderReference. There is no Order model, automatic allocation or order total enforcement in this checkpoint.

An item may have no purchase record because it was gifted, already owned or its acquisition is not being recorded. Neither absence nor an unknown amount means zero. Do not store a calculated total acquisition cost. Later totals must distinguish unknown components and must not blindly combine different currencies.

## Indexes and reference sequence

The primary keys index id on both new tables. Equipment.reference and EquipmentPurchase.equipmentId each have a unique index. The only additional Equipment index is locationId, supporting its real current relationship. There are no category, archive, maintenance or future energy indexes.

public.equipment_reference_sequence is a persistent BIGINT sequence starting at 1, incrementing by 1, with CACHE 1, NO CYCLE and OWNED BY NONE. It is independent of public.plant_reference_sequence. The schema checkpoint created it without allocating references or connecting it to a column default. The creation service now calls nextval inside its transaction; no development records are seeded.

The creation service formats EQP-0001 through EQP-9999, then EQP-10000 and beyond, using bigint and at least four digits. Gaps are intentional: rollback does not return a number, and archive/restore never rewind the sequence. Allocation and commit order may differ. Imports and backup restores must coordinate sequence state rather than reset numbering. References are immutable through the application inputs; the unique index alone does not prohibit changing them through direct privileged SQL.

## Application data layer

The Equipment module uses strict Zod inputs, explicit field mapping and a small EquipmentError following Plant patterns. It does not import Plant services. Shared scalar cost, currency and purchase date rules live in src/lib/purchase-field-schemas.ts, with the existing Plant exports retained. No dependency or generic repository framework is added.

createEquipment(input) accepts name, usesPower, optional category/brand/model/serialNumber/notes/locationId and optional purchase. Name is required and usesPower must be an explicit boolean. Omitted category becomes Other. Equipment and optional Purchase are saved atomically. The returned record includes the generated id/reference/timestamps, current Location and optional Purchase.

updateEquipment(equipmentId, input) requires expectedUpdatedAt and accepts only editable scalar fields and an optional purchase patch. IDs, reference, createdAt, updatedAt, archivedAt and arbitrary Prisma operations are rejected as input fields. Nullable fields use omitted means preserve and explicit null means clear. An omitted purchase is unchanged; purchase: {} creates an unknown record if absent or preserves its fields and timestamps if present. purchase: null is rejected for both creation and editing. There is no purchase deletion. Accepted edits, including an empty patch, advance the Equipment timestamp; the returned shape matches creation.

Name is 1–200 characters; category is 1–80. Brand, model, serial number, seller and order reference allow up to 200 characters, and notes up to 10,000. Optional blank text becomes null after trimming. Null characters, malformed UUIDs, coerced booleans, fractional/negative/overflow costs and invalid calendar dates are rejected. Dates use YYYY-MM-DD and years 0001–9999, converted to a UTC midnight Date only for the PostgreSQL date boundary. Currency is trimmed, uppercased and checked against Intl.supportedValuesOf('currency'); this follows the runtime data, not a complete historical currency catalogue. Changing currency never converts amounts. The browser boundary converts decimal amounts exactly; these operations still take integer minor units only.

Suggested categories are Grow Light, Extraction Fan, Circulation Fan, Humidifier, Controller, Sensor / Meter, Grow Tent, Shelving / Rack, Heating, Cooling, Watering and Other. Known labels are recognised regardless of case and spacing; custom nonblank text is retained with whitespace cleaned up. Category never infers usesPower.

New Location assignments must exist and not be archived. Editing may preserve a currently assigned archived Location or explicitly move/clear it. Use the existing selected Location rules, without inventing ancestor archive behaviour or Location management here.

Equipment edits lock the Equipment row with FOR NO KEY UPDATE, compare expectedUpdatedAt while locked, then take any required Location FOR SHARE lock. Creation also locks its selected Location with FOR SHARE before allocating a reference. Transactions use READ COMMITTED. Each accepted logical edit, including purchase only changes, sets Equipment.updatedAt to the later of the server clock or the prior timestamp plus one millisecond. A stale edit fails without merging or retrying. There is no Plant parentage advisory lock.

archiveEquipment(equipmentId, { expectedUpdatedAt }) and restoreEquipment use the same row lock. They return { equipment, changed }. If the desired archive state is already present, they return changed: false without replacing either timestamp, even with the valid old token from a repeated request. A real state transition requires the current token and advances updatedAt. Archiving does not change power capability, reference, Location, Purchase or any other Equipment information. Archived Equipment remains readable and editable.

EquipmentError codes are VALIDATION_FAILED, LOCATION_UNAVAILABLE, NOT_FOUND, STALE_UPDATE and CONFLICT. Validation includes field issues and retains the Zod cause. Known database constraint/concurrency conflicts become CONFLICT with their cause preserved. Unexpected infrastructure failures remain the original error for server diagnostics; the browser boundary maps those safely rather than displaying raw database messages.

getEquipmentList reads non archived items ordered by createdAt descending then reference ascending. getArchivedEquipmentList uses archivedAt descending then reference ascending. Both return id/reference/name/category/brand/model/usesPower, dates and a small Location summary. getEquipmentById includes Location and Purchase for active or archived items and returns null for missing or malformed IDs. getEquipmentLocationOptions returns non archived choices with immediate parent/name labels in name then UUID order. The detail record separately retains any currently assigned archived Location for the edit form. There is no full hierarchy traversal, generic query layer or application caching.

## Browser workflow and later domains

The implemented browser routes are /equipment, /equipment/new, /equipment/[equipmentId], /equipment/[equipmentId]/edit and /equipment/archived. Services, validation, forms, actions and reads stay in the Equipment module. The [browser workflow](equipment-browser-flow.md) documents presentation, money entry, safe error handling and archive confirmation.

EquipmentPhoto is the approved next separate ownership model. It will attach through Equipment.id and consume the neutral processing, crop, R2 and targeted cleanup mechanics described in [Shared photo infrastructure](shared-photo-infrastructure.md), without making PlantPhoto polymorphic. This refactor does not add the EquipmentPhoto model, migration, services, routes or UI. The committed [energy history foundation](equipment-energy.md) adds Equipment.powerPeriods and the EquipmentPowerPeriod and ElectricityTariff tables. The current [energy data layer](energy-data-layer.md) implements restricted operations and exact calculations without changing that schema. Equipment editing rejects disabling usesPower while nonvoid current/future periods remain, under its existing row lock. Historical records and archive independence are preserved. Inventory purchase amounts and both reference sequences remain unchanged.

## Verification

Database tests run only against the guarded local test database. Equipment, purchase, Location and any Plant relationship fixtures live in transactions that are always rolled back. The schema tests inspect the EQP sequence catalogue without allocating it and compare both sequence states before and after. They also cover generated Prisma UUIDs/timestamps, nullable fields, costs, references, foreign keys, archive field preservation, shared Locations, category text, repeated order references and the applied migrations.

The service tests run real operations inside rolled back transactions. Savepoints isolate each operation within its fixture. Transactional purchase failure triggers prove that related failures roll back Equipment changes too. Four concurrent creation transactions allocate distinct EQP references, then roll back; the next allocation must be newer. These tests intentionally advance only the test EQP sequence and verify the ANT state is unchanged by Equipment operations. No test assumes EQP starts at 1.

The full database regression suite also includes existing Plant creation tests, which intentionally advance the test ANT sequence. Both test sequences can therefore contain gaps after the full suite. Development row fingerprints and both development sequence states are checked before and after; no development fixtures, R2 calls, schema resets or migrations are used for this data layer checkpoint.
