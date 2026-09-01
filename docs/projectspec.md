# Anth Nursery OS project specification

## Purpose

Anth Nursery OS is a plant nursery breeding and management system for one nursery owner. It starts around an Anthurium collection and breeding programme, but the core records should remain useful for other plants without making the first version unnecessarily broad.

The application has two jobs. It should be useful for running the nursery day to day, and it should be a well structured software engineering portfolio project with clear architecture, migrations, tests, documentation, and small Git commits.

This Markdown file is the working product specification. `Initial Project Spec.pdf` is kept as the original source document, while later decisions and clarifications should be maintained here.

## First MVP

The MVP covers five areas. They should be built one at a time in the order described in `mvp-roadmap.md`.

### Plant Management

Plant Management is the first feature and the centre of the nursery data.

It will support:

- Adding and editing plants
- Archiving plants without destroying their history
- A permanent human readable plant reference
- An optional plant name
- Parentage
- Multiple photos over a plant's lifetime
- Current location
- Current plant status
- Purchase information

The initial statuses are:

- `GROWING`
- `QUARANTINE`
- `SOLD`
- `DECEASED`

Breeding is not a Plant status. A growing plant can participate in breeding later through breeding records.

The photo storage and data layer, browser uploads, gallery and list images are implemented. The approved square thumbnail crop checkpoint lets the owner choose framing during upload or adjust it later. Store normalised crop metadata and regenerate only the thumbnail from the unchanged original. Full display images retain their natural aspect ratio. Photographs use private Cloudflare R2 storage, with metadata only in PostgreSQL. Retain the validated original privately and serve processed display and thumbnail WebP copies with EXIF/GPS removed. Initial uploads accept JPEG, PNG and static WebP up to 10 MiB and 50 MP decoded; HEIC/HEIF is deferred. See [thumbnail crops](plant-photo-crops.md).

The first photo becomes primary automatically. Each Plant may have at most one primary, protected by a partial unique index and atomic service operations. Archived Plants retain their photos and may receive new ones, change the primary or explicitly delete a photo without being restored. Photo deletion requires confirmation, preserves other nursery information and promotes the next deterministic photo when the primary is removed. Metadata is deleted transactionally before targeted removal of that photo's exact R2 asset, including superseded thumbnails. Failed cleanup is reported without recreating metadata. There is no general reconciliation scanner or broad cleanup. See [Plant photo storage](plant-photo-storage.md) and [photo deletion](plant-photo-deletion.md).

### Equipment

Equipment inventory is the next domain after Plant Management, ahead of Care. Each record represents one physical item with a UUID and permanent EQP reference. It includes a required name, flexible text category defaulting to Other, optional brand/model/serial number/notes, an optional existing Location and a separate archive date. No EquipmentStatus or quantity record is added.

usesPower means “This equipment is capable of having electrical consumption tracked by AnthNurseryOS.” It is required without a default. It does not mean currently switched on, connected, consuming electricity, or automatically included in running cost calculations. Future EquipmentPowerPeriod records will determine historical operating consumption.

EquipmentPurchase is optional, with seller, order reference, calendar purchase date and individual item costs. Integer minor units preserve null as unknown and zero as known zero, with GBP as the default currency. Shipping is the amount allocated to this specific Equipment item, not automatically the full shipping cost of a shared order. No Order model is included.

The database foundation, restricted Equipment data layer and inventory browser workflow are implemented. Creation allocates EQP references, edits use stale protection, and archive/restore preserves related information. Equipment pages provide active/archived lists, Add/Edit forms, details and archive/restore actions. The exact fields and scope are in [Equipment data model](equipment-data-model.md), with UI behaviour in [Equipment browser workflow](equipment-browser-flow.md).

The committed [energy history schema](equipment-energy.md) stores EquipmentPowerPeriod and a single nursery ElectricityTariff timeline, with exact decimal watts, daily hours and GBP pence per kWh, calendar date intervals, overlap protection and retained voided records. The [energy data layer](energy-data-layer.md) supports recording, changing, correcting and voiding periods, with stale protection, exact derived calculations and coverage reporting. The [browser workflow](energy-browser-flow.md) exposes these on Equipment details and `/energy/tariffs`. Gaps remain unknown rather than silently becoming zero, and historical reports include archived Equipment. Dashboard integration, maintenance and future equipment upgrades remain separate later work.

Equipment photographs use a separate EquipmentPhoto relation rather than making PlantPhoto polymorphic. The [Equipment photo schema](equipment-photo-data-model.md) stores only private object metadata, ordering, primary selection and square crop coordinates. The [Equipment photo data layer](equipment-photo-data-layer.md) now provides Equipment-owned upload, primary, crop, deletion and restricted read operations through the shared image/R2 mechanics. Browser delivery and UI remain later work.

### Care

Care tracking will cover watering and fertilising. Care will be stored as events so the history is kept. Last watered and last fertilised will be calculated from the latest matching events rather than stored as editable fields on Plant.

The watering and fertiliser indicators should show more than colour alone. Watering targets should eventually be configurable per plant rather than using one interval for every plant.

### Expenses

Expense tracking will cover electricity and other nursery costs such as fertiliser, growing media, packaging, shipping, and supplies. Equipment running costs should be linkable to the equipment that caused them.

Purchase amounts use integer minor units rather than floating point numbers. GBP is the default currency, but purchase records retain a currency code. The separate electricity history foundation uses numeric(9,5) pence per kWh and explicitly GBP only tariffs. Future exact derived calculations must retain fractional pence until presentation. Standing charges, currency conversion and time of use tariffs are not included.

### Dashboard

The dashboard will be built after the underlying features provide real data. Its first useful figures are:

- Plant count
- Plant investment
- Equipment investment
- Total nursery investment
- Watering overview

## Later phases

The following areas matter to the long term product but are not part of the first Plant Management stage.

### Breeding

- Historical breeding records
- Actual breeding events with a seed/mother plant and pollen plant
- Potential crosses and target dates
- Cross name generation
- Breeding status and notes

Potential future crosses must remain Breeding Plans until the cross actually happens. An actual cross becomes a separate Breeding Event.

### Pollen inventory

- Source plant
- Collection and storage dates
- Storage method and location
- Quantity where practical
- Available, used, expired, or discarded status
- Links to breeding events where the pollen was used

### Seed batches and seedlings

Seed batches will follow pollination, infructescence development, fruiting, harvest, seed inventory, and germination. Seedlings will use the main Plant record and link back to their seed batch or origin rather than becoming a separate type of plant.

### Observations and ancestry

Observations may record measurements, leaf counts, vigour, phenotype traits, notes, and photos over time. Ancestry can later use linked parent plants to build family trees and parent/offspring views.

### Other future work

- Environmental monitoring and history
- Sales, buyers, orders, and profit or loss
- Seed and seedling sales
- Reports
- Nursery expansion and upgrade planning

## Data rules

- `Plant.id` is the central internal identifier for plant related relationships.
- The visible `ANT-XXXX` reference is separate from `Plant.id`, unique, permanent, and never reused.
- Important nursery records are archived or given an appropriate status instead of being permanently deleted.
- Current status and archive state are separate concerns.
- Time based information such as care and observations should be recorded as events rather than repeatedly overwriting one value.
- Parentage may link to a Plant record we own or retain the name of an external parent we do not own.
- Photos use a provider independent storage key. The database should not assume that files will always live on the local filesystem.
- New tables should be added when their feature phase begins, not in advance.

The proposed first Plant data model is described in `plant-data-model.md` and should be agreed before the Prisma schema is written.

## Quality requirements

The application should:

- Use TypeScript throughout
- Validate incoming data
- Handle errors clearly
- Include useful automated tests
- Work on desktop and mobile
- Use semantic, keyboard accessible interfaces
- Use readable contrast and never rely on colour alone for status
- Optimise uploaded images when photo handling is implemented
- Support a documented backup process before it holds important nursery data
