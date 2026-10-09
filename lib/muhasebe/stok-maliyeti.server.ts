import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"
import { kilitliMi, type DefterBaglami, type MuhasebeAyari } from "@/lib/muhasebe/defter.server"
import { mizan } from "@/lib/muhasebe/defter-sorgu.server"
import { planHaritasi } from "@/lib/muhasebe/hesap-plani.server"
import { fisNumaratoru } from "@/lib/muhasebe/senkron.server"
import { FisHatasi } from "@/lib/muhasebe/onay.server"
import { r2 } from "@/lib/muhasebe/fis"
import { ayAraligi, aylar, gecenAy, type YaprakBakiye } from "@/lib/muhasebe/kdv-mahsup"
import { ayBitisAni, smmPlani, type SmmPlani } from "@/lib/muhasebe/stok-maliyeti"
import { resolveUnitCostsAsOf } from "@/lib/stock/cost"
import { OUTBOUND_MOVEMENT_TYPES } from "@/lib/stock/movement-sign"

/**
 * AYLIK SATILAN MALIN MALİYETİ — uygulama (kural: stok-maliyeti.ts).
 *
 * KDV mahsubuyla aynı düzen: kullanıcı başlatır, fiş ONAYLI yazılır (`sourceType
 * STOK_MALIYET`, `sourceId "YYYY-AA"`), aylar sırayla, yalnız en son ay geri alınır,
 * ayın (ve öncesinin) 153'e yazan taslak alış fişi kalmamalı.
 *
 * Stok değeri Kobipo'nun stok defterinden: ürün başına ay sonu miktarı (işaretli hareket
 * toplamı, lib/stock/movement-sign.ts) × o ana kadarki ağırlıklı ortalama maliyet
 * (lib/stock/cost.ts → resolveUnitCostsAsOf). Hareketin tarihi `createdAt`tir.
 */

type Ctx = DefterBaglami & { ayar: MuhasebeAyari }

export const SMM_KAYNAGI = "STOK_MALIYET"
const GIDER_ANAHTARI = "smm:gider"
const STOK_ANAHTARI = "smm:stok"

const altMi = (kod: string, kebir: string) => kod === kebir || kod.startsWith(`${kebir}.`)

export type StokDegeri = {
  deger: number
  urunSayisi: number
  /** Stokta olan ama maliyeti bilinmeyen ürünler (değere 0 girdi). */
  maliyetsiz: Array<{ ad: string; miktar: number }>
  /** Eksi stoklu ürün sayısı (değere 0 girdi). */
  eksiStok: number
  /** TL dışı para birimli ürün (değere girmedi). */
  dovizli: number
}

/** Defterin bütün firmalarında `once` anından önceki stok değeri. */
export async function stokDegeri(sirketIds: string[], once: Date): Promise<StokDegeri> {
  const sonuc: StokDegeri = { deger: 0, urunSayisi: 0, maliyetsiz: [], eksiStok: 0, dovizli: 0 }
  if (sirketIds.length === 0) return sonuc
  const miktarlar = await prisma.$queryRaw<Array<{ companyId: string; id: string; name: string; currency: string | null; miktar: unknown }>>`
    SELECT p."companyId", p.id, p.name, p.currency,
      SUM(CASE WHEN m.quantity > 0 AND m.type IN (${Prisma.join(OUTBOUND_MOVEMENT_TYPES)}) THEN -m.quantity ELSE m.quantity END) AS miktar
    FROM products p
    JOIN stock_movements m ON m."productId" = p.id AND m."companyId" = p."companyId"
    WHERE p."companyId" IN (${Prisma.join(sirketIds)}) AND p."isService" = false AND m."createdAt" < ${once}
    GROUP BY p."companyId", p.id, p.name, p.currency
  `
  const firmaBasina = new Map<string, typeof miktarlar>()
  for (const r of miktarlar) firmaBasina.set(r.companyId, [...(firmaBasina.get(r.companyId) ?? []), r])
  for (const [companyId, urunler] of firmaBasina) {
    const eldeki = urunler.filter((u) => Number(u.miktar ?? 0) > 0.0001)
    sonuc.eksiStok += urunler.filter((u) => Number(u.miktar ?? 0) < -0.0001).length
    const tl = eldeki.filter((u) => (u.currency || "TRY").toUpperCase() === "TRY")
    sonuc.dovizli += eldeki.length - tl.length
    const maliyet = await resolveUnitCostsAsOf(companyId, tl.map((u) => u.id), once)
    for (const u of tl) {
      const miktar = Number(u.miktar)
      const birim = maliyet.get(u.id)
      sonuc.urunSayisi++
      if (birim == null) {
        sonuc.maliyetsiz.push({ ad: u.name, miktar: Math.round(miktar * 10000) / 10000 })
        continue
      }
      sonuc.deger += miktar * birim
    }
  }
  sonuc.deger = r2(sonuc.deger)
  return sonuc
}

/** Defterin firmalarında hiç stok hareketi var mı — yoksa aylık maliyet "gerekmez". */
async function stokTakibiVar(sirketIds: string[]): Promise<boolean> {
  const n = await prisma.stockMovement.count({ where: { companyId: { in: sirketIds } }, take: 1 })
  return n > 0
}

export type SmmAyi = {
  ay: string
  /** Ayda 153'e yazan taslak alış fişi. */
  taslak: number
  mahsup: { id: string; no: string; maliyet: number; guncelDegil: boolean } | null
  durum: "yapildi" | "bekliyor" | "gerekmez"
  kilitli: boolean
}

export async function smmAylari(ctx: Ctx, simdi: Date = new Date()): Promise<{ stokTakibi: boolean; aylar: SmmAyi[] }> {
  const liste = aylar(ctx.ayar.startDate, gecenAy(simdi))
  const takip = await stokTakibiVar(ctx.sirketIds)
  if (liste.length === 0) return { stokTakibi: takip, aylar: [] }
  const [taslaklar, mahsuplar, sonOnaylar] = await Promise.all([
    prisma.$queryRaw<Array<{ ay: string; n: number }>>`
      SELECT to_char(v.date, 'YYYY-MM') AS ay, COUNT(DISTINCT v.id)::int AS n
      FROM journal_voucher_lines l JOIN journal_vouchers v ON v.id = l."voucherId"
      LEFT JOIN account_plans a ON a.id = l."accountId"
      WHERE v."companyId" = ${ctx.defterId} AND v.status = 'DRAFT'
        AND (split_part(a.code, '.', 1) = '153' OR (l."accountId" IS NULL AND l."suggestedCode" = '153'))
      GROUP BY 1
    `,
    prisma.journalVoucher.findMany({
      where: { companyId: ctx.defterId, sourceType: SMM_KAYNAGI },
      select: { id: true, voucherNo: true, sourceId: true, approvedAt: true, lines: { select: { side: true, amount: true, role: true } } },
    }),
    prisma.$queryRaw<Array<{ ay: string; son: Date }>>`
      SELECT to_char(v.date, 'YYYY-MM') AS ay, MAX(v."approvedAt") AS son
      FROM journal_vouchers v
      WHERE v."companyId" = ${ctx.defterId} AND v.status = 'POSTED' AND v."sourceType" <> ${SMM_KAYNAGI}
        AND EXISTS (SELECT 1 FROM journal_voucher_lines l JOIN account_plans a ON a.id = l."accountId"
                    WHERE l."voucherId" = v.id AND split_part(a.code, '.', 1) = '153')
      GROUP BY 1
    `,
  ])
  const taslakSay = new Map(taslaklar.map((t) => [t.ay, t.n]))
  const sonOnay = new Map(sonOnaylar.map((s) => [s.ay, s.son]))
  const mahsupMap = new Map(mahsuplar.map((m) => [m.sourceId ?? "", m]))
  let oncekiTaslak = 0
  return {
    stokTakibi: takip,
    aylar: liste.map((ay) => {
      const m = mahsupMap.get(ay)
      const taslak = taslakSay.get(ay) ?? 0
      oncekiTaslak += taslak
      const son = sonOnay.get(ay)
      const maliyet = m
        ? r2(m.lines.filter((l) => l.role === "SMM").reduce((a, l) => a + (l.side === "DEBIT" ? 1 : -1) * Number(l.amount), 0))
        : 0
      return {
        ay,
        taslak,
        mahsup: m
          ? { id: m.id, no: m.voucherNo, maliyet, guncelDegil: oncekiTaslak > 0 || Boolean(son && m.approvedAt && son.getTime() > m.approvedAt.getTime()) }
          : null,
        durum: m ? "yapildi" : takip ? "bekliyor" : "gerekmez",
        kilitli: kilitliMi(ctx.ayar, ayAraligi(ay).son),
      }
    }),
  }
}

export type SmmOnizleme = {
  plan: SmmPlani
  engeller: string[]
  stok: StokDegeri
  secenekler: { maliyet: Array<{ kod: string; ad: string }> | null; stok: Array<{ kod: string; ad: string }> | null }
  secim: { maliyet: string | null; stok: string | null }
}

export async function smmOnizleme(
  ctx: Ctx,
  ay: string,
  istenen: { maliyet?: string | null; stok?: string | null } = {},
  simdi: Date = new Date(),
): Promise<SmmOnizleme> {
  if (!/^\d{4}-\d{2}$/.test(ay)) throw new FisHatasi("Ay YYYY-AA biçiminde olmalı.")
  const { stokTakibi, aylar: liste } = await smmAylari(ctx, simdi)
  const i = liste.findIndex((a) => a.ay === ay)
  if (i < 0) throw new FisHatasi("Bu ay hesaplanabilecek aylar arasında değil (defterin başlangıcından geçen aya kadar).")
  const engeller: string[] = []
  const bu = liste[i]
  if (!stokTakibi) engeller.push("Kobipo'da stok hareketi yok: maliyet yıl sonu sayımıyla dönem kapanışında hesaplanır.")
  if (bu.mahsup) engeller.push("Bu ayın maliyeti hesaplanmış.")
  if (bu.kilitli) engeller.push("Ay kapanmış (kilitli) dönemde.")
  const onceki = liste.slice(0, i).filter((a) => a.durum === "bekliyor")
  if (onceki.length) engeller.push(`Önce ${onceki.map((a) => a.ay).join(", ")} hesaplanmalı (stok bir önceki aydan devreder).`)
  const taslak = liste.slice(0, i + 1).reduce((a, x) => a + x.taslak, 0)
  if (taslak > 0) engeller.push(`Bu ay ve öncesinde ticari mallara (153) yazan ${taslak} taslak fiş var — önce onaylayın.`)

  const { son } = ayAraligi(ay)
  const [m, plan, kurallar, stok] = await Promise.all([
    mizan(ctx.defterId, { bas: null, bit: son }),
    planHaritasi(ctx.defterId),
    prisma.accountMappingRule.findMany({
      where: { companyId: ctx.defterId, key: { in: [GIDER_ANAHTARI, STOK_ANAHTARI] } },
      select: { key: true, account: { select: { code: true } } },
    }),
    stokDegeri(ctx.sirketIds, ayBitisAni(ay)),
  ])
  const yaprakMi = (kod: string) => plan.get(kod)?.yaprak ?? true
  const stok153: YaprakBakiye[] = m
    .filter((s) => s.duzey >= 3 && altMi(s.kod, "153") && yaprakMi(s.kod))
    .map((s) => ({ kod: s.kod, bakiye: r2(s.bakiyeBorc - s.bakiyeAlacak) }))
  const adlar = await prisma.accountPlan.findMany({
    where: { companyId: ctx.defterId, OR: [{ code: { startsWith: "621." } }, { code: { startsWith: "153." } }], isActive: true },
    select: { code: true, name: true },
  })
  const secenek = (kebir: string) => {
    const k = plan.get(kebir)
    if (!k || k.yaprak) return null
    return adlar.filter((h) => altMi(h.code, kebir) && plan.get(h.code)?.yaprak).map((h) => ({ kod: h.code, ad: h.name }))
  }
  const ogrenilen = (anahtar: string) => kurallar.find((k) => k.key === anahtar)?.account.code ?? null
  const hesapSec = (kebir: string, istek: string | null | undefined, anahtar: string): string | null => {
    const k = plan.get(kebir)
    if (k?.yaprak && k.aktif) return kebir
    const aday = istek ?? ogrenilen(anahtar)
    return aday && altMi(aday, kebir) && plan.get(aday)?.yaprak && plan.get(aday)?.aktif ? aday : null
  }
  const secim = { maliyet: hesapSec("621", istenen.maliyet, GIDER_ANAHTARI), stok: hesapSec("153", istenen.stok, STOK_ANAHTARI) }
  return {
    plan: smmPlani({ ay, stok153, stokDegeri: stok.deger, maliyetHesabi: secim.maliyet, stokYapragi: secim.stok }),
    engeller,
    stok,
    secenekler: { maliyet: secenek("621"), stok: secenek("153") },
    secim,
  }
}

export async function smmYap(
  ctx: Ctx,
  ay: string,
  istenen: { maliyet?: string | null; stok?: string | null },
  kullaniciId: string,
): Promise<{ id: string; maliyet: number }> {
  const o = await smmOnizleme(ctx, ay, istenen)
  if (o.engeller.length) throw new FisHatasi(o.engeller.join(" "), 409)
  if (o.plan.hatalar.length) throw new FisHatasi(o.plan.hatalar.join(" "))
  const plan = await planHaritasi(ctx.defterId)
  const satirlar = o.plan.satirlar.map((s, i) => {
    const h = plan.get(s.kod)
    if (!h || !h.yaprak || !h.aktif) throw new FisHatasi(`${s.kod} hesabına yazılamaz (yok, pasif ya da alt hesaplı).`)
    return {
      companyId: ctx.defterId,
      order: i,
      side: s.taraf === "B" ? "DEBIT" : "CREDIT",
      amount: new Prisma.Decimal(s.tutar.toFixed(2)),
      accountId: h.id,
      suggestedCode: s.kod.split(".")[0],
      role: altMi(s.kod, "621") ? "SMM" : "SMM_STOK",
      accountSource: "USER",
      learnKeys: [],
      description: s.aciklama,
    }
  })
  const { son } = ayAraligi(ay)
  const numara = fisNumaratoru(ctx.defterId)
  const simdi = new Date()
  for (let deneme = 0; deneme < 4; deneme++) {
    try {
      const fis = await prisma.journalVoucher.create({
        data: {
          companyId: ctx.defterId,
          voucherNo: await numara.sonraki(son),
          date: son,
          description: `${ayMetni(ay)} satılan malın maliyeti (ay sonu stok ${o.plan.stokDegeri.toLocaleString("tr-TR")} ₺)`,
          status: "POSTED",
          sourceType: SMM_KAYNAGI,
          sourceId: ay,
          sourceCompanyId: ctx.defterId,
          kind: "MAHSUP",
          isConfident: true,
          approvedAt: simdi,
          approvedBy: kullaniciId,
          createdBy: kullaniciId,
          lines: { create: satirlar },
        },
        select: { id: true },
      })
      for (const [anahtar, kod, kebir] of [
        [GIDER_ANAHTARI, o.secim.maliyet, "621"],
        [STOK_ANAHTARI, o.secim.stok, "153"],
      ] as const) {
        const h = kod ? plan.get(kod) : null
        if (!h || kod === kebir) continue
        await prisma.accountMappingRule.upsert({
          where: { companyId_key: { companyId: ctx.defterId, key: anahtar } },
          create: { companyId: ctx.defterId, key: anahtar, accountId: h.id, updatedBy: kullaniciId },
          update: { accountId: h.id, hits: { increment: 1 }, updatedBy: kullaniciId },
        })
      }
      return { id: fis.id, maliyet: o.plan.maliyet }
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        if (!String(e.meta?.target ?? "").includes("voucherNo")) throw new FisHatasi("Bu ayın maliyeti bu sırada başka bir oturumda hesaplandı.", 409)
        await numara.tazele(son)
        continue
      }
      throw e
    }
  }
  throw new FisHatasi("Fiş numarası alınamadı, tekrar deneyin.", 409)
}

export async function smmGeriAl(ctx: Ctx, ay: string): Promise<void> {
  const fisler = await prisma.journalVoucher.findMany({
    where: { companyId: ctx.defterId, sourceType: SMM_KAYNAGI },
    select: { id: true, sourceId: true, date: true },
  })
  const bu = fisler.find((m) => m.sourceId === ay)
  if (!bu) throw new FisHatasi("Bu ayın maliyet fişi yok.", 404)
  if (fisler.some((m) => (m.sourceId ?? "") > ay)) {
    throw new FisHatasi("Yalnız en son ayın maliyet fişi geri alınabilir; önce sonraki aylarınkini geri alın.", 409)
  }
  if (kilitliMi(ctx.ayar, bu.date)) throw new FisHatasi("Ay kapanmış (kilitli) dönemde.")
  await prisma.journalVoucher.deleteMany({ where: { id: bu.id, sourceType: SMM_KAYNAGI } })
}

const AYLAR = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"]
const ayMetni = (ay: string) => {
  const [y, m] = ay.split("-").map(Number)
  return `${AYLAR[m - 1]} ${y}`
}
