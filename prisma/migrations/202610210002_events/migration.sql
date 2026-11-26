-- CreateEnum
CREATE TYPE "CalendarEventStatus" AS ENUM ('PLANNED', 'CONFIRMED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CalendarEventKind" AS ENUM ('INTERNAL', 'EXTERNAL');

-- CreateTable
CREATE TABLE "CalendarEvent" (
    "id" UUID NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "description" VARCHAR(4000) NOT NULL,
    "department" VARCHAR(40) NOT NULL,
    "responsibleName" VARCHAR(120) NOT NULL,
    "contact" VARCHAR(160) NOT NULL,
    "location" VARCHAR(160) NOT NULL,
    "locationKey" TEXT NOT NULL,
    "searchText" TEXT NOT NULL,
    "kind" "CalendarEventKind" NOT NULL,
    "status" "CalendarEventStatus" NOT NULL DEFAULT 'PLANNED',
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "archivedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdByUserId" UUID,

    CONSTRAINT "CalendarEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventEquipmentNeed" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "equipmentId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "notes" VARCHAR(1000) NOT NULL DEFAULT '',

    CONSTRAINT "EventEquipmentNeed_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventHistory" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "action" VARCHAR(40) NOT NULL,
    "description" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "actorUserId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CalendarEvent_archivedAt_startsAt_id_idx" ON "CalendarEvent"("archivedAt", "startsAt", "id");

-- CreateIndex
CREATE INDEX "CalendarEvent_locationKey_startsAt_endsAt_idx" ON "CalendarEvent"("locationKey", "startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "CalendarEvent_department_status_idx" ON "CalendarEvent"("department", "status");

-- CreateIndex
CREATE INDEX "EventEquipmentNeed_equipmentId_idx" ON "EventEquipmentNeed"("equipmentId");

-- CreateIndex
CREATE UNIQUE INDEX "EventEquipmentNeed_eventId_equipmentId_key" ON "EventEquipmentNeed"("eventId", "equipmentId");

-- CreateIndex
CREATE INDEX "EventHistory_eventId_createdAt_id_idx" ON "EventHistory"("eventId", "createdAt", "id");

-- AddForeignKey
ALTER TABLE "EventEquipmentNeed" ADD CONSTRAINT "EventEquipmentNeed_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "CalendarEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventEquipmentNeed" ADD CONSTRAINT "EventEquipmentNeed_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventHistory" ADD CONSTRAINT "EventHistory_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "CalendarEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Invariantes locais, sem qualquer alteração às tabelas/saldos de estoque.
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "calendar_event_interval" CHECK ("endsAt" > "startsAt" AND "version" >= 1);
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "calendar_event_department" CHECK ("department" IN ('Multimeios', 'Marketing', 'Projeto de Extensão'));
ALTER TABLE "EventEquipmentNeed" ADD CONSTRAINT "event_need_positive" CHECK ("quantity" > 0);
