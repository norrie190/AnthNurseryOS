# Anth Nursery OS development guide

## Project direction

The main source of truth is `docs/Initial Project Spec.pdf`. If an architecture decision is made, write it down in `docs/architecture.md` so it is clear later why it was chosen.

Build the MVP one piece at a time. Do not start breeding, pollen, seed batches, seedlings, ancestry, sales, environmental integrations, or other future ideas early just because the structure could support them. The current foundation stage does not include Plant CRUD or any other nursery workflow.

Important nursery history should not be permanently deleted. When those records are added, use clear statuses or archive fields instead.

## Code and structure

Use strict TypeScript for application code. Routes and page composition belong in `src/app`. When a feature starts, keep its UI, rules, validation, and data access together in `src/modules/<feature>/` rather than spreading them around the app.

Only add to `src/components` when a UI component is genuinely shared. Only add to `src/lib` when something is shared infrastructure. Keep database access and other server-only code out of client components.

Use Zod at input and integration boundaries. Prefer named functions and proper domain types over loosely shaped objects. The database schema lives in `prisma/schema.prisma`; `src/generated/prisma` is generated code and should never be edited by hand.

## Database changes

Migrations are part of the project's history. Review them and commit them, but do not edit an applied migration. Make a new one instead.

Use archival or status changes rather than destructive operations in the app. Time-based nursery information, such as care and observations, should keep its history as events rather than overwriting old records. Do not add database tables for a future feature before the relevant phase starts; add the smallest useful bit of schema at the time.

## Quality and documentation

Before handing over a milestone, run `pnpm lint`, `pnpm format`, `pnpm test`, `pnpm db:validate`, and `pnpm build`. Tests should be focused on useful rules and regressions, and should not depend on real external services.

Update `README.md` if the developer workflow changes. Update `docs/architecture.md` when a real architectural or persistence decision is made. Keep the app accessible: use semantic HTML, support keyboard use, make contrast readable, and do not rely on colour alone for status.

## Git

Keep commits small and about one thing. A tooling change, a migration, a single feature slice, and a focused fix are all good commit boundaries. Do not hide a big refactor inside a feature commit.

Check the working tree before committing. Do not commit `.env`, SQLite database files, generated output, dependencies, or build files. Do not use destructive Git commands such as `reset --hard` or force pushes unless the user has explicitly asked for them.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
