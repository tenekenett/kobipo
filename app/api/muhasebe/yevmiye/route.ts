import { NextResponse } from "next/server"
import { gunParam, kuruluDefter, muhasebeGirisi, muhasebeUcu } from "@/lib/muhasebe/istek.server"
import { yevmiye } from "@/lib/muhasebe/defter-sorgu.server"

export const dynamic = "force-dynamic"

const SAYFA = 40

/** Yevmiye defteri — GET ?companyId&bas&bit&sayfa (yalnız onaylı fişler). */
export const GET = muhasebeUcu(async (request: Request) => {
  const sp = new URL(request.url).searchParams
  const { ctx } = await muhasebeGirisi(sp.get("companyId"))
  const defter = kuruluDefter(ctx)
  const sayfa = Math.max(1, Number(sp.get("sayfa")) || 1)
  const sonuc = await yevmiye(
    defter.defterId,
    { bas: gunParam(sp.get("bas"), "Başlangıç"), bit: gunParam(sp.get("bit"), "Bitiş") },
    { atla: (sayfa - 1) * SAYFA, al: SAYFA },
  )
  return NextResponse.json({ ...sonuc, sayfa, sayfaBoyu: SAYFA })
})
