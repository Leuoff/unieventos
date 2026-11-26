import { MovementDetailView } from "@/components/movements/movement-detail";

export default async function MovementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <MovementDetailView id={id} />;
}
