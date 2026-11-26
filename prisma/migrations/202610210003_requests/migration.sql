-- CreateEnum
CREATE TYPE "EquipmentRequestStatus" AS ENUM ('DRAFT', 'PENDING', 'APPROVED', 'REFUSED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Reservation" ADD COLUMN     "requestItemId" UUID;

-- CreateTable
CREATE TABLE "EquipmentRequest" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "responsibleName" VARCHAR(120) NOT NULL,
    "notes" VARCHAR(2000) NOT NULL DEFAULT '',
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "status" "EquipmentRequestStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "searchText" TEXT NOT NULL DEFAULT '',
    "importedEventKey" UUID,
    "createdByUserId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "EquipmentRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EquipmentRequestItem" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "equipmentId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "notes" VARCHAR(1000) NOT NULL DEFAULT '',
    "sourceNeedId" UUID,

    CONSTRAINT "EquipmentRequestItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequestHistory" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "action" VARCHAR(40) NOT NULL,
    "description" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "actorUserId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RequestHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EquipmentRequest_importedEventKey_key" ON "EquipmentRequest"("importedEventKey");

-- CreateIndex
CREATE INDEX "EquipmentRequest_status_createdAt_id_idx" ON "EquipmentRequest"("status", "createdAt", "id");

-- CreateIndex
CREATE INDEX "EquipmentRequest_eventId_idx" ON "EquipmentRequest"("eventId");

-- CreateIndex
CREATE INDEX "EquipmentRequest_startsAt_endsAt_idx" ON "EquipmentRequest"("startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "EquipmentRequestItem_equipmentId_idx" ON "EquipmentRequestItem"("equipmentId");

-- CreateIndex
CREATE INDEX "EquipmentRequestItem_sourceNeedId_idx" ON "EquipmentRequestItem"("sourceNeedId");

-- CreateIndex
CREATE UNIQUE INDEX "EquipmentRequestItem_requestId_equipmentId_key" ON "EquipmentRequestItem"("requestId", "equipmentId");

-- CreateIndex
CREATE INDEX "RequestHistory_requestId_createdAt_id_idx" ON "RequestHistory"("requestId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Reservation_requestItemId_key" ON "Reservation"("requestItemId");

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_requestItemId_fkey" FOREIGN KEY ("requestItemId") REFERENCES "EquipmentRequestItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentRequest" ADD CONSTRAINT "EquipmentRequest_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "CalendarEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentRequestItem" ADD CONSTRAINT "EquipmentRequestItem_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "EquipmentRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentRequestItem" ADD CONSTRAINT "EquipmentRequestItem_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentRequestItem" ADD CONSTRAINT "EquipmentRequestItem_sourceNeedId_fkey" FOREIGN KEY ("sourceNeedId") REFERENCES "EventEquipmentNeed"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestHistory" ADD CONSTRAINT "RequestHistory_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "EquipmentRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Invariantes também protegidas no banco. Nenhuma tabela anterior é recriada.
ALTER TABLE "EquipmentRequest" ADD CONSTRAINT "EquipmentRequest_valid_interval" CHECK ("endsAt" > "startsAt");
ALTER TABLE "EquipmentRequest" ADD CONSTRAINT "EquipmentRequest_positive_version" CHECK ("version" >= 1);
ALTER TABLE "EquipmentRequest" ADD CONSTRAINT "EquipmentRequest_responsible_not_blank" CHECK (length(trim("responsibleName")) >= 2);
ALTER TABLE "EquipmentRequest" ADD CONSTRAINT "EquipmentRequest_import_matches_event" CHECK ("importedEventKey" IS NULL OR "importedEventKey" = "eventId");
ALTER TABLE "EquipmentRequestItem" ADD CONSTRAINT "EquipmentRequestItem_positive_quantity" CHECK ("quantity" > 0);
