import { NextResponse } from "next/server"
import { gunParam, jsonGovde, kuruluDefter, muhasebeGirisi, muhasebeUcu } from "@/lib/muhasebe/istek.server"
import { fisListesi, fisSekmesiMi, type FisSekmesi } from "@/lib/muhasebe/fis-liste.server"
import { acilisFisiniElleAc, elleFisKaydet, elleSatirlariAyikla } from "@/lib/muhasebe/manuel.server"
import { FisHatasi } from "@/lib/muhasebe/onay.server"

export const dynamic = "force-dynamic"

const SAYFA = 50

/**
 * Muhasebe fişleri.
 *
 * GET  ?companyId&sekme=emin|gozden|degisti|onayli|tum&bas&bit&tip&q&sayfa
 *      → { fisler, toplam, sayilar } (sayılar her sekme için, aynı süzgeçle)
 * POST { companyId, tarih, aciklama, satirlar: [{side, amount, accountId, description}] }
 *      → elle (mahsup) fiş — taslak doğar
 *      { companyId, acilis: true, elleSatirlar: [...] }
 *      → açılış fişi (başlangıçta bakiye yoksa yoktur) elle satırlarıyla açılır; varsa 409
 */
export const GET = muhasebeUcu(async (request: Request) => {
  const sp = new URL(request.url).searchParams
  const { ctx } = await muhasebeGirisi(sp.get("companyId"))
  const defter = kuruluDefter(ctx)
  const hamSekme = sp.get("sekme")
  const sekme: FisSekmesi = fisSekmesiMi(hamSekme) ? hamSekme : "emin"
  const sayfa = Math.max(1, Number(sp.get("sayfa")) || 1)
  const sonuc = await fisListesi(
    defter.defterId,
    {
      sekme,
      bas: gunParam(sp.get("bas"), "Başlangıç"),
      bit: gunParam(sp.get("bit"), "Bitiş"),
      kaynakTipi: sp.get("tip") || null,
      arama: sp.get("q"),
    },
    { atla: (sayfa - 1) * SAYFA, al: SAYFA },
  )
  return NextResponse.json({ ...sonuc, sayfa, sayfaBoyu: SAYFA })
})

export const POST = muhasebeUcu(async (request: Request) => {
  const body = await jsonGovde(request)
  const { ctx, kullaniciId } = await muhasebeGirisi(body.companyId as string, { yazma: true })
  if (body.acilis === true) {
    const fis = await acilisFisiniElleAc(kuruluDefter(ctx), elleSatirlariAyikla(body.elleSatirlar))
    return NextResponse.json(fis, { status: 201 })
  }
  const tarih = gunParam(body.tarih, "Tarih")
  if (!tarih) throw new FisHatasi("Fiş tarihi seçin.")
  const fis = await elleFisKaydet(
    kuruluDefter(ctx),
    { tarih, aciklama: String(body.aciklama ?? ""), satirlar: elleSatirlariAyikla(body.satirlar) },
    kullaniciId,
  )
  return NextResponse.json(fis, { status: 201 })
})
