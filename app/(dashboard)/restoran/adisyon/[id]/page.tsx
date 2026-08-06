import { TicketPage } from "@/components/restoran/ticket-page"

export default async function RestoranAdisyonPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  // Açık adisyon POS ekranını, kapanmış/iptal olan detay ekranını açar —
  // kararı istemcide TicketPage veriyor (docs/restoran/ADISYON-DETAY.md K1).
  return <TicketPage ticketId={id} />
}
