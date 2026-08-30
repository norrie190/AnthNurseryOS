-- Apply the initial schema and its custom constraints atomically.
BEGIN;

-- CreateEnum
CREATE TYPE "PlantStatus" AS ENUM ('GROWING', 'QUARANTINE', 'SOLD', 'DECEASED');

-- CreateTable
CREATE TABLE "Plant" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "name" TEXT,
    "status" "PlantStatus" NOT NULL DEFAULT 'GROWING',
    "locationId" UUID,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "archivedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Plant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlantParentage" (
    "id" UUID NOT NULL,
    "plantId" UUID NOT NULL,
    "seedParentPlantId" UUID,
    "seedParentName" TEXT,
    "pollenParentPlantId" UUID,
    "pollenParentName" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PlantParentage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlantPurchase" (
    "id" UUID NOT NULL,
    "plantId" UUID NOT NULL,
    "seller" TEXT,
    "orderReference" TEXT,
    "purchaseDate" DATE,
    "plantPriceMinor" INTEGER,
    "shippingCostMinor" INTEGER,
    "otherCostMinor" INTEGER,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'GBP',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PlantPurchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlantPhoto" (
    "id" UUID NOT NULL,
    "plantId" UUID NOT NULL,
    "storageKey" TEXT NOT NULL,
    "originalFilename" TEXT,
    "caption" TEXT,
    "takenAt" TIMESTAMPTZ(3),
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PlantPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Location" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "parentLocationId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "archivedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Plant_reference_key" ON "Plant"("reference");

-- CreateIndex
CREATE INDEX "Plant_locationId_idx" ON "Plant"("locationId");

-- CreateIndex
CREATE UNIQUE INDEX "PlantParentage_plantId_key" ON "PlantParentage"("plantId");

-- CreateIndex
CREATE INDEX "PlantParentage_seedParentPlantId_idx" ON "PlantParentage"("seedParentPlantId");

-- CreateIndex
CREATE INDEX "PlantParentage_pollenParentPlantId_idx" ON "PlantParentage"("pollenParentPlantId");

-- CreateIndex
CREATE UNIQUE INDEX "PlantPurchase_plantId_key" ON "PlantPurchase"("plantId");

-- CreateIndex
CREATE UNIQUE INDEX "PlantPhoto_storageKey_key" ON "PlantPhoto"("storageKey");

-- CreateIndex
CREATE INDEX "PlantPhoto_plantId_sortOrder_idx" ON "PlantPhoto"("plantId", "sortOrder");

-- CreateIndex
-- Prisma cannot express NULLS NOT DISTINCT. Treat null parent IDs as one root
-- group, while still allowing the same name beneath different parent Locations.
CREATE UNIQUE INDEX "Location_parentLocationId_name_key" ON "Location"("parentLocationId", "name") NULLS NOT DISTINCT;

-- AddForeignKey
ALTER TABLE "Plant" ADD CONSTRAINT "Plant_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "PlantParentage" ADD CONSTRAINT "PlantParentage_plantId_fkey" FOREIGN KEY ("plantId") REFERENCES "Plant"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "PlantParentage" ADD CONSTRAINT "PlantParentage_seedParentPlantId_fkey" FOREIGN KEY ("seedParentPlantId") REFERENCES "Plant"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "PlantParentage" ADD CONSTRAINT "PlantParentage_pollenParentPlantId_fkey" FOREIGN KEY ("pollenParentPlantId") REFERENCES "Plant"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "PlantPurchase" ADD CONSTRAINT "PlantPurchase_plantId_fkey" FOREIGN KEY ("plantId") REFERENCES "Plant"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "PlantPhoto" ADD CONSTRAINT "PlantPhoto_plantId_fkey" FOREIGN KEY ("plantId") REFERENCES "Plant"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_parentLocationId_fkey" FOREIGN KEY ("parentLocationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Prisma cannot express these CHECK constraints. Unknown costs remain null;
-- known costs must be zero or greater. No default replaces an unknown value.
ALTER TABLE "PlantPurchase"
    ADD CONSTRAINT "PlantPurchase_plantPriceMinor_nonnegative" CHECK ("plantPriceMinor" >= 0),
    ADD CONSTRAINT "PlantPurchase_shippingCostMinor_nonnegative" CHECK ("shippingCostMinor" >= 0),
    ADD CONSTRAINT "PlantPurchase_otherCostMinor_nonnegative" CHECK ("otherCostMinor" >= 0);

COMMIT;
