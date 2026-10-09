import { NextResponse } from "next/server"
import { jsonGovde, kuruluDefter, muhasebeGirisi, muhasebeUcu } from "@/lib/muhasebe/istek.server"
import { kdvAylari, kdvMahsupGeriAl, kdvMahsupOnizleme, kdvMahsupYap } from "@/lib/muhasebe/kdv-mahsup.server"
import { FisHatasi } from "@/lib/muhasebe/onay.server"

export const dynamic = "force-dynamic"

/**
 * Aylık KDV mahsubu (kural: lib/muhasebe/kdv-mahsup.ts).
 *
 * GET  ?companyId[&ay=YYYY-AA][&odenecek=kod][&devreden=kod]
 *      → aylar + seçilen (yoksa sıradaki bekleyen) ayın ön izlemesi
 * POST { companyId, ay, islem: "yap", odenecek?, devreden? } → mahsup fişi (onaylı)
 *      { companyId, ay, islem: "geri-al" }                    → en son mahsubu sil
 */
export const GET = muhasebeUcu(async (request: Request) => {
  const sp = new URL(request.url).searchParams
  const { ctx } = await muhasebeGirisi(sp.get("companyId"))
  const defter = kuruluDefter(ctx)
  const aylar = await kdvAylari(defter)
  const ay = sp.get("ay") || aylar.find((a) => a.durum === "bekliyor")?.ay || null
  const onizleme =
    ay && aylar.some((a) => a.ay === ay && a.durum !== "yapildi")
      ? await kdvMahsupOnizleme(defter, ay, { odenecek: sp.get("odenecek"), devreden: sp.get("devreden") })
      : null
  return NextResponse.json({ aylar, ay, onizleme })
})

export const POST = muhasebeUcu(async (request: Request) => {
  const body = await jsonGovde(request)
  const { ctx, kullaniciId } = await muhasebeGirisi(body.companyId as string, { yazma: true })
  const defter = kuruluDefter(ctx)
  const ay = String(body.ay ?? "")
  if (!/^\d{4}-\d{2}$/.test(ay)) throw new FisHatasi("Ay seçin.")
  if (body.islem === "geri-al") {
    await kdvMahsupGeriAl(defter, ay)
    return NextResponse.json({ ok: true })
  }
  if (body.islem !== "yap") throw new FisHatasi("Geçersiz işlem.")
  const sonuc = await kdvMahsupYap(
    defter,
    ay,
    {
      odenecek: typeof body.odenecek === "string" ? body.odenecek : null,
      devreden: typeof body.devreden === "string" ? body.devreden : null,
    },
    kullaniciId,
  )
  return NextResponse.json({ ok: true, ...sonuc })
})
