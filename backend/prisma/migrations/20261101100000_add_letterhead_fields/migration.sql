-- AlterTable
ALTER TABLE "Clinic" ADD COLUMN     "email" TEXT,
ADD COLUMN     "logoKey" TEXT,
ADD COLUMN     "phone" TEXT;

-- AlterTable
ALTER TABLE "Doctor" ADD COLUMN     "contactEmail" TEXT,
ADD COLUMN     "licenseNumber" TEXT,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "sealKey" TEXT,
ADD COLUMN     "signatureKey" TEXT,
ADD COLUMN     "title" TEXT;
