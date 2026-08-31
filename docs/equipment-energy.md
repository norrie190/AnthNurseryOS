# Equipment energy history

## Current checkpoint

The approved schema checkpoint adds EquipmentPowerPeriod and ElectricityTariff, their database constraints and schema tests. It creates no energy records and changes no existing Equipment, Plants or reference sequences. Energy services, input validation, calculations, forms, routes and dashboard summaries are not implemented yet.

Equipment inventory is already complete. Energy history is now the next reviewed domain before Care. This document records both the implemented persistence foundation and the approved rules for later checkpoints; the sections below distinguish them.

## Stored records

Equipment has zero or many powerPeriods. Each EquipmentPowerPeriod belongs to exactly one Equipment through its UUID. Its foreign key uses ON DELETE RESTRICT and ON UPDATE RESTRICT. There is no cascade and no change to either reference sequence. ElectricityTariff has no Equipment foreign key: it represents the single nursery/home electricity tariff timeline shared by all Equipment.

EquipmentPowerPeriod stores:

| Field            | Prisma / PostgreSQL        | Meaning                                                    |
| ---------------- | -------------------------- | ---------------------------------------------------------- |
| id               | String / uuid              | Prisma generated UUID primary key                          |
| equipmentId      | String / uuid              | Required Equipment relationship                            |
| powerWatts       | Decimal / numeric(8,2)     | Required estimated electrical input watts while operating  |
| hoursPerDay      | Decimal / numeric(4,2)     | Required operating hours per standard day                  |
| effectiveFrom    | DateTime / date            | First included calendar date                               |
| effectiveTo      | DateTime? / date           | First excluded date, or null for no scheduled end          |
| notes            | String? / text             | Optional source or assumptions                             |
| correctionReason | String? / text             | Optional explanation of a correction; required when voided |
| voidedAt         | DateTime? / timestamptz(3) | Retained but excluded record                               |
| createdAt        | DateTime / timestamptz(3)  | Defaults to now                                            |
| updatedAt        | DateTime / timestamptz(3)  | Managed by Prisma                                          |

ElectricityTariff stores:

| Field               | Prisma / PostgreSQL        | Meaning                                               |
| ------------------- | -------------------------- | ----------------------------------------------------- |
| id                  | String / uuid              | Prisma generated UUID primary key                     |
| unitRateMinorPerKwh | Decimal / numeric(9,5)     | Required pence per kWh for GBP                        |
| currency            | String / varchar(3)        | Defaults to GBP; database permits only GBP            |
| effectiveFrom       | DateTime / date            | First included calendar date                          |
| effectiveTo         | DateTime? / date           | First excluded date, or null for no scheduled end     |
| notes               | String? / text             | Optional tariff notes                                 |
| correctionReason    | String? / text             | Optional correction explanation; required when voided |
| voidedAt            | DateTime? / timestamptz(3) | Retained but excluded record                          |
| createdAt           | DateTime / timestamptz(3)  | Defaults to now                                       |
| updatedAt           | DateTime / timestamptz(3)  | Managed by Prisma                                     |

Power is not automatically the advertised maximum or a live measurement. Users will supply the value used for estimates, optionally explaining whether it came from a measurement or an assumption. Hours are the same each day in a period; 24 means continuous operation. There are no clock times, weekday schedules or extra speculative wattage fields.

The rate 24.50p/kWh is stored as 24.50000. Tariff precision is separate from purchase costs, which remain integer minor units. There is no currency conversion. The rate should be the final rate used for estimates, normally including VAT. Standing charge is excluded; the household charge must not be repeated for each Equipment item.

## Intervals and database protection

Both timelines use DATE intervals [effectiveFrom, effectiveTo): start included, end excluded. A setting applying 1–20 September is stored from 1 September to 21 September. A successor starts on 21 September. Null end is unbounded, not proof that a period is current. Gaps and future dates are allowed.

The database requires finite calendar dates and an end later than the start when supplied. It rejects negative power/hours/rates, power above 100000 W, hours above 24, rates above 1000 p/kWh, and numeric NaN/infinity. A voided record requires correctionReason to contain at least one nonwhitespace character. Text fields remain text rather than introducing database length rules.

The exclusion constraints compare daterange(effectiveFrom, effectiveTo, '[)') for nonvoid rows. Equipment periods may not overlap within one equipmentId; different Equipment can share dates. Tariffs may not overlap anywhere in the one nursery timeline. Adjacency and gaps are valid. Voided records remain stored and no longer block replacement dates. Unvoiding a conflicting record is rejected too.

The migration deliberately enables btree_gist for UUID equality in the Equipment GiST constraint. Both local databases must offer it before deployment. Hosted PostgreSQL must also support the extension and permit its installation. Stop if it is unavailable; never weaken overlap protection to application validation alone. These checks and exclusion constraints live in the migration because Prisma cannot express them fully.

The only additional ordinary lookup index is EquipmentPowerPeriod(equipmentId, effectiveFrom), for Equipment history reads. Primary keys and exclusion constraints create their own indexes. There are no speculative reporting indexes, stored range columns, monthly totals or triggers.

PostgreSQL rounds input to a declared numeric scale. The later application boundary must reject excessive precision before Prisma/SQL can round it. The schema alone does not enforce that original input rule. Service rules such as usesPower checks, stale protection and correction workflows are also not database triggers in this checkpoint.

## Unknown and zero

A powered item with no power history, or a gap in that history, has unknown consumption. Zero watts or zero hours explicitly records zero estimated consumption. Ending a period without a successor leaves unknown data; it does not record that the item was switched off. Missing tariffs leave the cost of nonzero consumption unknown even when kWh can be calculated. An explicit zero tariff is a known zero variable cost. Nonpowered Equipment with no energy history is not applicable.

Later reports must return coverage and missing intervals alongside known subtotals, rather than presenting incomplete information as a complete £0.00 total. Equipment.createdAt is an inventory entry timestamp, not evidence of when operating history began.

## Approved later service rules, not implemented

Normal operating changes close the previous period at the chosen date and create a successor without overwriting earlier watts/hours. Existing scheduled successors are preserved. Explicit historical corrections require a reason and intentionally change affected historical estimates. Voiding is for an entirely mistaken entry, not ordinary changes; it does not silently stretch neighbouring records. No hard deletion or complete audit/version system is planned. correctionReason records the latest explanation, not every previous value.

New power periods require usesPower = true. The approved later Equipment edit guard will reject changing it to false while current or future nonvoid periods remain; users must resolve those periods explicitly. Past history remains readable and correctable. This guard is not implemented by this schema checkpoint, and the existing inventory service remains unchanged.

Archive state stays independent. Archiving/restoring does not close, reopen, void or otherwise change power history. Archived Equipment may have ongoing estimates and historical corrections. Later calculations must not filter historical periods by current archive state or usesPower. The future UI will warn about ongoing periods when archiving.

Equipment energy writes will use the Equipment FOR NO KEY UPDATE lock, expectedUpdatedAt checked under that lock, and a timestamp strictly newer than the previous value, including related changes. Tariff writers will use one local transaction scoped advisory lock and an expected timeline token derived from IDs/timestamps. No session lock, generic locking framework or singleton version table is planned. Database exclusion constraints remain the final overlap guarantee.

## Approved later calculations, not implemented

Calculations will be derived from intersections of the requested dates, power periods and tariffs. Each segment has constant watts/hours/rate. Sum exact segment values before rounding for presentation; do not store calculated monthly totals.

Wh/day = watts × hours. kWh/day = Wh/day ÷ 1000. Pence/day = kWh/day × tariff pence/kWh. At 70 W, 12 hours and 25p/kWh, that is 840 Wh, 0.84 kWh and 21p per day.

The planned pure calculation function uses decimal strings and scaled bigint values, not binary floating point arithmetic: W = watts × 100, H = hours × 100, R = tariff pence × 100000. Segment kWh is W × H × days / 10^7; pence is W × H × R × days / 10^12. Retain the numerator/scale rather than truncating division, and round only the final monetary presentation to the nearest penny, halves up. Existing whole penny purchase parsing is not a tariff parser.

Use Europe/London calendar dates and count calendar days, not elapsed local milliseconds. These are standard daily estimates, not measured consumption on 23/25 hour daylight saving days. Month to date should use completed days unless explicitly labelled as including today's full estimate. A 365 day projection at today's settings is different from a calendar year report using its actual dates and all history.

Hours per day cannot establish simultaneous live watts or consumption within cheap clock windows. Future time of use support needs clock schedules or measured intervals, time bands and deliberate timezone rules. It must not pretend existing daily history contains that missing detail. No time of use scheduling, smart plugs, telemetry, standing charges, household accounting, energy UI or dashboard work is part of this checkpoint.

## Verification

Schema tests use only the guarded local test database and rolled back transactions, with no allocated references or committed fixtures. They cover types, decimal storage, bounds, date intervals, foreign keys, restricted deletion/update, overlaps, gaps, adjacency, open ends, void/replacement rules, extension/index installation and migration checksums. Existing Plant and Equipment regression suites remain required. Those existing creation tests can advance test reference sequences; development data and both development sequences must remain unchanged.
