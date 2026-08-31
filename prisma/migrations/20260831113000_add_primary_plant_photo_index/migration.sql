-- Partial uniqueness cannot be expressed by the current Prisma model.
-- This protects primary selection without restricting nonprimary photographs.
-- Existing conflicting rows must be reviewed, never silently rewritten.
BEGIN;

CREATE UNIQUE INDEX "PlantPhoto_one_primary_per_plant_key"
ON "PlantPhoto" ("plantId")
WHERE "isPrimary" = true;

COMMIT;
