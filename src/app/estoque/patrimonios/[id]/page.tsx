import { AssetHistory } from "@/components/movements/asset-history";

export default async function AssetHistoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AssetHistory id={id} />;
}
