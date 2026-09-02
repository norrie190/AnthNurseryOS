-- Prisma-equivalent tables, index and foreign keys; reviewed custom protections below.
-- No existing nursery records, reference sequences or previous migrations are changed.
BEGIN;

CREATE TABLE "WateringEvent" (
    "id" UUID NOT NULL,
    "plantId" UUID NOT NULL,
    "wateredAt" TIMESTAMPTZ(3) NOT NULL,
    "notes" TEXT,
    "voidedAt" TIMESTAMPTZ(3),
    "correctionReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "WateringEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WateringSchedulePeriod" (
    "id" UUID NOT NULL,
    "plantId" UUID NOT NULL,
    "intervalDays" INTEGER NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "notes" TEXT,
    "voidedAt" TIMESTAMPTZ(3),
    "correctionReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "WateringSchedulePeriod_pkey" PRIMARY KEY ("id")
);

-- Supports the newest qualifying event lookup without indexing retained void history.
CREATE INDEX "WateringEvent_plantId_wateredAt_nonvoid_idx"
    ON "WateringEvent"("plantId", "wateredAt" DESC)
    WHERE "voidedAt" IS NULL;

CREATE INDEX "WateringSchedulePeriod_plantId_effectiveFrom_idx"
    ON "WateringSchedulePeriod"("plantId", "effectiveFrom");

ALTER TABLE "WateringEvent"
    ADD CONSTRAINT "WateringEvent_plantId_fkey"
    FOREIGN KEY ("plantId") REFERENCES "Plant"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "WateringSchedulePeriod"
    ADD CONSTRAINT "WateringSchedulePeriod_plantId_fkey"
    FOREIGN KEY ("plantId") REFERENCES "Plant"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "WateringEvent"
    ADD CONSTRAINT "WateringEvent_wateredAt_check" CHECK (isfinite("wateredAt")),
    ADD CONSTRAINT "WateringEvent_void_reason_check" CHECK (
        "voidedAt" IS NULL OR ("correctionReason" IS NOT NULL AND "correctionReason" ~ '[^[:space:]]')
    );

ALTER TABLE "WateringSchedulePeriod"
    ADD CONSTRAINT "WateringSchedulePeriod_intervalDays_check" CHECK (
        "intervalDays" > 0 AND "intervalDays" <= 365
    ),
    ADD CONSTRAINT "WateringSchedulePeriod_interval_check" CHECK (
        isfinite("effectiveFrom") AND
        ("effectiveTo" IS NULL OR (isfinite("effectiveTo") AND "effectiveTo" > "effectiveFrom"))
    ),
    ADD CONSTRAINT "WateringSchedulePeriod_void_reason_check" CHECK (
        "voidedAt" IS NULL OR ("correctionReason" IS NOT NULL AND "correctionReason" ~ '[^[:space:]]')
    );

-- DATE intervals include the start and exclude the end; NULL means unbounded.
-- Adjacent periods and gaps are valid. Voided rows remain stored but do not block dates.
ALTER TABLE "WateringSchedulePeriod"
    ADD CONSTRAINT "WateringSchedulePeriod_no_overlap"
    EXCLUDE USING gist (
        "plantId" WITH =,
        daterange("effectiveFrom", "effectiveTo", '[)') WITH &&
    ) WHERE ("voidedAt" IS NULL);

COMMIT;
