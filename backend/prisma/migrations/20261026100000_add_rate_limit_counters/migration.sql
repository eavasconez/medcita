-- Persistent rate limits (S9-08): the counters of the login, password reset and sign-up limits
-- move from the server's memory to this table, so a deploy no longer resets them and every
-- instance of the backend shares them.
--
-- Only adds a table: nothing that exists is touched, and an older release keeps its limits in
-- memory and never reads it, so going back is safe.

-- CreateTable
CREATE TABLE "RateLimitCounter" (
    "key" TEXT NOT NULL,
    "hits" INTEGER NOT NULL,
    "resetAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimitCounter_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "RateLimitCounter_resetAt_idx" ON "RateLimitCounter"("resetAt");

