import { EquipmentDetailPage } from "@/components/inventory/equipment-detail-page";

export default async function InventoryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EquipmentDetailPage id={id} />;
}
