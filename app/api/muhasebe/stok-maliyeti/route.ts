import { NextResponse } from "next/server"
import { jsonGovde, kuruluDefter, muhasebeGirisi, muhasebeUcu } from "@/lib/muhasebe/istek.server"
import { smmAylari, smmGeriAl, smmOnizleme, smmYap } from "@/lib/muhasebe/stok-maliyeti.server"
import { FisHatasi } from "@/lib/muhasebe/onay.server"

export const dynamic = "force-dynamic"

/**
 * Aylık satılan malın maliyeti (kural: lib/muhasebe/stok-maliyeti.ts).
 *
 * GET  ?companyId[&ay=YYYY-AA][&maliyet=kod][&stok=kod][&fazla=kod] → aylar + seçilen (yoksa sıradaki) ayın ön izlemesi
 * POST { companyId, ay, islem: "yap", maliyet?, stok?, fazla? }      → maliyet fişi (onaylı)
 *      { companyId, ay, islem: "geri-al" }                → en son ayın fişini sil
 */
export const GET = muhasebeUcu(async (request: Request) => {
  const sp = new URL(request.url).searchParams
  const { ctx } = await muhasebeGirisi(sp.get("companyId"))
  const defter = kuruluDefter(ctx)
  const { stokTakibi, aylar } = await smmAylari(defter)
  const ay = sp.get("ay") || aylar.find((a) => a.durum === "bekliyor")?.ay || null
  const onizleme =
    ay && stokTakibi && aylar.some((a) => a.ay === ay && a.durum !== "yapildi")
      ? await smmOnizleme(defter, ay, { maliyet: sp.get("maliyet"), stok: sp.get("stok"), fazla: sp.get("fazla") })
      : null
  return NextResponse.json({ stokTakibi, aylar, ay, onizleme })
})

export const POST = muhasebeUcu(async (request: Request) => {
  const body = await jsonGovde(request)
  const { ctx, kullaniciId } = await muhasebeGirisi(body.companyId as string, { yazma: true })
  const defter = kuruluDefter(ctx)
  const ay = String(body.ay ?? "")
  if (!/^\d{4}-\d{2}$/.test(ay)) throw new FisHatasi("Ay seçin.")
  if (body.islem === "geri-al") {
    await smmGeriAl(defter, ay)
    return NextResponse.json({ ok: true })
  }
  if (body.islem !== "yap") throw new FisHatasi("Geçersiz işlem.")
  const sonuc = await smmYap(
    defter,
    ay,
    {
      maliyet: typeof body.maliyet === "string" ? body.maliyet : null,
      stok: typeof body.stok === "string" ? body.stok : null,
      fazla: typeof body.fazla === "string" ? body.fazla : null,
    },
    kullaniciId,
  )
  return NextResponse.json({ ok: true, ...sonuc })
})
