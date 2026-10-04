import { NextResponse } from "next/server"
import { gunParam, kuruluDefter, muhasebeGirisi, muhasebeUcu } from "@/lib/muhasebe/istek.server"
import { mizan } from "@/lib/muhasebe/defter-sorgu.server"
import { bilancoKur, gelirTablosuKur } from "@/lib/muhasebe/mali-tablolar"
import { FisHatasi } from "@/lib/muhasebe/onay.server"

export const dynamic = "force-dynamic"

/**
 * Mizandan bilanço ve gelir tablosu — GET ?companyId&bas&bit (yalnız onaylı fişler).
 *
 * Bilanço `bit` gününün sonundaki durumdur (yıl sonu kapanış/açılış fişleri hariç,
 * yoksa 31 Aralık bilançosu sıfır basardı). Gelir tablosu `bas`–`bit` dönemidir (6 → 690
 * kapanış fişi hariç).
 */
export const GET = muhasebeUcu(async (request: Request) => {
  const sp = new URL(request.url).searchParams
  const { ctx } = await muhasebeGirisi(sp.get("companyId"))
  const defter = kuruluDefter(ctx)
  const bas = gunParam(sp.get("bas"), "Başlangıç")
  const bit = gunParam(sp.get("bit"), "Bitiş")
  if (!bas || !bit) throw new FisHatasi("Dönem seçin.")
  const [bilancoMizani, donemMizani] = await Promise.all([
    // Yıl sonu kapanış ve ertesi yıl açılış fişi birbirini tam götürür: ikisi birlikte
    // dışlanır. Yalnız kapanış dışlansaydı ertesi yıla uzanan dönemde açılış bakiyeleri
    // iki kez sayılırdı.
    mizan(defter.defterId, { bas: null, bit, haricKapanis: ["bilanco-kapanis", "acilis"] }),
    mizan(defter.defterId, { bas, bit, haricKapanis: ["gelir-kapanis"] }),
  ])
  return NextResponse.json({
    bilanco: bilancoKur(bilancoMizani),
    gelirTablosu: gelirTablosuKur(donemMizani),
  })
})
