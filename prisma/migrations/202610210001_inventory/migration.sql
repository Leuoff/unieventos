-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "TrackingMode" AS ENUM ('QUANTITY', 'INDIVIDUAL');

-- CreateEnum
CREATE TYPE "PhysicalState" AS ENUM ('AVAILABLE', 'MAINTENANCE');

-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('ACTIVE', 'CANCELLED', 'COMPLETED');

-- CreateTable
CREATE TABLE "Equipment" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "category" VARCHAR(80) NOT NULL,
    "description" VARCHAR(2000) NOT NULL DEFAULT '',
    "location" VARCHAR(160) NOT NULL,
    "searchText" TEXT NOT NULL DEFAULT '',
    "trackingMode" "TrackingMode" NOT NULL,
    "total" INTEGER NOT NULL,
    "maintenance" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "archivedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Equipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EquipmentUnit" (
    "id" UUID NOT NULL,
    "equipmentId" UUID NOT NULL,
    "assetNumber" VARCHAR(80) NOT NULL,
    "state" "PhysicalState" NOT NULL DEFAULT 'AVAILABLE',

    CONSTRAINT "EquipmentUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockHistory" (
    "id" UUID NOT NULL,
    "equipmentId" UUID NOT NULL,
    "action" VARCHAR(40) NOT NULL,
    "description" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reservation" (
    "id" UUID NOT NULL,
    "equipmentId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "status" "ReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "reference" VARCHAR(160),

    CONSTRAINT "Reservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReservationUnit" (
    "reservationId" UUID NOT NULL,
    "unitId" UUID NOT NULL,

    CONSTRAINT "ReservationUnit_pkey" PRIMARY KEY ("reservationId","unitId")
);

-- CreateTable
CREATE TABLE "Withdrawal" (
    "id" UUID NOT NULL,
    "equipmentId" UUID NOT NULL,
    "reservationId" UUID,
    "quantity" INTEGER NOT NULL,
    "returnedQuantity" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Withdrawal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WithdrawalUnit" (
    "withdrawalId" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "returnedAt" TIMESTAMPTZ(3),

    CONSTRAINT "WithdrawalUnit_pkey" PRIMARY KEY ("withdrawalId","unitId")
);

-- CreateIndex
CREATE INDEX "Equipment_archivedAt_name_id_idx" ON "Equipment"("archivedAt", "name", "id");

-- CreateIndex
CREATE INDEX "Equipment_category_idx" ON "Equipment"("category");

-- CreateIndex
CREATE UNIQUE INDEX "EquipmentUnit_assetNumber_key" ON "EquipmentUnit"("assetNumber");

-- CreateIndex
CREATE INDEX "EquipmentUnit_equipmentId_idx" ON "EquipmentUnit"("equipmentId");

-- CreateIndex
CREATE INDEX "StockHistory_equipmentId_createdAt_id_idx" ON "StockHistory"("equipmentId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "Reservation_equipmentId_status_startsAt_endsAt_idx" ON "Reservation"("equipmentId", "status", "startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "Withdrawal_equipmentId_idx" ON "Withdrawal"("equipmentId");

-- CreateIndex
CREATE INDEX "Withdrawal_reservationId_idx" ON "Withdrawal"("reservationId");

-- AddForeignKey
ALTER TABLE "EquipmentUnit" ADD CONSTRAINT "EquipmentUnit_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockHistory" ADD CONSTRAINT "StockHistory_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservationUnit" ADD CONSTRAINT "ReservationUnit_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservationUnit" ADD CONSTRAINT "ReservationUnit_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "EquipmentUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Withdrawal" ADD CONSTRAINT "Withdrawal_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Withdrawal" ADD CONSTRAINT "Withdrawal_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WithdrawalUnit" ADD CONSTRAINT "WithdrawalUnit_withdrawalId_fkey" FOREIGN KEY ("withdrawalId") REFERENCES "Withdrawal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WithdrawalUnit" ADD CONSTRAINT "WithdrawalUnit_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "EquipmentUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Local invariants are enforced by PostgreSQL as well as server validation.
ALTER TABLE "Equipment" ADD CONSTRAINT "equipment_nonnegative" CHECK ("total" >= 0 AND "maintenance" >= 0 AND "maintenance" <= "total" AND "version" >= 1);
ALTER TABLE "EquipmentUnit" ADD CONSTRAINT "asset_number_not_blank" CHECK (length(btrim("assetNumber")) > 0);
ALTER TABLE "Reservation" ADD CONSTRAINT "reservation_valid" CHECK ("quantity" > 0 AND "startsAt" < "endsAt");
ALTER TABLE "Withdrawal" ADD CONSTRAINT "withdrawal_valid" CHECK ("quantity" > 0 AND "returnedQuantity" >= 0 AND "returnedQuantity" <= "quantity");