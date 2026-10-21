-- Appointment types (S9-04): how long each kind of visit lasts.
--
-- Runs over data that already exists (production has appointments), so the order matters:
-- create the table, give every clinic its default 30-minute type, add the new columns to
-- Appointment, point every existing appointment at its clinic's default type, and only
-- then add the foreign keys. Appointment.typeId stays nullable on purpose: code from before
-- this migration can keep booking (it simply sets no type) and going back to an older
-- release never breaks booking.

-- CreateTable
CREATE TABLE "AppointmentType" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "color" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clinicId" TEXT NOT NULL,

    CONSTRAINT "AppointmentType_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AppointmentType_clinicId_name_key" ON "AppointmentType"("clinicId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "AppointmentType_id_clinicId_key" ON "AppointmentType"("id", "clinicId");

-- AddForeignKey
ALTER TABLE "AppointmentType" ADD CONSTRAINT "AppointmentType_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Every clinic that exists gets the default type: 30 minutes, what every appointment was until now
INSERT INTO "AppointmentType" ("id", "name", "durationMinutes", "color", "isDefault", "clinicId")
SELECT gen_random_uuid()::text, 'Consultation', 30, '#0ea5e9', true, "id" FROM "Clinic";

-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "durationMinutes" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "typeId" TEXT;

-- Every existing appointment becomes a default-type one (its 30 minutes are the column default)
UPDATE "Appointment" a
SET "typeId" = t."id"
FROM "AppointmentType" t
WHERE t."clinicId" = a."clinicId" AND t."isDefault";

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_typeId_clinicId_fkey" FOREIGN KEY ("typeId", "clinicId") REFERENCES "AppointmentType"("id", "clinicId") ON DELETE RESTRICT ON UPDATE CASCADE;
