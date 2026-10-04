import { NextResponse } from "next/server"
import { jsonGovde, kuruluDefter, muhasebeGirisi, muhasebeUcu } from "@/lib/muhasebe/istek.server"
import { kapanisDurumu, kapanisGeriAl, kapanisYap } from "@/lib/muhasebe/kapanis.server"
import { FisHatasi } from "@/lib/muhasebe/onay.server"

export const dynamic = "force-dynamic"

/**
 * Dönem kapanışı (plan §4, kural lib/muhasebe/kapanis.ts).
 *
 * GET    ?companyId&yil&stok   → ön izleme: engeller, uyarılar, kapanış fişleri, net kâr
 * POST   { companyId, yil, kapanisStoku? } → kapanışı yapar, dönemi kilitler
 * DELETE ?companyId&yil        → en son kapanan yılın kapanışını geri alır
 */
function yilOku(v: unknown): number {
  const y = Number(v)
  if (!Number.isInteger(y) || y < 2000 || y > 2100) throw new FisHatasi("Geçerli bir yıl seçin.")
  return y
}
function stokOku(v: unknown): number | null {
  if (v == null || v === "") return null
  const n = Number(String(v).replace(",", "."))
  if (!Number.isFinite(n) || n < 0) throw new FisHatasi("Sayım tutarı geçerli bir sayı olmalı.")
  return Math.round(n * 100) / 100
}

export const GET = muhasebeUcu(async (request: Request) => {
  const sp = new URL(request.url).searchParams
  const { ctx } = await muhasebeGirisi(sp.get("companyId"))
  const d = await kapanisDurumu(kuruluDefter(ctx), yilOku(sp.get("yil")), stokOku(sp.get("stok")))
  const { plan: _plan, ...yanit } = d
  return NextResponse.json(yanit)
})

export const POST = muhasebeUcu(async (request: Request) => {
  const body = await jsonGovde(request)
  const { ctx, kullaniciId } = await muhasebeGirisi(body.companyId as string, { yazma: true })
  const r = await kapanisYap(kuruluDefter(ctx), yilOku(body.yil), stokOku(body.kapanisStoku), kullaniciId)
  return NextResponse.json({ ok: true, ...r })
})

export const DELETE = muhasebeUcu(async (request: Request) => {
  const sp = new URL(request.url).searchParams
  const { ctx, kullaniciId } = await muhasebeGirisi(sp.get("companyId"), { yazma: true })
  await kapanisGeriAl(kuruluDefter(ctx), yilOku(sp.get("yil")), kullaniciId)
  return NextResponse.json({ ok: true })
})
