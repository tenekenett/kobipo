import { NextResponse } from "next/server"
import { prisma } from "@/lib/db/prisma"
import { gunParam, kuruluDefter, muhasebeGirisi, muhasebeUcu } from "@/lib/muhasebe/istek.server"
import { mizan, mizanHesapsiz } from "@/lib/muhasebe/defter-sorgu.server"
import { bilancoKur, gelirTablosuKur, tabloNotlari } from "@/lib/muhasebe/mali-tablolar"
import { FisHatasi } from "@/lib/muhasebe/onay.server"

export const dynamic = "force-dynamic"

/**
 * Mizandan bilanço ve gelir tablosu — GET ?companyId&bas&bit&taslak=1
 *
 * Resmî tablolar yalnız onaylı fişlerdendir; `taslak=1` ön izlemedir (mizandaki anahtarla
 * aynı). Bilanço `bit` gününün sonundaki durumdur (yıl sonu kapanış/açılış fişleri hariç,
 * yoksa 31 Aralık bilançosu sıfır basardı). Gelir tablosu `bas`–`bit` dönemidir (6 → 690
 * kapanış fişi hariç).
 *
 * Ekranın açıklamaları için `notlar`: kaç fiş onay bekliyor, ön izlemede hesaba
 * bağlanmamış tutar (tablonun neden denk görünmediği), satılan malın maliyeti henüz
 * hesaplanmadı mı. Kural `tabloNotlari`nda (saf).
 */
export const GET = muhasebeUcu(async (request: Request) => {
  const sp = new URL(request.url).searchParams
  const { ctx } = await muhasebeGirisi(sp.get("companyId"))
  const defter = kuruluDefter(ctx)
  const bas = gunParam(sp.get("bas"), "Başlangıç")
  const bit = gunParam(sp.get("bit"), "Bitiş")
  if (!bas || !bit) throw new FisHatasi("Dönem seçin.")
  const taslakDahil = sp.get("taslak") === "1"
  const [bilancoMizani, donemMizani, hesapsiz, durumlar] = await Promise.all([
    // Yıl sonu kapanış ve ertesi yıl açılış fişi birbirini tam götürür: ikisi birlikte
    // dışlanır. Yalnız kapanış dışlansaydı ertesi yıla uzanan dönemde açılış bakiyeleri
    // iki kez sayılırdı.
    mizan(defter.defterId, { bas: null, bit, taslakDahil, haricKapanis: ["bilanco-kapanis", "acilis"] }),
    mizan(defter.defterId, { bas, bit, taslakDahil, haricKapanis: ["gelir-kapanis"] }),
    taslakDahil ? mizanHesapsiz(defter.defterId, { bas: null, bit, taslakDahil, haricKapanis: ["bilanco-kapanis", "acilis"] }) : null,
    prisma.journalVoucher.groupBy({
      by: ["status"],
      where: { companyId: defter.defterId, date: { lte: bit } },
      _count: { _all: true },
    }),
  ])
  const say = (s: string) => durumlar.find((d) => d.status === s)?._count._all ?? 0
  const bilanco = bilancoKur(bilancoMizani)
  const gelirTablosu = gelirTablosuKur(donemMizani)
  return NextResponse.json({
    bilanco,
    gelirTablosu,
    taslakDahil,
    notlar: tabloNotlari({
      bilanco,
      donemMizani,
      bilancoMizani,
      hesapsiz,
      onayliFis: say("POSTED"),
      taslakFis: say("DRAFT"),
    }),
  })
})
