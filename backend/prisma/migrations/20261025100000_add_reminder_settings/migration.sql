-- Configurable reminders (S9-03): per-clinic settings and a date for the second reminder.
--
-- Only adds columns, every one nullable or with a default equal to what the app did before:
-- reminders on, one WhatsApp and one email, 24 hours before. Existing clinics and appointments
-- keep behaving exactly as they did, and an older release that does not know the columns keeps
-- working (it simply ignores them).

-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "secondReminderSentAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Clinic" ADD COLUMN     "address" TEXT,
ADD COLUMN     "reminderEmail" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "reminderEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "reminderHours" INTEGER NOT NULL DEFAULT 24,
ADD COLUMN     "reminderIndications" TEXT,
ADD COLUMN     "reminderWhatsapp" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "secondReminderHours" INTEGER;

