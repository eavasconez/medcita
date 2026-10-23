-- Diagnoses (S10-05): the ICD-10 catalogue and the diagnoses of a consultation note.
--
-- Only creates two tables: nothing that exists is touched, and code from before this
-- migration never reads them, so an older release keeps working. The catalogue starts empty
-- (it is loaded with `npm run diagnoses:import`). The diagnoses of a note are RESTRICT, like
-- the note itself: a note with diagnoses cannot be deleted.

-- CreateTable
CREATE TABLE "DiagnosisCode" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "codeKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "searchText" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "selectable" BOOLEAN NOT NULL DEFAULT true,
    "source" TEXT NOT NULL,
    "version" TEXT NOT NULL DEFAULT 'CIE10',

    CONSTRAINT "DiagnosisCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsultationDiagnosis" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clinicId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "noteId" TEXT NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'secondary',
    "certainty" TEXT NOT NULL DEFAULT 'presumptive',
    "recordedById" TEXT NOT NULL,
    "recordedByName" TEXT NOT NULL,

    CONSTRAINT "ConsultationDiagnosis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DiagnosisCode_code_key" ON "DiagnosisCode"("code");

-- CreateIndex
CREATE INDEX "DiagnosisCode_codeKey_idx" ON "DiagnosisCode"("codeKey");

-- CreateIndex
CREATE INDEX "DiagnosisCode_source_idx" ON "DiagnosisCode"("source");

-- CreateIndex
CREATE INDEX "ConsultationDiagnosis_patientId_createdAt_idx" ON "ConsultationDiagnosis"("patientId", "createdAt");

-- CreateIndex
CREATE INDEX "ConsultationDiagnosis_code_idx" ON "ConsultationDiagnosis"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ConsultationDiagnosis_noteId_code_key" ON "ConsultationDiagnosis"("noteId", "code");

-- AddForeignKey
ALTER TABLE "ConsultationDiagnosis" ADD CONSTRAINT "ConsultationDiagnosis_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsultationDiagnosis" ADD CONSTRAINT "ConsultationDiagnosis_patientId_clinicId_fkey" FOREIGN KEY ("patientId", "clinicId") REFERENCES "Patient"("id", "clinicId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsultationDiagnosis" ADD CONSTRAINT "ConsultationDiagnosis_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "ConsultationNote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

