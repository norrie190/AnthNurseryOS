# Equipment energy browser workflow

## This checkpoint

Equipment details now show Power / Energy, recorded history and forms for recording, changing, correcting and voiding settings. Electricity tariffs have their own page at `/energy/tariffs`, linked from the Equipment list and each Equipment energy section. There is no Energy overview or main dashboard integration.

All writes use the existing energy services. No schema, migration, dependency, reference sequence or calculation rule changes are included. There are no development fixtures, R2 calls, Equipment photos, standing charges or time of use schedules.

## Forms and dates

Record adds an explicit period, including a bounded historical period or a gap. Change is for a genuine operational or tariff change from today or a future date. Its preview uses the existing period planner to show the new range and any shortened previous period. Scheduled successors remain intact. Record remains available after the first entry so gaps and older history can be entered deliberately.

Dates displayed in history include both shown days. Form fields use First day and optional Last day, also inclusive. The browser boundary converts Last day to the following calendar date before calling the service. Blank means an open end. Calendar arithmetic is independent of daylight saving time; the stored intervals remain [from, to).

Power and hours are retained as text, including trailing decimal places. Tariffs are entered as pence per kWh, not pounds, with GBP fixed by the service. No Number conversion or purchase money parser is involved. The existing service validates precision, bounds, dates, capability and overlaps.

Correct is explicitly for a mistake and requires a reason. Moving an existing shared boundary previews the adjacent period that must move with it. The user must confirm that exact proposed change; changing a field clears the confirmation. The action derives only these adjacent adjustments from stored history, and the service validates and applies them atomically. Making a corrected period open ended cannot swallow a scheduled successor. Unrelated periods cannot be edited through nested browser input.

Void requires a reason and explicit confirmation. The record stays visible as excluded from calculations, with its reason. Neighbouring periods are not expanded and any resulting coverage gap remains unknown. There is no hard delete.

## Stale protection and safe feedback

An open editor captures its original Equipment expectedUpdatedAt or tariff timeline token, together with the history used for its preview. A background refresh cannot silently update that token. The existing service checks it under the Equipment or tariff lock. A successful save closes the editor, announces success and refreshes the server page. Later forms receive fresh tokens, history and projections.

Validation, overlap and stale errors keep the editor and textual values available. An accessible error summary receives focus, with field feedback where the service supplies it. Stale feedback offers a reload link and asks the user to copy any values they need first. Pending fieldsets and a synchronous submit guard prevent ordinary double submission. Transport failures use safe uncertain-save wording; unexpected server errors are logged for diagnostics, not returned to the browser.

The server action accepts a strict operation context and only the fields for that operation. Files, duplicate fields, browser supplied record IDs in form data, timestamps, currency overrides and arbitrary nested operations are rejected. Existing record/Equipment IDs identify the target; they never become insert data. Existing local-only deployment assumptions still apply: Next.js Server Action origin checks are not authentication. Keep the development server bound to loopback. Public deployment needs the separately planned authentication and access controls.

## Estimates and coverage

The server page adapter loads each retained timeline through existing queries, then feeds decimal strings to the existing pure calculation engine. Each timeline is internally coherent; Equipment and tariff reads can reflect independently committed moments. This is a current browser view, not a cross-timeline accounting snapshot. The existing report queries remain available for reports requiring a single database snapshot.

Only formatted strings reach the view. Daily, 30 day and 365 day projections use today's configured settings and rate without assuming live measurements or billing. Scheduled future changes are deliberately excluded from constant-setting projections. Missing current settings give no projection; missing tariff data leaves positive cost unknown. Zero consumption is still known zero cost even if the rate is missing.

The Equipment page also shows this calendar month's estimate from recorded history, including scheduled dates. It uses the intersection engine, not a stored total. Incomplete values are labelled known subtotals, with explicit missing power and tariff date ranges. A gap is never silently zero. Standing charges are excluded.

Archived Equipment keeps all energy history and correction actions. Archive does not end a period. If a nonvoid period applies today, archive confirmation explains that recorded settings continue until changed or ended. Capability disabled Equipment has no new power entry controls but retained history remains correctable.

## Review and tests

Component tests cover empty/current states, exact projection presentation, missing coverage, decimal retention, pending guards, future setting previews, adjacent correction confirmation, voiding and tariff forms. Server action tests cover strict mapping, safe errors and date conversion. Guarded PostgreSQL tests run complete action workflows through the real services in rolled back transactions, including archive preservation, stale tokens and strict precision. Existing Plant and Equipment regressions remain part of the full suite.

Manual checks may open the Equipment list and tariff page and fill unsaved forms, including at mobile width. Do not save real power/tariff records without the owner's approval. Where development has no Equipment or history, populated history and mutations are verified through automated components and the guarded test database, not browser fixtures. The owner should review real mutation flows after entering their Equipment and confirmed unit rate.

After generating a Prisma client for new models, restart a dev server that was already running before those models existed. Its process may still hold the old cached client.
