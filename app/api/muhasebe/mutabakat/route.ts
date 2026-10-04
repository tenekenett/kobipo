import { NextResponse } from "next/server"
import { jsonGovde, kuruluDefter, muhasebeGirisi, muhasebeUcu } from "@/lib/muhasebe/istek.server"
import { mutabakatAdimi } from "@/lib/muhasebe/kurulum.server"
import { senkronla } from "@/lib/muhasebe/senkron.server"

export const dynamic = "force-dynamic"

/**
 * Mutabakat — belgeler ile fişleri karşılaştırır (plan §2.3, ikinci tetik).
 *
 * GET  ?companyId=  → yalnız SAYAR: açılacak / yenilenecek / silinecek / işaretlenecek
 *                     fiş, kuru eksik ve kilitli döneme düşen kayıt
 * POST { companyId, acilis?, limit? } → bir adım uygular; istemci `kalan` 0 olana
 *                     kadar çağırır (ilk adımda açılış fişi de tazelenir)
 */
export const GET = muhasebeUcu(async (request: Request) => {
  const { ctx } = await muhasebeGirisi(new URL(request.url).searchParams.get("companyId"))
  const ozet = await senkronla(kuruluDefter(ctx), { kuru: true })
  return NextResponse.json(ozet)
})

export const POST = muhasebeUcu(async (request: Request) => {
  const body = await jsonGovde(request)
  const { ctx } = await muhasebeGirisi(body.companyId as string, { yazma: true })
  const limit = Math.min(Math.max(Number(body.limit) || 150, 1), 500)
  const ozet = await mutabakatAdimi(kuruluDefter(ctx), { acilis: body.acilis === true, limit })
  return NextResponse.json(ozet)
})
