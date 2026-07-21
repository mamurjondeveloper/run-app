-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Run" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'in_progress',
    "distanceMeters" REAL NOT NULL DEFAULT 0,
    "durationSec" INTEGER NOT NULL DEFAULT 0,
    "avgSpeedKmh" REAL NOT NULL DEFAULT 0,
    "maxSpeedKmh" REAL NOT NULL DEFAULT 0,
    "pointsEarned" INTEGER NOT NULL DEFAULT 0,
    "path" TEXT,
    "flaggedSegments" INTEGER NOT NULL DEFAULT 0,
    "plannedRoutePath" TEXT,
    "plannedDistanceMeters" REAL,
    "elevationGainM" REAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Run_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Run" ("avgSpeedKmh", "createdAt", "distanceMeters", "durationSec", "endedAt", "flaggedSegments", "id", "maxSpeedKmh", "path", "plannedDistanceMeters", "plannedRoutePath", "pointsEarned", "startedAt", "status", "userId") SELECT "avgSpeedKmh", "createdAt", "distanceMeters", "durationSec", "endedAt", "flaggedSegments", "id", "maxSpeedKmh", "path", "plannedDistanceMeters", "plannedRoutePath", "pointsEarned", "startedAt", "status", "userId" FROM "Run";
DROP TABLE "Run";
ALTER TABLE "new_Run" RENAME TO "Run";
CREATE INDEX "Run_userId_startedAt_idx" ON "Run"("userId", "startedAt");
CREATE INDEX "Run_status_startedAt_idx" ON "Run"("status", "startedAt");
CREATE TABLE "new_UserStats" (
    "userId" TEXT NOT NULL PRIMARY KEY,
    "totalDistanceM" REAL NOT NULL DEFAULT 0,
    "totalRuns" INTEGER NOT NULL DEFAULT 0,
    "totalPoints" INTEGER NOT NULL DEFAULT 0,
    "bestMaxSpeedKmh" REAL NOT NULL DEFAULT 0,
    "currentStreakDays" INTEGER NOT NULL DEFAULT 0,
    "longestStreakDays" INTEGER NOT NULL DEFAULT 0,
    "lastRunDate" DATETIME,
    "speedViolationCount" INTEGER NOT NULL DEFAULT 0,
    "totalElevationM" REAL NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "UserStats_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_UserStats" ("bestMaxSpeedKmh", "currentStreakDays", "lastRunDate", "longestStreakDays", "speedViolationCount", "totalDistanceM", "totalPoints", "totalRuns", "updatedAt", "userId") SELECT "bestMaxSpeedKmh", "currentStreakDays", "lastRunDate", "longestStreakDays", "speedViolationCount", "totalDistanceM", "totalPoints", "totalRuns", "updatedAt", "userId" FROM "UserStats";
DROP TABLE "UserStats";
ALTER TABLE "new_UserStats" RENAME TO "UserStats";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
