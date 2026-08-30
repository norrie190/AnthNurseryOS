# Plant creation data layer

## Scope

This document describes `createPlant` behind the scenes. The browser form and server action now reuse it; their boundary is described in `plant-browser-flow.md`. There are still no update/archive/restore operations or photo uploads. The five approved models are unchanged. Automatic references use the separate sequence migration described in `database-migrations.md`.

The operation is exported from `src/modules/plants/plant-service.ts`. Database code is server only. `src/lib/prisma.ts` supplies the shared client on first use, and the Plant module owns validation, formatting and errors. There is no generic repository or service framework.

## Public input and output

`createPlant(input: CreatePlantInput): Promise<CreatedPlant>` accepts these fields only:

| Field        | Input                                                                 |
| ------------ | --------------------------------------------------------------------- |
| `name`       | Optional string or null                                               |
| `status`     | Optional GROWING, QUARANTINE, SOLD or DECEASED; omitted means GROWING |
| `locationId` | Optional UUID string or null                                          |
| `notes`      | Optional string or null                                               |
| `parentage`  | Optional parent group or null                                         |
| `purchase`   | Optional purchase group or null                                       |

The parent group accepts `seedParentPlantId`, `seedParentName`, `pollenParentPlantId` and `pollenParentName`, each optional or null. Each role can link to an existing Plant, name an external parent, or remain unknown. It cannot contain both a linked ID and a meaningful external name. Blank names become null. A completely unknown group does not create a parentage row.

The purchase group accepts optional `seller`, `orderReference`, `purchaseDate`, `plantPriceMinor`, `shippingCostMinor`, `otherCostMinor` and `currency`. All except currency may be null. Currency defaults to GBP when omitted. An omitted or null purchase creates no record. An explicit `{}` creates a purchase record whose details are unknown, with GBP as its default currency.

The result contains the saved Plant fields, including its internal UUID, ANT reference and timestamps, plus `parentage`, `purchase` and `location`. Those related values are objects or null. Dates are JavaScript Date values in this server side result; purchase dates represent the original calendar date at UTC midnight. Photos are neither accepted nor included.

Strict Zod objects reject unknown keys at every input level. Callers cannot supply `id`, `reference`, timestamps, `archivedAt`, related record IDs or Prisma operations such as `connect`, `create`, `update` and `delete`. Explicit field mapping supplies Prisma with only the approved values. The public input type is restricted, and runtime validation remains necessary for untrusted callers.

## Validation

Optional text is trimmed, with blank text becoming null. Embedded null characters are rejected because PostgreSQL text cannot store them. IDs are trimmed, validated as UUIDs and normalised to lowercase. A missing ID is unknown; a supplied blank or malformed ID is an error.

Linked parents must already exist. Sold, deceased and archived parents remain valid historical links. One existing Plant may be both seed and pollen parent. The child receives its own UUID from Prisma, with a defensive self parent check before related writes. No ancestry traversal is implemented; cycle prevention for editing existing parentage belongs to a later milestone.

A supplied Location must exist and not be archived. A local `FOR SHARE` query locks the selected row until the transaction ends, preventing its archive state from changing between the check and assignment. This does not add Location management or inherited archive rules for parent locations.

Costs are integer minor units between 0 and 2147483647, matching the database Int columns. Null means unknown, zero means known zero cost. Fractions, negative numbers, overflow, numeric strings and empty strings are rejected rather than coerced. No acquisition total is stored.

Currency codes are trimmed and uppercased, then checked against the runtime's `Intl.supportedValuesOf('currency')` list. This avoids a separate dependency. Its coverage follows Node's internationalisation data and is not a complete historical ISO currency catalogue. No conversion or exchange rates are included.

Purchase dates must be real YYYY-MM-DD calendar dates, with years from 0001 to 9999. Leap days are checked. Future dates are allowed. The value is converted to UTC midnight for Prisma's PostgreSQL date field, without shifting the supplied calendar date. Seller order references are not unique because an order may contain several plants.

## References and transactions

Pure input validation runs before a database connection is opened. One Prisma transaction then checks the selected Location and parents, obtains a sequence value, creates the Plant, writes any parentage and purchase, and returns the saved result. All database work uses that transaction's client. The public operation resolves only after successful commit.

`nextval('public.plant_reference_sequence')` allocates a distinct bigint value. Formatting pads to at least four digits, so 1 becomes ANT-0001 and 10000 becomes ANT-10000. The bigint is never converted to a JavaScript number, avoiding precision loss. The existing unique reference constraint remains the final duplicate protection.

Failure rolls back all Plant and related writes. The allocated number is not returned to the sequence. No automatic retries are made, particularly after connection failures where the commit outcome might be uncertain. Future imports of existing references must coordinate with the sequence; it is not a gapless plant count.

## Errors

`PlantError` contains a code, safe message, field issues where applicable, and an underlying cause where available. The implemented codes are VALIDATION_FAILED, INVALID_PARENT, LOCATION_UNAVAILABLE and CONFLICT. A Plant not found code can be added when an operation actually looks up an existing target Plant.

Malformed input produces VALIDATION_FAILED. Conflicting parent roles or missing linked parents produce INVALID_PARENT. Missing and archived Locations produce LOCATION_UNAVAILABLE. Prisma unique, foreign key and transaction conflict errors become CONFLICT with the original error retained as `cause`.

Unexpected database and infrastructure errors are rethrown unchanged, rather than disguised as ordinary user input errors. The server action logs technical details on the server and returns a safe public message. Nothing here sends raw database diagnostics to a browser.

## Verification

Unit tests cover normalisation, protected fields, parent conflicts, cost bounds, currency, calendar dates, formatting beyond four digits and error behaviour. Database tests exercise the actual creation operation, optional records, historical parents, archived Locations, simultaneous creation, permanent sequence advancement and rollback after a related SQL failure. Fixtures are rolled back, but test sequence values are intentionally consumed. The original database constraint tests remain in place.

Reference changes through normal updates cannot yet be tested because no update operation exists. It must reject identity fields when that later checkpoint is implemented. Direct privileged SQL remains outside the application's immutability protection.
