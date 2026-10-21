-- CreateTable
CREATE TABLE "PatientConsent" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clinicId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "documentVersion" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "recordedById" TEXT NOT NULL,
    "recordedByName" TEXT NOT NULL,
    "recordedByRole" TEXT NOT NULL,

    CONSTRAINT "PatientConsent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PatientConsent_patientId_createdAt_idx" ON "PatientConsent"("patientId", "createdAt");

-- CreateIndex
CREATE INDEX "PatientConsent_clinicId_createdAt_idx" ON "PatientConsent"("clinicId", "createdAt");

-- AddForeignKey
ALTER TABLE "PatientConsent" ADD CONSTRAINT "PatientConsent_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientConsent" ADD CONSTRAINT "PatientConsent_patientId_clinicId_fkey" FOREIGN KEY ("patientId", "clinicId") REFERENCES "Patient"("id", "clinicId") ON DELETE CASCADE ON UPDATE CASCADE;
