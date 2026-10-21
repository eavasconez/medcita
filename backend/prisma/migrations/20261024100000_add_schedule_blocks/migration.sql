-- Schedule blocks (S9-05): days a doctor, or the whole clinic, does not attend.
--
-- Only adds a table: nothing that exists is touched, and code from before this migration
-- never reads it, so an older release keeps working (it simply does not know about blocks).

-- CreateTable
CREATE TABLE "ScheduleBlock" (
    "id" TEXT NOT NULL,
    "startDate" TEXT NOT NULL,
    "endDate" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clinicId" TEXT NOT NULL,
    "doctorId" TEXT,

    CONSTRAINT "ScheduleBlock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScheduleBlock_clinicId_startDate_endDate_idx" ON "ScheduleBlock"("clinicId", "startDate", "endDate");

-- AddForeignKey
ALTER TABLE "ScheduleBlock" ADD CONSTRAINT "ScheduleBlock_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleBlock" ADD CONSTRAINT "ScheduleBlock_doctorId_clinicId_fkey" FOREIGN KEY ("doctorId", "clinicId") REFERENCES "Doctor"("id", "clinicId") ON DELETE CASCADE ON UPDATE CASCADE;

