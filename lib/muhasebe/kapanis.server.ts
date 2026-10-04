import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"
import type { DefterBaglami, MuhasebeAyari } from "@/lib/muhasebe/defter.server"
import { mizan } from "@/lib/muhasebe/defter-sorgu.server"
import { kapanisPlani, type KapanisFisi } from "@/lib/muhasebe/kapanis"
import { fisNumaratoru } from "@/lib/muhasebe/senkron.server"
import { planHaritasi } from "@/lib/muhasebe/hesap-plani.server"
import { FisHatasi } from "@/lib/muhasebe/onay.server"

/**
 * DÖNEM KAPANIŞI — uygulama (plan: kapanis.ts).
 *
 * Ön koşullar: yılın içinde TASLAK fiş kalmamış; önceki yıl (defter o yıla
 * uzanıyorsa) kapanmış; yıl zaten kapanmamış. Kapanış fişleri ONAYLI yazılır,
 * `lockedUntil` = 31 Aralık. Geri alma yalnız EN SON kapanan yıl için: fişler silinir,
 * kilit önceki kapanmış yıla (yoksa kaldırılır) çekilir.
 */

type Ctx = DefterBaglami & { ayar: MuhasebeAyari }

export const KAPANIS_KAYNAGI = "CLOSING"

const yilSonu = (yil: number) => new Date(Date.UTC(yil, 11, 31))

export async function kapanisDurumu(ctx: Ctx, yil: number, kapanisStoku?: number | null) {
  const bas = new Date(Date.UTC(yil, 0, 1))
  const son = yilSonu(yil)
  const [taslak, kapanmis, oncekiKapanmis] = await Promise.all([
    prisma.journalVoucher.count({ where: { companyId: ctx.defterId, status: "DRAFT", date: { lte: son } } }),
    prisma.journalVoucher.count({ where: { companyId: ctx.defterId, sourceType: KAPANIS_KAYNAGI, sourceId: { startsWith: `${yil}:` } } }),
    prisma.journalVoucher.count({ where: { companyId: ctx.defterId, sourceType: KAPANIS_KAYNAGI, sourceId: { startsWith: `${yil - 1}:` } } }),
  ])
  const engeller: string[] = []
  if (kapanmis > 0) engeller.push(`${yil} zaten kapanmış.`)
  if (ctx.ayar.startDate.getTime() > son.getTime()) engeller.push(`Defter ${yil} sonrasında başlıyor.`)
  if (taslak > 0) engeller.push(`${yil} sonuna kadar ${taslak} taslak fiş var — onaylayın ya da silin.`)
  // Defter önceki yıla uzanıyorsa o yıl önce kapanmalı (açılış fişi oradan gelir).
  if (ctx.ayar.startDate.getTime() < bas.getTime() && oncekiKapanmis === 0) {
    engeller.push(`Önce ${yil - 1} kapanmalı.`)
  }
  const m = await mizan(ctx.defterId, { bas: null, bit: son })
  const plan = kapanisPlani({ yil, mizan: m, kapanisStoku: kapanisStoku ?? null })
  const stok153 = m.find((s) => s.kod === "153")
  return {
    yil,
    kapanmis: kapanmis > 0,
    taslak,
    engeller: [...engeller, ...plan.hatalar],
    uyarilar: plan.uyarilar,
    netKar: plan.netKar,
    stok153: stok153 ? Math.round((stok153.bakiyeBorc - stok153.bakiyeAlacak) * 100) / 100 : 0,
    fisler: plan.fisler.map((f) => ({
      anahtar: f.anahtar,
      aciklama: f.aciklama,
      tarih: f.tarih.toISOString().slice(0, 10),
      tutar: Math.round(f.satirlar.filter((s) => s.taraf === "B").reduce((a, s) => a + s.tutar, 0) * 100) / 100,
      satirSayisi: f.satirlar.length,
    })),
    plan,
  }
}

export async function kapanisYap(ctx: Ctx, yil: number, kapanisStoku: number | null, kullaniciId: string) {
  const d = await kapanisDurumu(ctx, yil, kapanisStoku)
  if (d.engeller.length) throw new FisHatasi(d.engeller.join(" "), 409)
  const plan = await planHaritasi(ctx.defterId)
  const hesapId = (kod: string) => {
    const h = plan.get(kod)
    if (!h) throw new FisHatasi(`${kod} hesabı planda yok.`)
    if (!h.yaprak) throw new FisHatasi(`${kod} alt hesaplı; kapanış fişi yazılamaz.`)
    return h.id
  }
  // Hesaplar önce çözülür: biri eksikse hiçbir fiş yazılmadan durulur.
  const hazir = d.plan.fisler.map((f: KapanisFisi) => ({ f, ids: f.satirlar.map((s) => hesapId(s.kod)) }))
  const numara = fisNumaratoru(ctx.defterId)
  const simdi = new Date()
  const veriler = []
  for (const { f, ids } of hazir) {
    veriler.push({
      companyId: ctx.defterId,
      voucherNo: await numara.sonraki(f.tarih),
      date: f.tarih,
      description: f.aciklama,
      status: "POSTED",
      sourceType: KAPANIS_KAYNAGI,
      sourceId: `${yil}:${f.anahtar}`,
      sourceCompanyId: ctx.defterId,
      kind: f.tur,
      isConfident: true,
      approvedAt: simdi,
      approvedBy: kullaniciId,
      createdBy: kullaniciId,
      lines: {
        create: f.satirlar.map((s, i) => ({
          companyId: ctx.defterId,
          order: i,
          side: s.taraf === "B" ? "DEBIT" : "CREDIT",
          amount: new Prisma.Decimal(s.tutar.toFixed(2)),
          accountId: ids[i],
          suggestedCode: s.kod,
          role: "KAPANIS",
          accountSource: "USER",
          learnKeys: [],
          description: s.aciklama,
        })),
      },
    })
  }
  await prisma.$transaction([
    ...veriler.map((data) => prisma.journalVoucher.create({ data })),
    prisma.accountingSettings.update({
      where: { companyId: ctx.defterId },
      data: { lockedUntil: yilSonu(yil), updatedBy: kullaniciId },
    }),
  ])
  return { netKar: d.netKar, fisSayisi: veriler.length }
}

export async function kapanisGeriAl(ctx: Ctx, yil: number, kullaniciId: string) {
  const sonKilit = ctx.ayar.lockedUntil
  if (!sonKilit || sonKilit.getTime() !== yilSonu(yil).getTime()) {
    throw new FisHatasi("Yalnız en son kapanan yılın kapanışı geri alınabilir.", 409)
  }
  const oncekiKapanmis = await prisma.journalVoucher.count({
    where: { companyId: ctx.defterId, sourceType: KAPANIS_KAYNAGI, sourceId: { startsWith: `${yil - 1}:` } },
  })
  await prisma.$transaction([
    prisma.journalVoucher.deleteMany({
      where: { companyId: ctx.defterId, sourceType: KAPANIS_KAYNAGI, sourceId: { startsWith: `${yil}:` } },
    }),
    prisma.accountingSettings.update({
      where: { companyId: ctx.defterId },
      data: { lockedUntil: oncekiKapanmis > 0 ? yilSonu(yil - 1) : null, updatedBy: kullaniciId },
    }),
  ])
}
