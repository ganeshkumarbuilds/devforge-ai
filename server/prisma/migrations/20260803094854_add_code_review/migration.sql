-- CreateTable
CREATE TABLE "CodeReview" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'processing',
    "summary" TEXT,
    "scores" JSONB,
    "results" JSONB,
    "files" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CodeReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CodeReview_userId_createdAt_idx" ON "CodeReview"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "CodeReview" ADD CONSTRAINT "CodeReview_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
