-- Patient record (S10-02): birth date, sex, address, occupation, emergency contact, insurance
-- and legal representative.
--
-- Only adds nullable columns: every existing patient keeps its row as it is, and code from
-- before this migration never reads them, so an older release keeps working.

ALTER TABLE "Patient" ADD COLUMN "birthDate" TEXT,
ADD COLUMN "sex" TEXT,
ADD COLUMN "address" TEXT,
ADD COLUMN "occupation" TEXT,
ADD COLUMN "emergencyContactName" TEXT,
ADD COLUMN "emergencyContactPhone" TEXT,
ADD COLUMN "insuranceProvider" TEXT,
ADD COLUMN "insuranceNumber" TEXT,
ADD COLUMN "guardianName" TEXT,
ADD COLUMN "guardianCedula" TEXT,
ADD COLUMN "guardianPhone" TEXT,
ADD COLUMN "guardianRelationship" TEXT;
