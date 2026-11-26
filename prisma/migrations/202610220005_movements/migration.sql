-- CreateEnum
CREATE TYPE "MovementCondition" AS ENUM ('GOOD', 'DAMAGED', 'LOST');

-- AlterEnum
ALTER TYPE "PhysicalState" ADD VALUE 'LOST';

-- AlterTable
ALTER TABLE "Equipment" ADD COLUMN     "lost" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Withdrawal" ADD COLUMN     "actorUserId" UUID,
ADD COLUMN     "checklist" JSONB,
ADD COLUMN     "destination" VARCHAR(160) NOT NULL DEFAULT '',
ADD COLUMN     "expectedReturnAt" TIMESTAMPTZ(3),
ADD COLUMN     "lostQuantity" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "notes" VARCHAR(2000) NOT NULL DEFAULT '',
ADD COLUMN     "responsibleName" VARCHAR(120) NOT NULL DEFAULT '',
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "WithdrawalUnit" ADD COLUMN     "lostAt" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "WithdrawalSettlement" (
    "id" UUID NOT NULL,
    "withdrawalId" UUID NOT NULL,
    "goodQuantity" INTEGER NOT NULL DEFAULT 0,
    "damagedQuantity" INTEGER NOT NULL DEFAULT 0,
    "lostQuantity" INTEGER NOT NULL DEFAULT 0,
    "actorUserId" UUID NOT NULL,
    "notes" VARCHAR(2000) NOT NULL DEFAULT '',
    "checklist" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WithdrawalSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WithdrawalSettlementUnit" (
    "settlementId" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "condition" "MovementCondition" NOT NULL,

    CONSTRAINT "WithdrawalSettlementUnit_pkey" PRIMARY KEY ("settlementId","unitId")
);

-- CreateTable
CREATE TABLE "MovementHistory" (
    "id" UUID NOT NULL,
    "withdrawalId" UUID NOT NULL,
    "action" VARCHAR(40) NOT NULL,
    "description" TEXT NOT NULL,
    "actorUserId" UUID,
    "before" JSONB,
    "after" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MovementHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WithdrawalSettlement_withdrawalId_createdAt_id_idx" ON "WithdrawalSettlement"("withdrawalId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "WithdrawalSettlementUnit_unitId_idx" ON "WithdrawalSettlementUnit"("unitId");

-- CreateIndex
CREATE INDEX "MovementHistory_withdrawalId_createdAt_id_idx" ON "MovementHistory"("withdrawalId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "Withdrawal_expectedReturnAt_createdAt_id_idx" ON "Withdrawal"("expectedReturnAt", "createdAt", "id");

-- AddForeignKey
ALTER TABLE "WithdrawalSettlement" ADD CONSTRAINT "WithdrawalSettlement_withdrawalId_fkey" FOREIGN KEY ("withdrawalId") REFERENCES "Withdrawal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WithdrawalSettlementUnit" ADD CONSTRAINT "WithdrawalSettlementUnit_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "WithdrawalSettlement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WithdrawalSettlementUnit" ADD CONSTRAINT "WithdrawalSettlementUnit_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "EquipmentUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovementHistory" ADD CONSTRAINT "MovementHistory_withdrawalId_fkey" FOREIGN KEY ("withdrawalId") REFERENCES "Withdrawal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- Physical losses remain in the registered total but never in availability.
ALTER TABLE "Equipment" ADD CONSTRAINT "equipment_lost_valid" CHECK ("lost" >= 0 AND "maintenance" + "lost" <= "total");
ALTER TABLE "Withdrawal" ADD CONSTRAINT "withdrawal_settled_valid" CHECK ("lostQuantity" >= 0 AND "returnedQuantity" + "lostQuantity" <= "quantity" AND "version" >= 1 AND ("expectedReturnAt" IS NULL OR "expectedReturnAt" > "createdAt"));
ALTER TABLE "WithdrawalUnit" ADD CONSTRAINT "withdrawal_unit_resolution_valid" CHECK ("returnedAt" IS NULL OR "lostAt" IS NULL);
ALTER TABLE "WithdrawalSettlement" ADD CONSTRAINT "withdrawal_settlement_positive" CHECK ("goodQuantity" >= 0 AND "damagedQuantity" >= 0 AND "lostQuantity" >= 0 AND "goodQuantity" + "damagedQuantity" + "lostQuantity" > 0);
