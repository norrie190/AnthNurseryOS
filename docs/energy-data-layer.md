# Energy data layer and calculations

## Scope

This checkpoint implements energy domain operations, queries and exact estimates against the committed EquipmentPowerPeriod and ElectricityTariff schema. There are no schema or migration changes, dependencies, routes, forms, dashboard changes, R2 operations or development fixtures. The persistence design remains in [Equipment energy history](equipment-energy.md).

Code lives in src/modules/energy. Server only services use the existing Prisma connection, explicit scalar mapping and a small EnergyError. Calendar date helpers live in src/lib/calendar-date.ts because Equipment's usesPower guard and energy both use the nursery calendar. There is no repository framework or generic locking infrastructure.

## Public operations

| Operation                    | Arguments                    | Result                              |
| ---------------------------- | ---------------------------- | ----------------------------------- |
| recordEquipmentPowerPeriod   | equipmentId, input           | period, equipmentUpdatedAt, changed |
| changeEquipmentPowerSettings | equipmentId, input           | period, equipmentUpdatedAt, changed |
| correctEquipmentPowerPeriod  | equipmentId, periodId, input | period, equipmentUpdatedAt, changed |
| voidEquipmentPowerPeriod     | equipmentId, periodId, input | period, equipmentUpdatedAt, changed |
| recordElectricityTariff      | input                        | tariff, timelineToken, changed      |
| changeElectricityTariff      | input                        | tariff, timelineToken, changed      |
| correctElectricityTariff     | tariffId, input              | tariff, timelineToken, changed      |
| voidElectricityTariff        | tariffId, input              | tariff, timelineToken, changed      |

All operations return promises, including validation failures. IDs in arguments identify existing owners/records; no input can choose a newly created ID, reference, timestamps, voidedAt or arbitrary Prisma operations. UUIDs and dates are validated. All mutation input objects are strict Zod objects.

Power recording requires powerWatts, hoursPerDay, effectiveFrom and expectedUpdatedAt. effectiveTo may be omitted or null for an open end; notes is optional. Tariff recording requires unitRateMinorPerKwh, effectiveFrom and expectedTimelineToken. Optional currency must be GBP. Power and tariff values are decimal strings, not JavaScript numbers. Power/hours allow two decimal places; tariff rates allow five. Negative values, excess precision, exponent notation, NaN, infinity, currency symbols and malformed decimals are rejected before Prisma can round them. Accepted values normalise to their exact declared scale.

Power is bounded to 100000 W, hours to 24 and rates to 1000 p/kWh, including zero. Notes and reasons trim whitespace, reject null characters and allow at most 10000 characters. Blank optional notes become null. Corrections and voids require a nonblank correctionReason.

## Changes, corrections and voids

Recording accepts a complete, nonoverlapping interval, including explicitly entered missing history. Changing settings accepts an effectiveFrom of today or later, closes any covering period, and creates a new period without overwriting a future successor. A setting inserted into a gap ends at the next scheduled start. A change within an already bounded period preserves its existing end, so an explicitly unknown gap after it is not silently filled. A conflicting change at an existing start asks for a correction. Identical settings/notes already covering the chosen date return changed: false without creating a split.

Corrections accept a restricted patch: omitted fields preserve values, explicit null clears notes or the end date, and decimal zero is a real value. The supplied reason describes the current correction, not a full audit history. Voided rows cannot be edited back into use; record a replacement instead.

When correcting a boundary that currently touches another period, the caller must explicitly supply adjacentAdjustments, with up to two entries shaped as { periodId, effectiveFrom? , effectiveTo? }. A left neighbour may change only its end to the corrected start; a right neighbour may change only its start to the corrected end. Unrelated, repeated or contradictory adjustments are rejected. The entire proposed timeline is checked before saving. Updates are ordered so shrinking/moving a neighbour happens before an extension that would otherwise violate the immediate database exclusion constraint. All changes share one transaction and correction reason.

Void sets voidedAt and the reason, leaving the source record and neighbouring dates intact. Repeated voids with a current token preserve the original void timestamp/reason and return changed: false. Repeated identical corrections also avoid writes. Every operation still validates its stale token before accepting a no-op. No operation hard deletes energy history.

## Equipment capability, archive and concurrency

The latest approved rule allows bounded past history to be recorded or corrected even when usesPower is now false. Creating or extending a current/future effective period requires usesPower = true. Equipment update now rejects changing true to false while any nonvoid period has an open end or an end after today's nursery date, including future scheduled periods. Past periods remain. No flag change deletes history or implies zero consumption.

Each power mutation locks Equipment with FOR NO KEY UPDATE before checking expectedUpdatedAt. The same lock is used by inventory editing and archive/restore. It then validates and saves the related changes and advances Equipment.updatedAt to max(server time, previous timestamp + 1 millisecond). Changed existing period timestamps advance strictly too. Identical operations do not write. A stale token fails, with no merge or automatic retry. No Plant advisory lock is used.

Archiving and restoring remain independent from energy. They never close/reopen periods. Archived Equipment can be corrected and can contribute to estimates. getEquipmentPowerHistory exposes hasOngoingPowerPeriod for a later archive warning; this checkpoint does not build the warning UI.

## Tariff timeline token

Tariff writers acquire pg_advisory_xact_lock with the stable integer namespace 0x414e5448 (ANTH), key 1. Never change these constants independently in another writer. This is a transaction scoped lock, not a session lock. Reads after waiting use Read Committed so they see the preceding committed transaction.

The token is SHA-256 of a deterministic UUID-sorted list of tariff IDs, updatedAt and voidedAt values. It covers all retained rows, including void markers. This is a deliberate refinement to an active-only hash: otherwise adding a tariff then voiding it would recreate the original empty token, allowing an old empty-history form to save as though nothing had changed. No singleton version table is added. The token is checked under the advisory lock, and each mutation returns the new token.

Exclusion constraints remain the final database guarantee alongside helpful application overlap checks. EnergyError distinguishes VALIDATION_FAILED, NOT_FOUND, STALE_UPDATE, OVERLAP, POWER_UNAVAILABLE and CONFLICT. Known SQL constraint failures retain their cause and receive safe messages. Unexpected infrastructure failures remain the original error for diagnostics; a later browser boundary must map those to generic feedback rather than display raw errors.

## Reads and snapshots

getEquipmentPowerHistory returns Equipment concurrency/archive/capability metadata and ordered history, including voided records. getElectricityTariffHistory returns ordered retained tariffs and their token. getCurrentEquipmentPowerPeriod and getCurrentElectricityTariff select only a nonvoid period containing the supplied date, defaulting to Europe/London today.

getEquipmentEnergySummary and getNurseryEnergySummary accept { from, to }, with an exclusive end. They load intersecting nonvoid source periods and tariffs within Repeatable Read transactions. Nursery queries load Equipment and periods in bulk, not one report query per item. Equipment history reads and current projections also use consistent snapshots where multiple queries are involved. No shared cache or saved monthly totals is introduced.

Reports include relevant archived Equipment and do not remove history because usesPower is currently false. A nonpowered item is not applicable only if it has no nonvoid history at all; an empty selected date range does not erase earlier historical relevance. Equipment.createdAt is never invented as an operating start date.

## Exact arithmetic and coverage

The pure calculateEquipmentEnergy function clips and splits at every requested, power and tariff boundary. It rejects overlapping source timelines rather than double counting. Voided inputs are excluded. Gregorian calendar ordinals count whole dates, not elapsed milliseconds, including leap years and Europe/London DST dates.

Values are represented as bigint numerators: kwhScaled / 10^7 is kWh, and penceScaled / 10^12 is pence. Power is scaled by 100, hours by 100 and the tariff by 100000. Multiply these integers and whole calendar days without intermediate division or rounding. JavaScript Number is used for bounded calendar components/counts, not energy or money arithmetic.

Each segment includes dates, days, source IDs and nullable exact energy/cost. Null is unknown; zero is known zero. Reports return knownSubtotal, energyComplete, costComplete, missingPower, missingTariff and missingCost. Adjacent missing ranges are merged. With zero consumption, cost is provably zero even when a tariff is missing; missingTariff still exposes the absent rate. Positive consumption without a tariff has known energy but unknown cost. A zero tariff cannot establish unknown consumption.

combineEnergyReports sums exact known subtotals before rounding and preserves incomplete coverage. Per Equipment reports retain the missing dates. Empty nursery totals mean no recorded items, not proof that the entire real nursery has no consumers.

formatEnergyKwh and formatExactGbp return exact decimal strings. formatGbp rounds the total to the nearest penny, halves up, only at the report/presentation boundary. Bigints are internal domain values; a future browser boundary must deliberately serialise them as strings rather than pass them to JSON.stringify directly.

Verified examples:

| Settings/range                   | Exact result     | GBP presentation |
| -------------------------------- | ---------------- | ---------------- |
| 70 W × 12 h × 25p, one day       | 0.84 kWh, 21p    | £0.21            |
| Same settings, 30 days           | 25.2 kWh         | £6.30            |
| Same settings, 365 days          | 306.6 kWh        | £76.65           |
| Approved September intersections | 23.4 kWh, £5.736 | £5.74            |

getEquipmentEnergyProjections returns daily, 30 day and 365 day estimates from the selected date's settings and tariff. Future scheduled changes are intentionally not applied to these constant-setting projections. Historical/calendar reports use the actual recorded boundaries instead. Missing current settings produce no projection; missing tariffs leave positive projected cost null. Labels explicitly say projection, not live power, measured consumption or billing.

## Testing and scope

Unit tests cover decimal boundaries, strict inputs, tokens, correction plans, exact arithmetic, both worked examples, partial ranges, multiple changes/items, coverage, zero, leap years, rounding and DST calendar dates. PostgreSQL tests exercise real services through rolled back fixture transactions, with savepoints for operation rollback. Simultaneous Equipment callers are serialized inside the shared fixture transaction, so no fixture needs committing; this verifies the competing caller token contract rather than separate-connection Equipment row contention. A separate real-connection tariff test verifies advisory-lock waiting and token rechecking after the first transaction rolls back. Existing schema tests cover actual exclusion constraints.

All new database fixtures and temporary failure triggers roll back. The new suite verifies existing records and both test sequences are unchanged. Full pre-existing creation regressions intentionally advance only test reference sequences. Development row fingerprints and ANT/EQP states are checked separately. There are no R2 calls, schema changes, browser forms, standing charges, time of use schedules, telemetry or dashboard work.
