-- Step 2 of 2 (clinics): every record must belong to a clinic.
--
-- Rows written between the two steps (for example by a version of the app that
-- does not know about clinics yet) have no clinic. They go to the default clinic
-- first, so that making the column required cannot fail on them.
INSERT INTO "Clinic" ("id", "name", "slug")
SELECT '00000000-0000-4000-8000-000000000001', 'Consultorio principal', 'principal'
WHERE (EXISTS (SELECT 1 FROM "Doctor" WHERE "clinicId" IS NULL)
    OR EXISTS (SELECT 1 FROM "Patient" WHERE "clinicId" IS NULL)
    OR EXISTS (SELECT 1 FROM "Availability" WHERE "clinicId" IS NULL)
    OR EXISTS (SELECT 1 FROM "Appointment" WHERE "clinicId" IS NULL)
    OR EXISTS (SELECT 1 FROM "AuditLog" WHERE "clinicId" IS NULL))
ON CONFLICT DO NOTHING;

UPDATE "Doctor" SET "clinicId" = '00000000-0000-4000-8000-000000000001' WHERE "clinicId" IS NULL;
UPDATE "Patient" SET "clinicId" = '00000000-0000-4000-8000-000000000001' WHERE "clinicId" IS NULL;
UPDATE "Availability" SET "clinicId" = '00000000-0000-4000-8000-000000000001' WHERE "clinicId" IS NULL;
UPDATE "Appointment" SET "clinicId" = '00000000-0000-4000-8000-000000000001' WHERE "clinicId" IS NULL;
UPDATE "AuditLog" SET "clinicId" = '00000000-0000-4000-8000-000000000001' WHERE "clinicId" IS NULL;

-- DropForeignKey
ALTER TABLE "Appointment" DROP CONSTRAINT "Appointment_doctorId_fkey";

-- DropForeignKey
ALTER TABLE "Appointment" DROP CONSTRAINT "Appointment_patientId_fkey";

-- DropForeignKey
ALTER TABLE "Availability" DROP CONSTRAINT "Availability_doctorId_fkey";

-- DropIndex
DROP INDEX "Patient_cedula_key";

-- DropIndex
DROP INDEX "Patient_phone_key";

-- AlterTable
ALTER TABLE "Appointment" ALTER COLUMN "clinicId" SET NOT NULL;

-- AlterTable
ALTER TABLE "AuditLog" ALTER COLUMN "clinicId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Availability" ALTER COLUMN "clinicId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Doctor" ALTER COLUMN "clinicId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Patient" ALTER COLUMN "clinicId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "Appointment_clinicId_date_idx" ON "Appointment"("clinicId", "date");

-- CreateIndex
CREATE INDEX "AuditLog_clinicId_createdAt_seq_idx" ON "AuditLog"("clinicId", "createdAt", "seq");

-- CreateIndex
CREATE INDEX "Doctor_clinicId_idx" ON "Doctor"("clinicId");

-- CreateIndex
CREATE UNIQUE INDEX "Doctor_id_clinicId_key" ON "Doctor"("id", "clinicId");

-- CreateIndex
CREATE UNIQUE INDEX "Patient_clinicId_phone_key" ON "Patient"("clinicId", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "Patient_clinicId_cedula_key" ON "Patient"("clinicId", "cedula");

-- CreateIndex
CREATE UNIQUE INDEX "Patient_id_clinicId_key" ON "Patient"("id", "clinicId");

-- AddForeignKey
ALTER TABLE "Doctor" ADD CONSTRAINT "Doctor_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Patient" ADD CONSTRAINT "Patient_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Availability" ADD CONSTRAINT "Availability_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Availability" ADD CONSTRAINT "Availability_doctorId_clinicId_fkey" FOREIGN KEY ("doctorId", "clinicId") REFERENCES "Doctor"("id", "clinicId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_doctorId_clinicId_fkey" FOREIGN KEY ("doctorId", "clinicId") REFERENCES "Doctor"("id", "clinicId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_patientId_clinicId_fkey" FOREIGN KEY ("patientId", "clinicId") REFERENCES "Patient"("id", "clinicId") ON DELETE RESTRICT ON UPDATE CASCADE;

