import { NextResponse } from "next/server"
import { gunParam, kuruluDefter, muhasebeGirisi, muhasebeUcu } from "@/lib/muhasebe/istek.server"
import { mizan } from "@/lib/muhasebe/defter-sorgu.server"
import { mizanToplami } from "@/lib/muhasebe/mizan"

export const dynamic = "force-dynamic"

/**
 * Mizan — GET ?companyId&bas&bit&taslak=1
 *
 * Bütün düzeyler döner (sınıf → alt hesap); ekran düzeyi seçer. Dip toplam her
 * düzey için ayrı verilir: borç = alacak tutmuyorsa ekran bunu yazar.
 */
export const GET = muhasebeUcu(async (request: Request) => {
  const sp = new URL(request.url).searchParams
  const { ctx } = await muhasebeGirisi(sp.get("companyId"))
  const defter = kuruluDefter(ctx)
  const satirlar = await mizan(defter.defterId, {
    bas: gunParam(sp.get("bas"), "Başlangıç"),
    bit: gunParam(sp.get("bit"), "Bitiş"),
    taslakDahil: sp.get("taslak") === "1",
  })
  return NextResponse.json({
    satirlar,
    toplamlar: { 1: mizanToplami(satirlar, 1), 3: mizanToplami(satirlar, 3) },
  })
})
