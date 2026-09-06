-- AlterTable
ALTER TABLE "Run" ADD COLUMN "lastLat" REAL;
ALTER TABLE "Run" ADD COLUMN "lastLng" REAL;
ALTER TABLE "Run" ADD COLUMN "lastPingAt" DATETIME;

-- CreateIndex
CREATE INDEX "Run_status_lastPingAt_idx" ON "Run"("status", "lastPingAt");
