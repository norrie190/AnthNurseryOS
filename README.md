# Anth Nursery OS

This is a plant nursery management system I am building around my own Anthurium collection and breeding programme. I want it to become something I can genuinely use in the nursery, while also being a well built portfolio project.

The MVP will cover plants, care tracking, equipment, expenses, and a dashboard. Breeding, pollen, seed batches, seedlings, and ancestry will come later as their own phases rather than being squeezed into the first version.

The working requirements are in [docs/projectspec.md](docs/projectspec.md), with the development stages in [docs/mvp-roadmap.md](docs/mvp-roadmap.md). The original [project specification PDF](docs/Initial%20Project%20Spec.pdf) is kept for reference. Technical decisions are written down in [docs/architecture.md](docs/architecture.md) as the project develops.

## What it uses

The app is built with Next.js, React, and TypeScript. Prisma and PostgreSQL 18 provide the database foundation, although there are no plant or nursery tables yet. Docker Compose runs the development and test databases locally. Zod will be used to validate data coming into the app. Lucide provides the interface icons. ESLint and Prettier keep the code consistent, and Vitest with Testing Library is used for tests.

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
npx pnpm@11.19.0 db:check
npx pnpm@11.19.0 db:generate
npx pnpm@11.19.0 dev
```

Then open [http://localhost:3000](http://localhost:3000). The responsive application shell and routes for the current MVP areas are ready to review. The pages are still placeholders and none of the nursery features have been built yet.

`db:up` starts PostgreSQL 18 and waits for it to accept connections. The first start creates both `anth_nursery` and `anth_nursery_test`. Database files are kept in a named Docker volume, so `db:down` stops the container without removing the data.

The database port is available only on this computer. The test database is created when the volume is first initialised; the existing unit tests do not use it yet.

## Commands

Run these through `npx pnpm@11.19.0` unless pnpm is already available directly.

| Command                    | What it does                                             |
| -------------------------- | -------------------------------------------------------- |
| `dev`                      | Starts the local development server.                     |
| `build`                    | Creates a production build.                              |
| `start`                    | Runs the production build locally.                       |
| `lint`                     | Checks the code with ESLint. Warnings count as failures. |
| `format`                   | Checks formatting with Prettier.                         |
| `format:write`             | Applies Prettier formatting.                             |
| `test`                     | Runs the test suite once.                                |
| `test:watch`               | Runs tests in watch mode.                                |
| `db:up`                    | Starts PostgreSQL and waits until it is healthy.         |
| `db:down`                  | Stops PostgreSQL while keeping its data.                 |
| `db:logs`                  | Follows the PostgreSQL container logs.                   |
| `db:check`                 | Checks both database connections through Prisma.         |
| `db:status`                | Checks migration status after the first migration.       |
| `db:generate`              | Regenerates Prisma's client after a schema change.       |
| `db:migrate --name <name>` | Creates and applies a named development migration.       |
| `db:studio`                | Opens Prisma Studio once the database has data.          |
| `db:validate`              | Checks the Prisma schema and database configuration.     |

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

Some of these folders do not exist yet on purpose. They will be added when the first feature actually needs them, rather than filling the project with empty structure.

## Database workflow

Prisma uses PostgreSQL 18 in development, testing, and eventual production. Development and testing use separate databases in the local Docker container. Their connection strings are configured through `DATABASE_URL` and `TEST_DATABASE_URL` in `.env`.

The Prisma schema is intentionally empty while the first Plant model is reviewed. The proposed fields, relationships, and rules are in [docs/plant-data-model.md](docs/plant-data-model.md).

Use `db:check` to verify both database connections. It runs `SELECT 1` through Prisma without creating tables or migrations. Prisma uses `DATABASE_URL` by default; the check temporarily passes `TEST_DATABASE_URL` to a separate Prisma process for the second connection without changing `.env`.

`db:status` is for migration history. Until the first migration exists, it reports that the database is not managed by Prisma Migrate and exits with an error. That is expected at this stage and does not mean the database connection has failed.

When a database change is agreed, update `prisma/schema.prisma`, create a named migration, check the generated SQL, add tests where they help, and commit the schema, migration, and related code together. Do not edit anything in `src/generated/prisma` by hand.

The local PostgreSQL username and password in `.env.example` are only development defaults. Production must use separate secret credentials supplied by the hosting environment.
