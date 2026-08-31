# Anth Nursery OS

This is a plant nursery management system I am building around my own Anthurium collection and breeding programme. I want it to become something I can genuinely use in the nursery, while also being a well built portfolio project.

The MVP will cover plants, care tracking, equipment, expenses, and a dashboard. Breeding, pollen, seed batches, seedlings, and ancestry will come later as their own phases rather than being squeezed into the first version.

The working requirements are in [docs/projectspec.md](docs/projectspec.md), with the development stages in [docs/mvp-roadmap.md](docs/mvp-roadmap.md). The original [project specification PDF](docs/Initial%20Project%20Spec.pdf) is kept for reference. Technical decisions are written down in [docs/architecture.md](docs/architecture.md) as the project develops.

## What it uses

The app is built with Next.js, React, and TypeScript. Prisma and PostgreSQL 18 provide the Plant Management database. Docker Compose runs the development and test databases locally. Zod validates integration settings and Plant creation input. Lucide provides the interface icons. ESLint and Prettier keep the code consistent, and Vitest with Testing Library is used for tests. Prisma's PostgreSQL adapter supplies the runtime driver; direct SQL tests also use `pg`.

## Before starting

You need Node.js 24 or newer and Docker Desktop with Docker Compose. Start Docker Desktop before running the database commands. The project uses pnpm 11, which is locked in `package.json` so everyone uses the same version.

On Windows, Corepack can sometimes need administrator access. The commands below use `npx` to run the locked pnpm version instead, so they work without changing your global setup. If `pnpm` already works on your machine, you can replace `npx pnpm@11.19.0` with `pnpm`.

## Running the project

Open a PowerShell terminal in the project folder and run:

```powershell
npx pnpm@11.19.0 install

if (-not (Test-Path .env)) {
  Copy-Item .env.example .env
}

npx pnpm@11.19.0 db:up
npx pnpm@11.19.0 db:deploy
npx pnpm@11.19.0 db:migrate:test
npx pnpm@11.19.0 db:check
npx pnpm@11.19.0 db:generate
npx pnpm@11.19.0 dev
```

Then open [http://127.0.0.1:3000/plants](http://127.0.0.1:3000/plants) to browse your saved Plants or choose Add Plant. The list shows non archived records, newest first. Select a row to open its detail page. The form records a Plant through the existing creation service and opens its detail page after saving. The ANT reference is assigned automatically. The detail page also offers Edit Plant and Archive Plant. Archive requires confirmation and preserves the record and its status. View Archived opens `/plants/archived`, where you can open a preserved Plant and restore it. Photos on the detail page lets you upload a photograph, view the gallery and choose the primary image shown on the list.

The development and local production commands listen on `127.0.0.1` only. There is no authentication yet, so do not expose the app through a public tunnel or network proxy. This is a local nursery workflow for now, not a deployment ready public service.

`db:up` starts PostgreSQL 18 and waits for it to accept connections. The first start creates both `anth_nursery` and `anth_nursery_test`. Database files are kept in a named Docker volume, so `db:down` stops the container without removing the data.

The database port is available only on this computer. The test database is created when the volume is first initialised. Database tests use it separately from the unit and UI tests.

## Commands

Run these through `npx pnpm@11.19.0` unless pnpm is already available directly.

| Command                    | What it does                                              |
| -------------------------- | --------------------------------------------------------- |
| `dev`                      | Starts the local development server.                      |
| `build`                    | Creates a production build.                               |
| `start`                    | Runs the production build locally.                        |
| `lint`                     | Checks the code with ESLint. Warnings count as failures.  |
| `format`                   | Checks formatting with Prettier.                          |
| `format:write`             | Applies Prettier formatting.                              |
| `test`                     | Runs unit and UI tests without PostgreSQL.                |
| `test:watch`               | Runs tests in watch mode.                                 |
| `test:db`                  | Runs isolated tests against the test database.            |
| `typecheck`                | Checks TypeScript without producing application output.   |
| `db:up`                    | Starts PostgreSQL and waits until it is healthy.          |
| `db:down`                  | Stops PostgreSQL while keeping its data.                  |
| `db:logs`                  | Follows the PostgreSQL container logs.                    |
| `db:check`                 | Checks both database connections through Prisma.          |
| `db:status`                | Checks migration status after the first migration.        |
| `db:generate`              | Regenerates Prisma's client after a schema change.        |
| `db:migrate --name <name>` | Creates and applies a named development migration.        |
| `db:deploy`                | Applies existing migrations to the development database.  |
| `db:migrate:test`          | Applies existing migrations to the guarded test database. |
| `db:studio`                | Opens Prisma Studio once the database has data.           |
| `db:validate`              | Checks the Prisma schema and database configuration.      |

For example, to run the tests on this machine:

```powershell
npx pnpm@11.19.0 test
```

## Project layout

```text
src/
  app/          Next.js routes, layouts, and route specific styles
  components/   The shared application shell and other reusable UI
  lib/          Shared infrastructure code
  modules/      Individual feature areas, such as plants or care
  generated/    Prisma generated files; do not edit these by hand
prisma/         Database schema and migrations
docker/         Local PostgreSQL setup
scripts/        Development checks
tests/          Shared test setup and helpers
docs/           Project notes and technical documentation
```

The Plant creation code, form, read queries and detail view live in `src/modules/plants`. Routes remain in `src/app/plants`. Shared Prisma connection setup is in `src/lib/prisma.ts`. Other feature folders will appear when their work starts.

## Database workflow

Prisma uses PostgreSQL 18 in development, testing, and eventual production. Development and testing use separate databases in the local Docker container. Their connection strings are configured through `DATABASE_URL` and `TEST_DATABASE_URL` in `.env`.

The initial Plant Management migration and the separate ANT sequence migration are implemented. The approved fields and relationships are in [docs/plant-data-model.md](docs/plant-data-model.md). The creation API is documented in [docs/plant-creation.md](docs/plant-creation.md). Custom SQL and migration details are in [docs/database-migrations.md](docs/database-migrations.md).

Use `db:check` to verify both database connections. It runs `SELECT 1` through Prisma without creating tables or migrations. Prisma uses `DATABASE_URL` by default; the check temporarily passes `TEST_DATABASE_URL` to a separate Prisma process for the second connection without changing `.env`.

`db:status` checks development migration history. Use `db:deploy` to apply already reviewed migration files. To draft a future migration for inspection before applying it, use `db:migrate --name <name> --create-only`.

When a database change is agreed, update `prisma/schema.prisma` where appropriate, create a named migration, review its SQL, add tests, and commit the migration with its related code. SQL objects that Prisma cannot represent, such as the reference sequence, belong in a custom migration without an unrelated schema edit. Do not edit anything in `src/generated/prisma` by hand.

The local PostgreSQL username and password in `.env.example` are only development defaults. Production must use separate secret credentials supplied by the hosting environment.

## Running database tests

With Docker Desktop running, use:

```powershell
npx pnpm@11.19.0 db:up
npx pnpm@11.19.0 db:migrate:test
npx pnpm@11.19.0 test:db
```

Tests require PostgreSQL 18 and the reviewed migrations. They fail if the database is unavailable rather than silently skipping. Each test transaction is rolled back, including failed constraint checks, so fixture records are not kept. No database is reset or truncated.

Sequence numbers are deliberately not rolled back. Running the database tests advances the test sequence, but never the development sequence. Tests must not assume their first Plant will be `ANT-0001`. Do not reset the sequence to remove gaps. Imports of existing ANT references will need to coordinate with it before writing records.

Both tests and the test migration command require a local `TEST_DATABASE_URL` with a database name ending in `_test`, distinct from the development database name. Only the optional `schema=public` URL parameter is supported. Neither command falls back to `DATABASE_URL`.

Run `test`, `test:db`, `lint`, `format`, `typecheck`, `db:validate`, `db:generate`, and `build` before handing over a database milestone.

## Reviewing Plant Management

### Photo storage setup

Cloudflare R2 provides private photo storage, with Sharp generating display and thumbnail WebP copies. The three direct dependencies are `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner` and `sharp`. Ordinary Plant use and builds do not need storage credentials until a real photo operation is requested.

The four R2 settings in `.env.example` are deliberately blank. Put real development values only in the ignored project `.env`: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` and `R2_BUCKET_NAME`. Do not use NEXT_PUBLIC variables, paste secrets into chat or commit credentials. Create a separate private development bucket and scope its S3 Object Read & Write credentials to that bucket. The exact setup and disposable smoke test procedure are in [the photo data layer notes](docs/plant-photo-data-layer.md#configure-a-real-development-bucket-only-when-ready). The owner's bucket passed the separately approved smoke test; automated tests still never use it.

Photo unit/image tests run with `test`, and photo database tests with `test:db`. They use synthetic local images and a fake storage boundary, never a real R2 account. The real adapter refuses automated test environments. The reviewed primary photo migration and new thumbnail crop migration are part of the migration history; apply them with the existing commands, not `db push`.

Selecting a new upload now prepares an orientation corrected crop preview without saving anything. Choose the square area for Plant cards, then Upload Photo. Existing photographs offer Adjust Crop with Reset to centre, Save Crop and Cancel. Only the square thumbnail changes; the full display and private original stay untouched. No extra dependency or environment setting is required. See [thumbnail crops](docs/plant-photo-crops.md) for storage, failure handling and manual review steps.

To add a real photo, open a Plant and use Upload Photo in its Photos section. Select one JPEG, PNG or static WebP up to 10 MiB and 50 megapixels; HEIC/HEIF is not supported yet. Caption and taken time are optional. The time uses your device timezone and gallery dates show UK time. The first photo becomes primary automatically. Later photos offer Set as Primary, and the selected thumbnail appears on the list. Archived Plants work the same way without being restored. Each saved photo also offers Delete with explicit permanent deletion confirmation. Deleting the primary selects the next remaining photo automatically. See [the photo browser notes](docs/plant-photo-browser-flow.md) and [photo deletion](docs/plant-photo-deletion.md) for behaviour and review steps.

### Browser workflow

The browser workflow and manual checks are described in [docs/plant-browser-flow.md](docs/plant-browser-flow.md). Automated coverage uses Vitest, Testing Library and the separate test database. There is no Playwright suite or special browser fixture route.

To review the list, open `/plants`, select an existing Plant, return using Back to Plants, then check that Add Plant opens the form. The list uses columns on desktop and stacked cards on narrow screens. Existing records are enough for this read only check; there is no need to create a new Plant.

Do not save demo Plants in the development app to test the form. A successful save creates a real nursery record and consumes an ANT reference. To preserve ANT-0001 for the first real Plant, use the automated tests for creation and limit browser checks to navigation and deliberately invalid input until that real record is ready.
