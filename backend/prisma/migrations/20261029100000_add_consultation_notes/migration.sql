-- Consultation notes (S10-04): the SOAP note of an appointment and its addenda.
--
-- Only creates two tables: nothing that exists is touched, and code from before this
-- migration never reads them, so an older release keeps working. The foreign keys are
-- RESTRICT on purpose: a patient or an appointment with a note cannot be deleted.

-- CreateTable
CREATE TABLE "ConsultationNote" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "clinicId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "subjective" TEXT NOT NULL DEFAULT '',
    "objective" TEXT NOT NULL DEFAULT '',
    "assessment" TEXT NOT NULL DEFAULT '',
    "plan" TEXT NOT NULL DEFAULT '',
    "template" TEXT,
    "authorId" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "closedByName" TEXT,

    CONSTRAINT "ConsultationNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsultationAddendum" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clinicId" TEXT NOT NULL,
    "noteId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,

    CONSTRAINT "ConsultationAddendum_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ConsultationNote_appointmentId_key" ON "ConsultationNote"("appointmentId");

-- CreateIndex
CREATE INDEX "ConsultationNote_patientId_createdAt_idx" ON "ConsultationNote"("patientId", "createdAt");

-- CreateIndex
CREATE INDEX "ConsultationNote_clinicId_status_idx" ON "ConsultationNote"("clinicId", "status");

-- CreateIndex
CREATE INDEX "ConsultationAddendum_noteId_createdAt_idx" ON "ConsultationAddendum"("noteId", "createdAt");

-- AddForeignKey
ALTER TABLE "ConsultationNote" ADD CONSTRAINT "ConsultationNote_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsultationNote" ADD CONSTRAINT "ConsultationNote_patientId_clinicId_fkey" FOREIGN KEY ("patientId", "clinicId") REFERENCES "Patient"("id", "clinicId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsultationNote" ADD CONSTRAINT "ConsultationNote_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsultationAddendum" ADD CONSTRAINT "ConsultationAddendum_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsultationAddendum" ADD CONSTRAINT "ConsultationAddendum_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "ConsultationNote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

