-- AlterTable
ALTER TABLE "Plant" ADD COLUMN     "originSeedBatchId" UUID;

-- CreateIndex
CREATE INDEX "Plant_originSeedBatchId_idx" ON "Plant"("originSeedBatchId");

-- AddForeignKey
ALTER TABLE "Plant" ADD CONSTRAINT "Plant_originSeedBatchId_fkey" FOREIGN KEY ("originSeedBatchId") REFERENCES "SeedBatch"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
