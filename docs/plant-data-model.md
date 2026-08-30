# Initial Plant Management data model

## Status of this document

This is the proposed Plant Management model for final review. It records the product decisions before any Prisma models or migrations are written.

This stage includes Plant, PlantParentage, PlantPurchase, PlantPhoto, and Location only. Care, observations, breeding, pollen, seed batches, seedlings, ancestry, and sales remain outside the schema until their own phases.

## Simple relationship view

```text
Plant
├── 0 or 1 PlantParentage
├── 0 or 1 PlantPurchase
├── 0 to many PlantPhoto records
└── 0 or 1 current Location

Location
├── 0 to many Plants
└── 0 or 1 parent Location
```

The UI can present all of this as one Plant record. The separate database models are there because parentage and purchase are optional groups of information, photos are one to many, and locations are reusable across many plants.

Every related record connects through the internal `Plant.id`. The visible `ANT-XXXX` reference is for people and is not used as a foreign key.

## Plant

Plant holds the small set of values that describe the current core record.

| Field        | Required | Purpose                                                                 |
| ------------ | -------- | ----------------------------------------------------------------------- |
| `id`         | Yes      | Generated, opaque internal primary key. Never shown as the plant label. |
| `reference`  | Yes      | Unique and immutable reference such as `ANT-0001`.                      |
| `name`       | No       | Display name, hybrid name, or other useful plant name.                  |
| `status`     | Yes      | Current status. Defaults to `GROWING`.                                  |
| `locationId` | No       | The plant's current reusable Location.                                  |
| `notes`      | No       | General notes that do not belong to a dated event.                      |
| `createdAt`  | Yes      | When the record was created.                                            |
| `updatedAt`  | Yes      | When the current record was last changed.                               |
| `archivedAt` | No       | When the plant was archived. `null` means it is not archived.           |

The initial Plant statuses are:

- `GROWING`
- `QUARANTINE`
- `SOLD`
- `DECEASED`

Archive state remains separate from status. A plant can therefore stay `DECEASED` or `SOLD` while also being hidden from the normal active collection through `archivedAt`.

### Plant reference rules

- References are generated automatically in ascending order.
- The first references are `ANT-0001`, `ANT-0002`, and `ANT-0003`.
- Four digits are the minimum padding, so the format can continue naturally beyond `ANT-9999`.
- A unique database constraint protects the reference from duplication.
- The application must not allow a reference to be edited after assignment.
- Archived references are never reused.
- The complete formatted reference is stored separately from the internal ID.

The internal ID should be a generated opaque string. This keeps database relationships independent from the human readable numbering scheme.

## PlantParentage

A Plant has zero or one PlantParentage record. A separate record avoids filling the main Plant table with parent fields when parentage is not known.

| Field                 | Required | Purpose                                                        |
| --------------------- | -------- | -------------------------------------------------------------- |
| `id`                  | Yes      | Internal parentage record ID.                                  |
| `plantId`             | Yes      | Unique link to the child Plant.                                |
| `seedParentPlantId`   | No       | Link to the seed/mother Plant when it exists in this database. |
| `seedParentName`      | No       | Name used when the seed parent is external or unrecorded.      |
| `pollenParentPlantId` | No       | Link to the pollen Plant when it exists in this database.      |
| `pollenParentName`    | No       | Name used when the pollen parent is external or unrecorded.    |
| `createdAt`           | Yes      | When the parentage record was created.                         |
| `updatedAt`           | Yes      | When the parentage record was last changed.                    |

Each parent role supports one of three states:

1. A link to another Plant in this database
2. An external parent name
3. Unknown, with both fields left empty

A role should not contain both a Plant link and an external name. Input validation will enforce that rule. Parent links must not point back to the same child or create a parentage cycle.

One Plant can be the linked seed or pollen parent of many other plants. Archiving a parent Plant does not remove or break those relationships.

## PlantPurchase

A Plant has zero or one PlantPurchase record. No record is needed when the plant was not purchased or no purchase information is being kept.

| Field               | Required | Purpose                                           |
| ------------------- | -------- | ------------------------------------------------- |
| `id`                | Yes      | Internal purchase record ID.                      |
| `plantId`           | Yes      | Unique link to the purchased Plant.               |
| `seller`            | No       | Seller or source name.                            |
| `purchaseDate`      | No       | Date the plant was purchased.                     |
| `plantPriceMinor`   | No       | Plant price in the currency's integer minor unit. |
| `shippingCostMinor` | No       | Shipping cost in integer minor units.             |
| `otherCostMinor`    | No       | Other acquisition costs in integer minor units.   |
| `currency`          | Yes      | ISO currency code, defaulting to `GBP`.           |
| `createdAt`         | Yes      | When the purchase record was created.             |
| `updatedAt`         | Yes      | When the purchase record was last changed.        |

Money is never stored as a floating point value. For GBP, `12500` represents £125.00. Costs must be zero or greater. `null` means an amount is unknown, while `0` means it is known that there was no cost.

Total acquisition cost is calculated from the available price, shipping, and other cost fields. It is not stored as another editable value.

## PlantPhoto

A Plant can have any number of PlantPhoto records. The database stores photo metadata and a storage reference, not the image itself.

| Field              | Required | Purpose                                                              |
| ------------------ | -------- | -------------------------------------------------------------------- |
| `id`               | Yes      | Internal photo record ID.                                            |
| `plantId`          | Yes      | Link to the Plant shown in the photo.                                |
| `storageKey`       | Yes      | Unique provider independent key used to retrieve the stored image.   |
| `originalFilename` | No       | Original filename retained for useful metadata.                      |
| `caption`          | No       | Optional description or note about the image.                        |
| `takenAt`          | No       | When the photo was taken, when known.                                |
| `isPrimary`        | Yes      | Whether this is the Plant's main display image. Defaults to `false`. |
| `sortOrder`        | Yes      | Stable ordering within the Plant's gallery. Defaults to `0`.         |
| `createdAt`        | Yes      | When the photo record was added.                                     |
| `updatedAt`        | Yes      | When the photo metadata was last changed.                            |

`storageKey` is not a local path and not a public URL. A later storage service will resolve it to the chosen local, object storage, or hosted implementation.

Only one photo should be primary for a Plant at a time. That rule will be handled atomically in the Plant photo data layer when photo handling is implemented.

## Location

Locations are reusable physical places. A Plant has zero or one current Location, while one Location can contain many Plants.

| Field              | Required | Purpose                                                          |
| ------------------ | -------- | ---------------------------------------------------------------- |
| `id`               | Yes      | Internal Location ID.                                            |
| `name`             | Yes      | Human readable name such as `Top Shelf`.                         |
| `description`      | No       | Extra details needed to identify the area.                       |
| `parentLocationId` | No       | Optional link to a containing Location.                          |
| `createdAt`        | Yes      | When the Location was created.                                   |
| `updatedAt`        | Yes      | When the current Location details last changed.                  |
| `archivedAt`       | No       | Archives a Location without destroying its historical reference. |

`parentLocationId` is the only location hierarchy groundwork included now. It allows a later structure such as Grow Tent → Rack → Shelf without changing how Plants link to locations. The first Plant Management UI does not need to display or manage a complex tree.

Location names do not need to be globally unique because two different racks may both contain a `Top Shelf`. Names should be unique among locations with the same parent. A Location must not be its own parent or create a hierarchy cycle.

## Relationship and history rules

- Archiving a Plant never cascades into deleting parentage, purchase, photo, or location records.
- Archiving a linked parent Plant does not remove it from another plant's parentage.
- Archiving a Location does not erase it from historical records. The UI should prevent assigning new plants to an archived Location.
- Plant names can be empty. The UI can display the permanent reference with a fallback such as `Unnamed Plant` or `NOID`.
- Dates and times are stored consistently in UTC. Date only values are presented as dates in the user's local timezone.
- Calculated values such as total acquisition cost are derived rather than duplicated in the database.
- Database and application validation will reject invalid status values, negative money amounts, duplicate references, and invalid self references.

## Deliberately not included

The first migration must not include CareEvent, Observation, BreedingEvent, BreedingPlan, Pollen, SeedBatch, Seedling, Ancestry, Sale, or other future models. Migrations for those records will be added when their feature design is reviewed.
