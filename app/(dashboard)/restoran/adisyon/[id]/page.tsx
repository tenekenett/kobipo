import { TicketScreen } from "@/components/restoran/ticket-screen"

export default async function RestoranAdisyonPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <TicketScreen ticketId={id} />
}
