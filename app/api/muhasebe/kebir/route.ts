import { NextResponse } from "next/server"
import { gunParam, kuruluDefter, muhasebeGirisi, muhasebeUcu } from "@/lib/muhasebe/istek.server"
import { kebir } from "@/lib/muhasebe/defter-sorgu.server"
import { FisHatasi } from "@/lib/muhasebe/onay.server"

export const dynamic = "force-dynamic"

/**
 * Kebir (hesap dökümü) — GET ?companyId&hesap=<kod>&bas&bit
 * Hesabın kendisi ve alt hesapları, devir + yürüyen bakiye (yalnız onaylı fişler).
 */
export const GET = muhasebeUcu(async (request: Request) => {
  const sp = new URL(request.url).searchParams
  const { ctx } = await muhasebeGirisi(sp.get("companyId"))
  const defter = kuruluDefter(ctx)
  const hesap = (sp.get("hesap") ?? "").trim()
  if (!hesap) throw new FisHatasi("Hesap kodu seçin.")
  const sonuc = await kebir(defter.defterId, hesap, {
    bas: gunParam(sp.get("bas"), "Başlangıç"),
    bit: gunParam(sp.get("bit"), "Bitiş"),
  })
  if (!sonuc.hesap) throw new FisHatasi(`${hesap} kodlu hesap yok.`, 404)
  return NextResponse.json(sonuc)
})
