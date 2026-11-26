"use client";

import { useRouter } from "next/navigation";
import { EquipmentDetailView } from "./equipment-detail";

export function EquipmentDetailPage({ id }: { id: string }) {
  const router = useRouter();
  return <EquipmentDetailView id={id} onDeleted={() => router.push("/estoque")} />;
}
