import { RequestDetailPage } from "@/components/requests/request-detail";

export default async function RequestDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RequestDetailPage id={id} />;
}
