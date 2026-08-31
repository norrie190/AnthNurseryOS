-- Prisma generated tables, index and foreign key; reviewed custom protections below.
-- No existing records, reference sequences or previous migrations are changed.
BEGIN;

-- Required for UUID equality in the Equipment period GiST exclusion constraint.
-- Hosting must provide btree_gist; do not replace overlap protection with app checks.
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA public;

CREATE TABLE "EquipmentPowerPeriod" (
    "id" UUID NOT NULL,
    "equipmentId" UUID NOT NULL,
    "powerWatts" DECIMAL(8,2) NOT NULL,
    "hoursPerDay" DECIMAL(4,2) NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "notes" TEXT,
    "correctionReason" TEXT,
    "voidedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "EquipmentPowerPeriod_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ElectricityTariff" (
    "id" UUID NOT NULL,
    "unitRateMinorPerKwh" DECIMAL(9,5) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'GBP',
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "notes" TEXT,
    "correctionReason" TEXT,
    "voidedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ElectricityTariff_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EquipmentPowerPeriod_equipmentId_effectiveFrom_idx" ON "EquipmentPowerPeriod"("equipmentId", "effectiveFrom");

ALTER TABLE "EquipmentPowerPeriod" ADD CONSTRAINT "EquipmentPowerPeriod_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Upper bounds also reject numeric NaN. Declared numeric scales are not input
-- validation: later application code must reject excess precision before SQL rounds it.
ALTER TABLE "EquipmentPowerPeriod"
    ADD CONSTRAINT "EquipmentPowerPeriod_powerWatts_check" CHECK ("powerWatts" >= 0 AND "powerWatts" <= 100000),
    ADD CONSTRAINT "EquipmentPowerPeriod_hoursPerDay_check" CHECK ("hoursPerDay" >= 0 AND "hoursPerDay" <= 24),
    ADD CONSTRAINT "EquipmentPowerPeriod_interval_check" CHECK (
        isfinite("effectiveFrom") AND
        ("effectiveTo" IS NULL OR (isfinite("effectiveTo") AND "effectiveTo" > "effectiveFrom"))
    ),
    ADD CONSTRAINT "EquipmentPowerPeriod_void_reason_check" CHECK (
        "voidedAt" IS NULL OR ("correctionReason" IS NOT NULL AND "correctionReason" ~ '[^[:space:]]')
    );

ALTER TABLE "ElectricityTariff"
    ADD CONSTRAINT "ElectricityTariff_rate_check" CHECK ("unitRateMinorPerKwh" >= 0 AND "unitRateMinorPerKwh" <= 1000),
    ADD CONSTRAINT "ElectricityTariff_currency_check" CHECK ("currency" = 'GBP'),
    ADD CONSTRAINT "ElectricityTariff_interval_check" CHECK (
        isfinite("effectiveFrom") AND
        ("effectiveTo" IS NULL OR (isfinite("effectiveTo") AND "effectiveTo" > "effectiveFrom"))
    ),
    ADD CONSTRAINT "ElectricityTariff_void_reason_check" CHECK (
        "voidedAt" IS NULL OR ("correctionReason" IS NOT NULL AND "correctionReason" ~ '[^[:space:]]')
    );

-- DATE intervals include the start and exclude the end; NULL means unbounded.
-- Adjacent periods and gaps are valid. Voided rows remain stored but do not block dates.
ALTER TABLE "EquipmentPowerPeriod"
    ADD CONSTRAINT "EquipmentPowerPeriod_no_overlap"
    EXCLUDE USING gist (
        "equipmentId" WITH =,
        daterange("effectiveFrom", "effectiveTo", '[)') WITH &&
    ) WHERE ("voidedAt" IS NULL);

-- A single nursery tariff timeline, not a tariff per Equipment or per currency.
ALTER TABLE "ElectricityTariff"
    ADD CONSTRAINT "ElectricityTariff_no_overlap"
    EXCLUDE USING gist (
        daterange("effectiveFrom", "effectiveTo", '[)') WITH &&
    ) WHERE ("voidedAt" IS NULL);

COMMIT;
