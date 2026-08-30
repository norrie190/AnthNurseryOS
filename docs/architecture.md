# Initial application architecture

## What this project is

Anth Nursery OS is a management app for one small nursery. It starts with my own Anthurium collection and breeding programme, so it needs to be useful day to day as well as a good software project to show in a portfolio.

The first MVP is plants, care, equipment, expenses, and a dashboard. Breeding and ancestry are important, but they are later phases and should not make the first version more complicated than it needs to be.

## Choices made for the foundation

The app uses Next.js with React and TypeScript. Keeping the frontend and server side in one TypeScript project makes sense for a small single user application and keeps the local setup simple.

Features will live in `src/modules`. For example, when Plant Management starts, its components, validation, rules, and data access should sit together in a `plants` module. This should stop the app becoming one large folder of unrelated files as more nursery areas are added.

Prisma with PostgreSQL 18 is the database foundation. Development, testing, and production use the same database engine so local migrations and database behaviour match the eventual production environment. Docker Compose runs PostgreSQL locally with a persistent named volume. The development and test databases are separate but run in the same local container.

SQLite was used briefly during the empty foundation stage because it required no database server. It was removed before any application models or migrations were created, so there is no application data or migration history to convert.

Zod is there for checking data at the edges of the app. Vitest and Testing Library are used for tests. Styling starts with ordinary CSS so the UI can develop naturally before deciding whether a design system is actually needed.

## Application shell

The main layout is shared by every route. It uses a fixed sidebar on larger screens and a slide out menu on smaller screens, so each feature can keep the same navigation without rebuilding it. The navigation is the only client side part of the shell because it needs the current route and the mobile menu state. The rest stays server rendered by default.

Shared colours, spacing, borders, and type values are kept as CSS variables in `src/app/globals.css`. Individual components use CSS Modules so their layout rules stay with them. Lucide React supplies the simple line icons used throughout the shell. This avoids drawing and maintaining our own icons, while keeping them consistent and accessible.

Only the current MVP areas are shown in the main navigation: Dashboard, Plants, Care, Equipment, and Expenses. Later features should be added when their phase starts, rather than appearing as empty promises in the app now. Search, notifications, and theme controls are present only as disabled layout placeholders and have no behaviour yet.

## Folder structure

```text
src/
  app/              Next.js routes and layouts
  components/       Shared presentational UI, only when it is genuinely shared
  lib/              Shared infrastructure helpers
  modules/
    <feature>/      Code that belongs to one feature
  generated/        Prisma generated code; ignored by Git
prisma/
  schema.prisma     The source database schema
  migrations/       Reviewed migration history
tests/              Shared test setup and helpers
docs/               Project and technical notes
```

The `components`, `lib`, and `modules` folders are not being created just to make the tree look finished. They should appear when there is code that belongs in them.

## Database starting point

Prisma and PostgreSQL 18 are configured, but there are no application tables or migrations yet. Database design comes immediately before Plant Management. At that point the Plant fields, IDs, statuses, archive behaviour, and relationships need to be agreed before a schema is written.

The original project specification already gives a few important rules for later work. Historical records need to be kept through archive or status logic rather than deletion. Care should be stored as events, and values such as last watered or last fertilised should be worked out from those events instead of being separate editable fields. When breeding is built, real breeding events and possible future crosses should be separate. Seedlings should use the main Plant record and link back to their origin rather than becoming a disconnected set of records.

The reviewed Plant Management design is kept in `docs/plant-data-model.md` before it is translated into Prisma. This keeps product decisions separate from the implementation details of a particular database tool and gives the schema migration a clear review point.

## Keeping it tidy as it grows

Any meaningful architecture change should be recorded here with a short reason. New dependencies need to help with the current phase, not a vague future idea. When the database starts, each migration should be reviewed and committed with the code and tests that use it.
