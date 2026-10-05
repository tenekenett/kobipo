import { NextResponse } from "next/server"
import { jsonGovde, kuruluDefter, muhasebeGirisi, muhasebeUcu } from "@/lib/muhasebe/istek.server"
import { eslemeListesi, eslemeUygula } from "@/lib/muhasebe/esleme.server"
import { FisHatasi } from "@/lib/muhasebe/onay.server"

export const dynamic = "force-dynamic"

/**
 * Toplu hesap eşleme — "Gözden geçir"deki taslak satırları "bu tedarikçi / bu satır türü"
 * gruplarında tek seferde eşler (kural: lib/muhasebe/esleme.ts).
 *
 * GET  ?companyId=  → { gruplar, fisSayisi, satirSayisi }
 * POST { companyId, atamalar: [{ anahtar, accountId }] }
 *      → { satir, fis, eminFisler } — satırlar elle seçilmiş (USER) olur; öğrenme ONAYDA
 */
export const GET = muhasebeUcu(async (request: Request) => {
  const { ctx } = await muhasebeGirisi(new URL(request.url).searchParams.get("companyId"))
  return NextResponse.json(await eslemeListesi(kuruluDefter(ctx)))
})

export const POST = muhasebeUcu(async (request: Request) => {
  const body = await jsonGovde(request)
  const { ctx } = await muhasebeGirisi(body.companyId as string, { yazma: true })
  if (!Array.isArray(body.atamalar)) throw new FisHatasi("Atama listesi yok.")
  const atamalar = (body.atamalar as Array<Record<string, unknown>>).slice(0, 500).map((a) => ({
    anahtar: typeof a?.anahtar === "string" ? a.anahtar : "",
    accountId: typeof a?.accountId === "string" ? a.accountId : "",
  }))
  return NextResponse.json(await eslemeUygula(kuruluDefter(ctx), atamalar))
})
