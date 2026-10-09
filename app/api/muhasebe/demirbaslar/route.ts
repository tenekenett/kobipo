import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"
import { gunParam, jsonGovde, kuruluDefter, muhasebeGirisi, muhasebeUcu } from "@/lib/muhasebe/istek.server"
import { FisHatasi } from "@/lib/muhasebe/onay.server"
import { muhasebeyeBildir } from "@/lib/muhasebe/senkron.server"
import { acilisSenkronla } from "@/lib/muhasebe/acilis.server"
import { demirbasGirdisi } from "@/lib/muhasebe/kaynaklar.server"
import { amortismanTablosu, birikmisAmortisman, oncekiAmortismanOnerisi } from "@/lib/muhasebe/amortisman"

export const dynamic = "force-dynamic"

/**
 * Demirbaşlar (sabit kıymetler) — yıl sonu amortisman fişinin kaynağı
 * (kural: lib/muhasebe/amortisman.ts, kaynak türü DEPRECIATION).
 *
 * GET    ?companyId                      → liste + her birinin amortisman tablosu
 * POST   { companyId, ad, hesapKodu, alisTarihi, maliyet, omur, yontem, oncekiAmortisman?, notlar? }
 * PUT    { companyId, id, ...aynı alanlar, cikisTarihi? }
 * DELETE ?companyId&id
 *
 * Demirbaş defter sahibine yazılır (şubede ana firma). Yazınca amortisman fişleri ve
 * (başlangıçtan önce alınmışsa) açılış fişi hemen yeniden kurulur.
 */

const buYil = () => new Date(Date.now() + 3 * 3_600_000).getUTCFullYear()

export const GET = muhasebeUcu(async (request: Request) => {
  const { ctx } = await muhasebeGirisi(new URL(request.url).searchParams.get("companyId"))
  const defter = kuruluDefter(ctx)
  const baslangicYili = defter.ayar.startDate.getUTCFullYear()
  const liste = await prisma.fixedAsset.findMany({ where: { companyId: defter.defterId }, orderBy: [{ acquisitionDate: "desc" }, { name: "asc" }] })
  const yil = buYil()
  return NextResponse.json({
    baslangic: defter.ayar.startDate.toISOString().slice(0, 10),
    demirbaslar: liste.map((a) => {
      const d = demirbasGirdisi(a)
      const birikmis = birikmisAmortisman(d, baslangicYili, yil)
      return {
        id: a.id,
        ad: a.name,
        hesapKodu: a.accountCode,
        alisTarihi: a.acquisitionDate.toISOString().slice(0, 10),
        maliyet: Number(a.cost),
        omur: a.usefulLife,
        yontem: d.yontem,
        oncekiAmortisman: Number(a.priorDepreciation),
        cikisTarihi: a.disposedAt?.toISOString().slice(0, 10) ?? null,
        notlar: a.notes,
        birikmis,
        netDeger: Math.round((Number(a.cost) - birikmis) * 100) / 100,
        tablo: amortismanTablosu(d, baslangicYili),
        oncekiOneri: oncekiAmortismanOnerisi(d, baslangicYili),
      }
    }),
  })
})

type Alanlar = {
  name: string
  accountCode: string
  acquisitionDate: Date
  cost: Prisma.Decimal
  usefulLife: number
  method: string
  priorDepreciation: Prisma.Decimal
  disposedAt: Date | null
  notes: string | null
}

function alanlar(b: Record<string, unknown>, baslangic: Date): Alanlar {
  const ad = typeof b.ad === "string" ? b.ad.trim().slice(0, 200) : ""
  if (!ad) throw new FisHatasi("Demirbaşın adını yazın.")
  const kod = typeof b.hesapKodu === "string" ? b.hesapKodu.trim() : "255"
  // Maddi (252–258) ve maddi olmayan (260–267) duran varlıklar; alt hesap olabilir.
  if (!/^(25[2-8]|26[0-7])(\.\d{1,4})*$/.test(kod)) throw new FisHatasi("Hesap 252–258 (maddi) ya da 260–267 (maddi olmayan) arasında olmalı.")
  const alis = gunParam(b.alisTarihi, "Alış tarihi")
  if (!alis) throw new FisHatasi("Alış tarihini seçin.")
  const maliyet = Number(b.maliyet)
  if (!(maliyet > 0)) throw new FisHatasi("Maliyet 0'dan büyük olmalı.")
  const omur = Math.round(Number(b.omur))
  if (!(omur >= 1 && omur <= 50)) throw new FisHatasi("Faydalı ömür 1–50 yıl olmalı.")
  const yontem = b.yontem === "AZALAN" ? "AZALAN" : "NORMAL"
  // Defter öncesi amortisman yalnız başlangıçtan önce alınan demirbaşta anlamlıdır.
  const once = alis.getTime() < baslangic.getTime() ? Number(b.oncekiAmortisman ?? 0) : 0
  if (!(once >= 0) || once > maliyet) throw new FisHatasi("Önceki yılların amortismanı 0 ile maliyet arasında olmalı.")
  const cikis = gunParam(b.cikisTarihi, "Elden çıkarma tarihi")
  if (cikis && cikis.getTime() < alis.getTime()) throw new FisHatasi("Elden çıkarma tarihi alış tarihinden önce olamaz.")
  return {
    name: ad,
    accountCode: kod,
    acquisitionDate: alis,
    cost: new Prisma.Decimal(maliyet.toFixed(2)),
    usefulLife: omur,
    method: yontem,
    priorDepreciation: new Prisma.Decimal(once.toFixed(2)),
    disposedAt: cikis,
    notes: typeof b.notlar === "string" && b.notlar.trim() ? b.notlar.trim().slice(0, 1000) : null,
  }
}

/** Demirbaşın etkilediği her şey: defterin bütün yıllarının amortisman fişi + açılış. */
async function bildir(defter: ReturnType<typeof kuruluDefter>, id: string, acilisEtkilenir: boolean) {
  const bas = defter.ayar.startDate.getUTCFullYear()
  const yillar = Array.from({ length: Math.max(0, buYil() - bas + 1) }, (_, i) => bas + i)
  await muhasebeyeBildir(defter.defterId, yillar.map((y) => ({ tip: "DEPRECIATION" as const, id: `${id}:${y}` })))
  if (acilisEtkilenir) await acilisSenkronla(defter).catch((e) => console.error("[muhasebe] açılış senkronu (demirbaş):", e))
}

export const POST = muhasebeUcu(async (request: Request) => {
  const body = await jsonGovde(request)
  const { ctx, kullaniciId } = await muhasebeGirisi(body.companyId as string, { yazma: true })
  const defter = kuruluDefter(ctx)
  const veri = alanlar(body, defter.ayar.startDate)
  const a = await prisma.fixedAsset.create({ data: { ...veri, companyId: defter.defterId, createdBy: kullaniciId }, select: { id: true } })
  await bildir(defter, a.id, veri.acquisitionDate.getTime() < defter.ayar.startDate.getTime())
  return NextResponse.json({ id: a.id }, { status: 201 })
})

export const PUT = muhasebeUcu(async (request: Request) => {
  const body = await jsonGovde(request)
  const { ctx } = await muhasebeGirisi(body.companyId as string, { yazma: true })
  const defter = kuruluDefter(ctx)
  const id = String(body.id ?? "")
  const eski = await prisma.fixedAsset.findFirst({ where: { id, companyId: defter.defterId }, select: { acquisitionDate: true } })
  if (!eski) throw new FisHatasi("Demirbaş bulunamadı", 404)
  const veri = alanlar(body, defter.ayar.startDate)
  await prisma.fixedAsset.update({ where: { id }, data: veri })
  const bas = defter.ayar.startDate.getTime()
  await bildir(defter, id, eski.acquisitionDate.getTime() < bas || veri.acquisitionDate.getTime() < bas)
  return NextResponse.json({ ok: true })
})

export const DELETE = muhasebeUcu(async (request: Request) => {
  const sp = new URL(request.url).searchParams
  const { ctx } = await muhasebeGirisi(sp.get("companyId"), { yazma: true })
  const defter = kuruluDefter(ctx)
  const id = sp.get("id") ?? ""
  const eski = await prisma.fixedAsset.findFirst({ where: { id, companyId: defter.defterId }, select: { acquisitionDate: true } })
  if (!eski) throw new FisHatasi("Demirbaş bulunamadı", 404)
  await prisma.fixedAsset.delete({ where: { id } })
  // Taslak amortisman fişleri kalkar; onaylı olanlar "belge değişti" işaretlenir (senkron).
  await bildir(defter, id, eski.acquisitionDate.getTime() < defter.ayar.startDate.getTime())
  return NextResponse.json({ ok: true })
})
