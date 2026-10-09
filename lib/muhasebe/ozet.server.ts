import { prisma } from "@/lib/db/prisma"
import type { DefterBaglami, MuhasebeAyari } from "@/lib/muhasebe/defter.server"
import { mizan } from "@/lib/muhasebe/defter-sorgu.server"
import { bilancoKur, gelirTablosuKur, type Bilanco } from "@/lib/muhasebe/mali-tablolar"
import { acilisFisi } from "@/lib/muhasebe/acilis"
import { acilisGirdisi } from "@/lib/muhasebe/acilis.server"
import { kdvAylari } from "@/lib/muhasebe/kdv-mahsup.server"
import { smmAylari } from "@/lib/muhasebe/stok-maliyeti.server"
import { KAPANIS_KAYNAGI } from "@/lib/muhasebe/kapanis.server"
import { ozetAdimlari, type OzetAdimi, type OzetSayilari } from "@/lib/muhasebe/ozet"
import { r2 } from "@/lib/muhasebe/fis"

/**
 * MUHASEBE ÖZETİ — sayılar ve "bu yıl" rakamları (ekran `/muhasebe/ozet`).
 * Adımların metni saf modülde (`ozet.ts`).
 */

type Ctx = DefterBaglami & { ayar: MuhasebeAyari }

export type OzetRakamlari = {
  netSatis: number
  /** Satış dışı gelirler (64x olağan, 67x olağandışı) — kâra girer, satış değildir. */
  digerGelirler: number
  /** Satılan malın maliyeti dahil bütün gider grupları (62, 63, 65, 66, 68, 69). */
  giderler: number
  sonuc: number
  hazirDegerler: number
  alacaklar: number
  borclar: number
}

export type MuhasebeOzeti = {
  sayilar: OzetSayilari
  adimlar: OzetAdimi[]
  donem: { bas: string; bit: string }
  /** Onaylı fişlerden (resmî) ve taslaklar dahil (ön izleme). */
  rakamlar: { onayli: OzetRakamlari; taslakDahil: OzetRakamlari }
}

function rakamlar(b: Bilanco, g: ReturnType<typeof gelirTablosuKur>): OzetRakamlari {
  const kalem = (kod: string) => g.kalemler.find((k) => k.kod === kod)?.tutar ?? 0
  const grup = (kod: string) => [...b.aktif, ...b.pasif].flatMap((bol) => bol.gruplar).find((x) => x.kod === kod)?.tutar ?? 0
  const netSatis = kalem("C")
  // Gider "net satış − net kâr" diye TÜRETİLMEZ: satış dışı gelir (ör. 649) varken gider
  // eksiye düşüyordu (2026-10-09, Reypo: 2 milyon TL'lik diğer gelir → gider −1,88 milyon).
  const digerGelirler = r2(kalem("F") + kalem("I"))
  return {
    netSatis,
    digerGelirler,
    giderler: r2(netSatis + digerGelirler - g.netKar),
    sonuc: g.netKar,
    hazirDegerler: grup("10"),
    alacaklar: grup("12"),
    borclar: grup("32"),
  }
}

export async function muhasebeOzeti(ctx: Ctx, simdi: Date = new Date()): Promise<MuhasebeOzeti> {
  const d = ctx.defterId
  const t = new Date(simdi.getTime() + 3 * 3_600_000)
  const yil = t.getUTCFullYear()
  const bugun = new Date(Date.UTC(yil, t.getUTCMonth(), t.getUTCDate()))
  const yilBasi = new Date(Math.max(Date.UTC(yil, 0, 1), ctx.ayar.startDate.getTime()))

  const [emin, gozden, degisti, onayli, hesapsizSatir, enEski, acilis, kdv, kapanislar, smm] = await Promise.all([
    prisma.journalVoucher.count({ where: { companyId: d, status: "DRAFT", isConfident: true } }),
    prisma.journalVoucher.count({ where: { companyId: d, status: "DRAFT", isConfident: false } }),
    prisma.journalVoucher.count({ where: { companyId: d, status: "POSTED", sourceChangedAt: { not: null } } }),
    prisma.journalVoucher.count({ where: { companyId: d, status: "POSTED" } }),
    prisma.journalVoucherLine.count({ where: { companyId: d, accountId: null, voucher: { status: "DRAFT" } } }),
    prisma.journalVoucher.findFirst({ where: { companyId: d, status: "DRAFT" }, orderBy: { date: "asc" }, select: { date: true } }),
    ctx.ayar.openingVoucherId
      ? prisma.journalVoucher.findUnique({
          where: { id: ctx.ayar.openingVoucherId },
          select: { status: true, isConfident: true, sourceChangedAt: true },
        })
      : null,
    kdvAylari(ctx, simdi),
    prisma.journalVoucher.findMany({
      where: { companyId: d, sourceType: KAPANIS_KAYNAGI },
      select: { sourceId: true },
      distinct: ["sourceId"],
    }),
    smmAylari(ctx, simdi),
  ])

  const kapanan = new Set(kapanislar.map((k) => Number(String(k.sourceId).split(":")[0])))
  const kapanmamisYillar: number[] = []
  for (let y = ctx.ayar.startDate.getUTCFullYear(); y < yil; y++) if (!kapanan.has(y)) kapanmamisYillar.push(y)

  // Açılış fişi yoksa: başlangıçta Kobipo'da bakiye var mıydı (pahalı; yalnız fiş yokken sorulur).
  const baslangicBakiyesiVar = acilis ? true : acilisFisi(await acilisGirdisi(ctx)).satirlar.length > 0

  const sayilar: OzetSayilari = {
    emin,
    gozden,
    degisti,
    onayli,
    hesapsizSatir,
    enEskiTaslak: enEski?.date.toISOString().slice(0, 10) ?? null,
    acilis: acilis
      ? { durum: acilis.status === "POSTED" ? "POSTED" : "DRAFT", emin: acilis.isConfident, degisti: acilis.sourceChangedAt != null }
      : null,
    baslangicBakiyesiVar,
    kapanmamisYillar,
    kdvMahsupBekleyen: kdv.filter((a) => a.durum === "bekliyor" || a.mahsup?.guncelDegil).map((a) => a.ay),
    smmBekleyen: smm.aylar.filter((a) => a.durum === "bekliyor" || a.mahsup?.guncelDegil).map((a) => a.ay),
  }

  const tablolar = async (taslakDahil: boolean) => {
    const [bm, dm] = await Promise.all([
      mizan(d, { bas: null, bit: bugun, taslakDahil, haricKapanis: ["bilanco-kapanis", "acilis"] }),
      mizan(d, { bas: yilBasi, bit: bugun, taslakDahil, haricKapanis: ["gelir-kapanis"] }),
    ])
    return rakamlar(bilancoKur(bm), gelirTablosuKur(dm))
  }
  const [r1, r2_] = await Promise.all([tablolar(false), tablolar(true)])

  return {
    sayilar,
    adimlar: ozetAdimlari(sayilar),
    donem: { bas: yilBasi.toISOString().slice(0, 10), bit: bugun.toISOString().slice(0, 10) },
    rakamlar: { onayli: r1, taslakDahil: r2_ },
  }
}
