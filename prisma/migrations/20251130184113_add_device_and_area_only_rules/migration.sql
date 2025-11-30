/*
  Warnings:

  - You are about to drop the column `label` on the `AccessRule` table. All the data in the column will be lost.

*/
-- CreateTable
CREATE TABLE "Device" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "haConnectionId" INTEGER NOT NULL,
    "entityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "area" TEXT,
    "label" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Device_haConnectionId_fkey" FOREIGN KEY ("haConnectionId") REFERENCES "HaConnection" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AccessRule" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "area" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AccessRule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_AccessRule" ("area", "createdAt", "id", "userId") SELECT "area", "createdAt", "id", "userId" FROM "AccessRule";
DROP TABLE "AccessRule";
ALTER TABLE "new_AccessRule" RENAME TO "AccessRule";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Device_haConnectionId_entityId_key" ON "Device"("haConnectionId", "entityId");
