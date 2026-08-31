# Plant browsing and creation

## Scope

Plant Management includes `/plants`, `/plants/new` and `/plants/[plantId]`. The list shows saved non archived Plants, with an Add Plant link and a link to each record. The detail route uses the internal UUID, with the ANT reference prominent on the page. These slices, Edit Plant and Archive/Restore are committed. Archive behaviour, including `/plants/archived`, is documented in `plant-archiving.md`; editing remains documented in `plant-editing.md`. Photo storage architecture is the current documentation checkpoint, recorded in [Plant photo storage](plant-photo-storage.md), with no photo UI implemented yet.

The existing database models, migrations, ANT sequence and creation behaviour are unchanged. The detail page also links to `/plants/[plantId]/edit`. Add and Edit reuse the Plant form. This document covers browsing and creation; archive and restore use their separate documented operations. Photos, Location management and other nursery features are not part of this browser slice.

## Form and server boundary

The form has Plant details, Parentage and Purchase information sections. Name, Location and notes are optional; status starts as Growing. Each parent has Unknown, Existing Plant and External name choices. Only the active choice is sent to the service. Existing parents include historical and archived Plants because parentage describes history. Location options contain only non archived records. Neither collection is required to have any entries before the form works.

Checking Record purchase information creates a purchase group even if its details are unknown. Leaving it unchecked omits that group entirely. Turning a section or parent mode off retains its input locally if it is turned back on, but inactive input is not passed to `createPlant`.

`createPlantAction` accepts FormData and returns serialisable field/form errors, or redirects to the saved Plant UUID. It reads only known form fields. Unexpected fields, duplicate entries and uploaded files are rejected; Next's own `$ACTION_` metadata is ignored. The new Plant's identity and reference never come from the browser. Existing parent and Location IDs are selections, not the new Plant ID.

The boundary interprets form choices and converts money, then calls `createPlant`. The service still owns text and UUID normalisation, status checks, calendar date validation, cost bounds, recognised currencies, parent and Location checks, reference generation and atomic writes. There are no extra creation transactions in the action and no duplicate business validation in the page.

Expected service errors are mapped to fields where possible and to a focused error summary. Unexpected infrastructure errors are logged on the server and replaced with a safe message that asks the user to check before retrying, since a lost connection can leave the save outcome uncertain. No SQL, connection details, stack traces or error causes are returned to the browser. Successful redirect is outside the catch block so Next can complete it normally.

The form retains its controlled values after errors, including checkboxes and parent modes. Submission captures FormData and explicitly dispatches `useActionState` in a React transition to avoid automatic native resets. While saving, fields and the save button are disabled, a local guard prevents a second ordinary submission, and the button reads Saving Plant…. There is no durable idempotency key or retry mechanism. Labels, fieldsets, legends, linked field errors and summary focus support keyboard and screen reader use.

## Money

GBP is the default. For GBP, `125`, `125.50`, `0` and `0.00` become 12500, 12550, 0 and 0 minor units. Blank input becomes null. Decimal digits are padded and combined using strings and bigint before conversion to an exactly representable integer. Input is never multiplied as a floating point number or silently rounded.

Currency precision comes from the existing runtime's `Intl.NumberFormat` data. For example, JPY accepts no decimal places and KWD accepts three. The currency selection changes how the entered amount is interpreted; it does not convert an amount between currencies. Signs, currency symbols, separators, exponent notation and excess fractional digits are rejected with a useful message. The existing service enforces the PostgreSQL integer bounds.

The detail page uses the recorded currency for display. An unknown amount says Not recorded, while a known zero GBP amount displays £0.00. No calculated acquisition total is stored or introduced here. Purchase dates are formatted as calendar dates; the created timestamp is displayed in Europe/London time.

## Reads

`getPlantList` returns only the ID for linking, reference, optional name, status, Location name and created date. It selects Plants where `archivedAt` is null. Sold, Deceased and Quarantine are still included when not archived. An archived Location does not hide a Plant or erase its recorded location.

The default order is newest `createdAt` first, then reference ascending for equal timestamps. Reference is unique, so this order is deterministic. This is a text tie break, not numeric ANT sorting. No configurable sort, filters or pagination are included.

On desktop the list has Reference, Plant, Status, Location and Added columns. Each full row is a normal link, so keyboard navigation and opening in another tab work without a click handler. At narrower widths the same markup stacks into cards with reference and status at the top. Name and Location fallbacks are Unnamed Plant and No location. Dates use Europe/London, matching the detail page. An empty collection shows No Plants yet and an Add Plant link rather than empty columns.

`getPlantById` loads one Plant with its Location, parentage, linked parent identifiers and purchase. Invalid UUIDs and missing records lead to a not found page. Database read failures show a safe retry screen rather than being treated as missing Plants.

`getPlantParentOptions` selects only the fields needed to label options, including status and archive information. `getUsableLocationOptions` selects non archived Locations and their immediate parent name for useful labels. It does not implement hierarchy management or inherited archive behaviour.

All three database backed pages run at request time using `connection()`. Following Plants or Back to Plants after a creation reads the current list. No cache or invalidation layer is needed. Linked parents point to their own UUID detail routes. The existing safe route error screen also handles list failures; database errors must not become a misleading empty state. A small loading message appears while a Plant route is pending.

## Automated checks

Unit tests cover form field restrictions, parent modes, purchase omission, exact money conversion and safe action errors. Action tests check that successful saves redirect using the returned UUID. Component tests cover empty options, retained input, error focus, pending feedback, ordinary duplicate submission prevention and detail rendering. Page tests check the saved reference and missing record handling.

Database tests run the real action and creation service against the guarded test database, read the generated reference and optional records, and check the redirect target. They use the repository's existing transaction rollback approach: a test wrapper around Prisma rolls fixtures back after assertions, without adding hooks to production code. These checks exercise the SQL writes and reads but deliberately do not leave a committed fixture behind. Test sequence values are consumed as usual; the development sequence is never used.

The current Prisma/pg combination emits a pg deprecation warning when the detail query loads several relations inside that single test transaction. The tests still pass. The normal detail query uses the shared pool rather than a fixture transaction. The warning is not suppressed and should be checked when the driver is upgraded; no dependency or production query workaround has been added just for this warning.

There is no repository browser framework in this milestone. No browser fixture exception, test route, alternate database app or new dependency has been introduced. A future Playwright setup should be agreed separately.

List tests cover empty, single and multiple records, labels, fallbacks, dates, link targets and repeated request reads. Database tests check archive exclusion, all non archived statuses, deterministic date/reference ordering and retrieving a Plant created by the real creation service. These fixtures use the same guarded test database and rollback discipline as the existing tests.

## Manual review

For browsing, open `/plants`, check a Plant already saved in the nursery, follow its row to the detail page, and use Back to Plants to return. Follow Add Plant and confirm the form opens without submitting it. Check the list at desktop and mobile widths. This is a read only review: do not insert demo Plants, change existing records or consume development reference numbers to exercise the list.

Start the app with `npx pnpm@11.19.0 dev` and open `http://127.0.0.1:3000/plants`. Follow Add Plant. Check the form on desktop and a narrow screen, including both optional sections and the no Locations message.

For a check that does not create a record, enable purchase information, enter `125.555` as a GBP plant price and save. It must show a field error and focus the summary while retaining the entered values and selections. This fails at the form boundary, before any reference allocation. Do not correct and submit that test input as a real Plant.

For the complete successful journey, use an actual nursery Plant with the owner's approval. Enter its details, save once, and confirm that the browser opens `/plants/<UUID>` with the generated ANT reference and recorded information. A read only database check can confirm the saved record. Do not create demo records, reset the sequence or remove real history to tidy up a test.

If the development sequence is still at value 1 with `is_called = false`, the first successful allocation will be ANT-0001. The automated tests do not assume a starting value in the test database. Until an actual first Plant is ready, the manual successful save remains a review step rather than something to simulate in the development database.
