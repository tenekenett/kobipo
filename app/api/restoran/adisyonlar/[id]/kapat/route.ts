import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { withApiErrors } from "@/lib/api/errors"
import { closeTicket, prepareTicketClose } from "@/lib/restoran/close-ticket"
import { sessionReadAuthorize, sessionWriteActor } from "@/lib/api/session-actor"

export const dynamic = "force-dynamic"

type Params = { params: Promise<{ id: string }> }

/**
 * Adisyon kapanışı — İKİ ADIMLI. Mantık ve gerekçeler lib/restoran/close-ticket.ts'te
 * (oturumsuz çağrılabilsin diye — ÖKC webhook'u, docs/okc/ASAMA1-KOBIPO.md A5).
 *
 *   GET  .../kapat  → fiş gövdesini hazır döndürür
 *   POST .../kapat  → { invoiceId } ile adisyonu fişe bağlar ve KAPATIR
 */
export const GET = withApiErrors(async function GET(request: Request, { params }: Params) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { searchParams } = new URL(request.url)
  const { id } = await params
  return prepareTicketClose(searchParams.get("companyId"), id, sessionReadAuthorize)
})

export const POST = withApiErrors(async function POST(request: Request, { params }: Params) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await params
  return closeTicket(() => request.json(), id, sessionWriteActor(user.id))
})
