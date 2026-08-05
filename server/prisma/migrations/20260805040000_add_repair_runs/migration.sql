-- CreateTable
CREATE TABLE "RepairRun" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "area" TEXT NOT NULL,
    "model" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'running',
    "filesModified" JSONB,
    "validationResult" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RepairRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RepairRun_projectId_createdAt_idx" ON "RepairRun"("projectId", "createdAt");

-- AddForeignKey
ALTER TABLE "RepairRun" ADD CONSTRAINT "RepairRun_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
