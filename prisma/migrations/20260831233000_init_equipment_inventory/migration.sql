-- Generated with prisma migrate diff, then reviewed before deployment.
-- Equipment inventory only. Existing Plant and Location schema stays intact.
BEGIN;

-- CreateTable
CREATE TABLE "Equipment" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'Other',
    "brand" TEXT,
    "model" TEXT,
    "serialNumber" TEXT,
    "notes" TEXT,
    "usesPower" BOOLEAN NOT NULL,
    "locationId" UUID,
    "archivedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Equipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EquipmentPurchase" (
    "id" UUID NOT NULL,
    "equipmentId" UUID NOT NULL,
    "seller" TEXT,
    "orderReference" TEXT,
    "purchaseDate" DATE,
    "equipmentPriceMinor" INTEGER,
    "shippingCostMinor" INTEGER,
    "otherCostMinor" INTEGER,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'GBP',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "EquipmentPurchase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Equipment_reference_key" ON "Equipment"("reference");

-- CreateIndex
CREATE INDEX "Equipment_locationId_idx" ON "Equipment"("locationId");

-- CreateIndex
CREATE UNIQUE INDEX "EquipmentPurchase_equipmentId_key" ON "EquipmentPurchase"("equipmentId");

-- AddForeignKey
ALTER TABLE "Equipment" ADD CONSTRAINT "Equipment_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "EquipmentPurchase" ADD CONSTRAINT "EquipmentPurchase_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Prisma cannot express these CHECK constraints. Null remains unknown; zero is valid.
-- Shipping is the amount allocated to this item, not the full cost of a shared order.
ALTER TABLE "EquipmentPurchase"
    ADD CONSTRAINT "EquipmentPurchase_equipmentPriceMinor_nonnegative" CHECK ("equipmentPriceMinor" >= 0),
    ADD CONSTRAINT "EquipmentPurchase_shippingCostMinor_nonnegative" CHECK ("shippingCostMinor" >= 0),
    ADD CONSTRAINT "EquipmentPurchase_otherCostMinor_nonnegative" CHECK ("otherCostMinor" >= 0);

COMMIT;
