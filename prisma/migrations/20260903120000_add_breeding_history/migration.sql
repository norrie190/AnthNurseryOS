-- Breeding / propagation history tables. Historical records are retained.
BEGIN;

CREATE TYPE "InflorescenceStatus" AS ENUM ('OBSERVED', 'OPEN', 'FINISHED', 'ABORTED');
CREATE TYPE "PollinationAttemptStatus" AS ENUM ('PENDING', 'DEVELOPING', 'FAILED', 'HARVESTED');
CREATE TYPE "PollenSourceMode" AS ENUM ('INTERNAL', 'EXTERNAL', 'UNKNOWN');
CREATE TYPE "SeedBatchStatus" AS ENUM ('HARVESTED', 'AWAITING_GERMINATION', 'GERMINATING', 'EXHAUSTED', 'FAILED');

CREATE TABLE "Inflorescence" (
    "id" UUID NOT NULL,
    "plantId" UUID NOT NULL,
    "status" "InflorescenceStatus" NOT NULL DEFAULT 'OBSERVED',
    "emergedOn" DATE,
    "openedOn" DATE,
    "notes" TEXT,
    "voidedAt" TIMESTAMPTZ(3),
    "correctionReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "Inflorescence_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PollinationAttempt" (
    "id" UUID NOT NULL,
    "inflorescenceId" UUID NOT NULL,
    "pollinatedOn" DATE NOT NULL,
    "status" "PollinationAttemptStatus" NOT NULL DEFAULT 'PENDING',
    "pollenSourceMode" "PollenSourceMode" NOT NULL,
    "pollenParentPlantId" UUID,
    "pollenParentName" TEXT,
    "pollenBreeder" TEXT,
    "pollenCultivar" TEXT,
    "notes" TEXT,
    "voidedAt" TIMESTAMPTZ(3),
    "correctionReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "PollinationAttempt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SeedBatch" (
    "id" UUID NOT NULL,
    "pollinationAttemptId" UUID NOT NULL,
    "harvestedOn" DATE NOT NULL,
    "sownOn" DATE,
    "seedCount" INTEGER,
    "germinatedCount" INTEGER,
    "status" "SeedBatchStatus" NOT NULL DEFAULT 'HARVESTED',
    "notes" TEXT,
    "voidedAt" TIMESTAMPTZ(3),
    "correctionReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "SeedBatch_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Inflorescence_plantId_createdAt_idx" ON "Inflorescence"("plantId", "createdAt");
CREATE INDEX "Inflorescence_plantId_emergedOn_idx" ON "Inflorescence"("plantId", "emergedOn");
CREATE INDEX "PollinationAttempt_inflorescenceId_pollinatedOn_idx" ON "PollinationAttempt"("inflorescenceId", "pollinatedOn");
CREATE INDEX "PollinationAttempt_pollenParentPlantId_pollinatedOn_idx" ON "PollinationAttempt"("pollenParentPlantId", "pollinatedOn");
CREATE INDEX "SeedBatch_pollinationAttemptId_harvestedOn_idx" ON "SeedBatch"("pollinationAttemptId", "harvestedOn");

ALTER TABLE "Inflorescence"
  ADD CONSTRAINT "Inflorescence_plantId_fkey" FOREIGN KEY ("plantId") REFERENCES "Plant"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "PollinationAttempt"
  ADD CONSTRAINT "PollinationAttempt_inflorescenceId_fkey" FOREIGN KEY ("inflorescenceId") REFERENCES "Inflorescence"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "PollinationAttempt_pollenParentPlantId_fkey" FOREIGN KEY ("pollenParentPlantId") REFERENCES "Plant"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "SeedBatch"
  ADD CONSTRAINT "SeedBatch_pollinationAttemptId_fkey" FOREIGN KEY ("pollinationAttemptId") REFERENCES "PollinationAttempt"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "Inflorescence"
  ADD CONSTRAINT "Inflorescence_dates_check" CHECK ("openedOn" IS NULL OR "emergedOn" IS NULL OR "openedOn" >= "emergedOn"),
  ADD CONSTRAINT "Inflorescence_void_reason_check" CHECK ("voidedAt" IS NULL OR ("correctionReason" IS NOT NULL AND "correctionReason" ~ '[^[:space:]]'));
ALTER TABLE "PollinationAttempt"
  ADD CONSTRAINT "PollinationAttempt_pollen_source_check" CHECK (
    ("pollenSourceMode" = 'INTERNAL' AND "pollenParentPlantId" IS NOT NULL AND "pollenParentName" IS NULL AND "pollenBreeder" IS NULL AND "pollenCultivar" IS NULL)
    OR ("pollenSourceMode" = 'EXTERNAL' AND "pollenParentPlantId" IS NULL AND "pollenParentName" IS NOT NULL AND "pollenParentName" ~ '[^[:space:]]')
    OR ("pollenSourceMode" = 'UNKNOWN' AND "pollenParentPlantId" IS NULL AND "pollenParentName" IS NULL AND "pollenBreeder" IS NULL AND "pollenCultivar" IS NULL)
  ),
  ADD CONSTRAINT "PollinationAttempt_void_reason_check" CHECK ("voidedAt" IS NULL OR ("correctionReason" IS NOT NULL AND "correctionReason" ~ '[^[:space:]]'));
ALTER TABLE "SeedBatch"
  ADD CONSTRAINT "SeedBatch_counts_check" CHECK (
    ("seedCount" IS NULL OR "seedCount" >= 0)
    AND ("germinatedCount" IS NULL OR "germinatedCount" >= 0)
    AND ("seedCount" IS NULL OR "germinatedCount" IS NULL OR "germinatedCount" <= "seedCount")
  ),
  ADD CONSTRAINT "SeedBatch_dates_check" CHECK ("sownOn" IS NULL OR "sownOn" >= "harvestedOn"),
  ADD CONSTRAINT "SeedBatch_void_reason_check" CHECK ("voidedAt" IS NULL OR ("correctionReason" IS NOT NULL AND "correctionReason" ~ '[^[:space:]]'));

CREATE UNIQUE INDEX "PollinationAttempt_one_live_per_inflorescence_uidx"
  ON "PollinationAttempt"("inflorescenceId") WHERE "voidedAt" IS NULL;

COMMIT;
