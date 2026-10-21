-- Step 1 of 2 (clinics): create the Clinic table, add a still-optional clinicId to
-- every table and put all the data that exists today into one default clinic.
-- Nothing is constrained yet, so this step cannot fail on existing rows; the next
-- migration (require_clinic_id) makes the column required.

-- CreateTable
CREATE TABLE "Clinic" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'America/Guayaquil',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Clinic_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Clinic_slug_key" ON "Clinic"("slug");

-- AlterTable
ALTER TABLE "Doctor" ADD COLUMN     "clinicId" TEXT;

-- AlterTable
ALTER TABLE "Patient" ADD COLUMN     "clinicId" TEXT;

-- AlterTable
ALTER TABLE "Availability" ADD COLUMN     "clinicId" TEXT;

-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "clinicId" TEXT;

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "clinicId" TEXT;

-- The default clinic. It is only created when there is data to put in it, so a
-- brand-new database starts with no clinics (each one is created when it signs up).
INSERT INTO "Clinic" ("id", "name", "slug")
SELECT '00000000-0000-4000-8000-000000000001', 'Consultorio principal', 'principal'
WHERE EXISTS (SELECT 1 FROM "Doctor")
   OR EXISTS (SELECT 1 FROM "Patient")
   OR EXISTS (SELECT 1 FROM "AuditLog");

-- Backfill: everything that exists today belongs to the default clinic
UPDATE "Doctor" SET "clinicId" = '00000000-0000-4000-8000-000000000001' WHERE "clinicId" IS NULL;
UPDATE "Patient" SET "clinicId" = '00000000-0000-4000-8000-000000000001' WHERE "clinicId" IS NULL;
UPDATE "Availability" SET "clinicId" = '00000000-0000-4000-8000-000000000001' WHERE "clinicId" IS NULL;
UPDATE "Appointment" SET "clinicId" = '00000000-0000-4000-8000-000000000001' WHERE "clinicId" IS NULL;
UPDATE "AuditLog" SET "clinicId" = '00000000-0000-4000-8000-000000000001' WHERE "clinicId" IS NULL;
