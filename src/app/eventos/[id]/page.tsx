import { EventDetailPage } from "@/components/events/event-detail";

export default async function EventDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EventDetailPage id={id} />;
}
