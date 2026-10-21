-- CreateTable
CREATE TABLE "NotificationLog" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clinicId" TEXT,
    "appointmentId" TEXT,
    "kind" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "errorCode" TEXT,
    "error" TEXT,
    "providerMessageId" TEXT,
    "destination" TEXT NOT NULL,

    CONSTRAINT "NotificationLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NotificationLog_clinicId_createdAt_idx" ON "NotificationLog"("clinicId", "createdAt");

-- CreateIndex
CREATE INDEX "NotificationLog_appointmentId_createdAt_idx" ON "NotificationLog"("appointmentId", "createdAt");

