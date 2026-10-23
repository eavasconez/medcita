-- Vital signs (S10-06): weight, height, blood pressure, heart and respiratory rate, temperature
-- and oxygen saturation of a patient, one row per set of measurements.
--
-- Only creates a table: nothing that exists is touched, and code from before this migration
-- never reads it, so an older release keeps working. The foreign keys are RESTRICT: a patient
-- or an appointment with readings cannot be deleted.

-- CreateTable
CREATE TABLE "PatientVitals" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clinicId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "appointmentId" TEXT,
    "measuredAt" TIMESTAMP(3) NOT NULL,
    "weightKg" DOUBLE PRECISION,
    "heightCm" DOUBLE PRECISION,
    "systolic" INTEGER,
    "diastolic" INTEGER,
    "heartRate" INTEGER,
    "respiratoryRate" INTEGER,
    "temperatureC" DOUBLE PRECISION,
    "oxygenSaturation" INTEGER,
    "recordedById" TEXT NOT NULL,
    "recordedByName" TEXT NOT NULL,
    "voidedAt" TIMESTAMP(3),
    "voidedById" TEXT,
    "voidedByName" TEXT,
    "voidReason" TEXT,

    CONSTRAINT "PatientVitals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PatientVitals_patientId_measuredAt_idx" ON "PatientVitals"("patientId", "measuredAt");

-- CreateIndex
CREATE INDEX "PatientVitals_appointmentId_idx" ON "PatientVitals"("appointmentId");

-- AddForeignKey
ALTER TABLE "PatientVitals" ADD CONSTRAINT "PatientVitals_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientVitals" ADD CONSTRAINT "PatientVitals_patientId_clinicId_fkey" FOREIGN KEY ("patientId", "clinicId") REFERENCES "Patient"("id", "clinicId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientVitals" ADD CONSTRAINT "PatientVitals_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

