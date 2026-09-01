BEGIN;

-- CreateTable
CREATE TABLE "EquipmentPhoto" (
    "id" UUID NOT NULL,
    "equipmentId" UUID NOT NULL,
    "storageKey" TEXT NOT NULL,
    "originalFilename" TEXT,
    "caption" TEXT,
    "takenAt" TIMESTAMPTZ(3),
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "cropX" DOUBLE PRECISION,
    "cropY" DOUBLE PRECISION,
    "cropSize" DOUBLE PRECISION,
    "derivativeRevision" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "EquipmentPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EquipmentPhoto_storageKey_key" ON "EquipmentPhoto"("storageKey");

-- CreateIndex
CREATE INDEX "EquipmentPhoto_equipmentId_sortOrder_idx" ON "EquipmentPhoto"("equipmentId", "sortOrder");

-- At most one primary photo per Equipment; non-primary photos remain unrestricted.
CREATE UNIQUE INDEX "EquipmentPhoto_one_primary_per_equipment_key"
ON "EquipmentPhoto" ("equipmentId")
WHERE "isPrimary" = true;

-- Crop metadata is either absent for every field or complete for every field.
ALTER TABLE "EquipmentPhoto"
    ADD CONSTRAINT "EquipmentPhoto_crop_consistency_check"
    CHECK (
        (
            "cropX" IS NULL
            AND "cropY" IS NULL
            AND "cropSize" IS NULL
            AND "derivativeRevision" IS NULL
        )
        OR
        (
            "cropX" IS NOT NULL
            AND "cropY" IS NOT NULL
            AND "cropSize" IS NOT NULL
            AND "derivativeRevision" IS NOT NULL
        )
    );

-- Oriented image dimensions and complete rectangle bounds remain application rules.
ALTER TABLE "EquipmentPhoto"
    ADD CONSTRAINT "EquipmentPhoto_crop_ranges_check"
    CHECK (
        "cropX" IS NULL
        OR (
            "cropX" >= 0 AND "cropX" < 1
            AND "cropY" >= 0 AND "cropY" < 1
            AND "cropSize" > 0 AND "cropSize" <= 1
        )
    );

-- AddForeignKey
ALTER TABLE "EquipmentPhoto" ADD CONSTRAINT "EquipmentPhoto_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

COMMIT;
