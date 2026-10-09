import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"
import { kilitliMi, type DefterBaglami, type MuhasebeAyari } from "@/lib/muhasebe/defter.server"
import { mizan } from "@/lib/muhasebe/defter-sorgu.server"
import { planHaritasi } from "@/lib/muhasebe/hesap-plani.server"
import { fisNumaratoru } from "@/lib/muhasebe/senkron.server"
import { FisHatasi } from "@/lib/muhasebe/onay.server"
import { r2 } from "@/lib/muhasebe/fis"
import { ayAraligi, aylar, gecenAy, kdvMahsupPlani, type KdvMahsupPlani, type YaprakBakiye } from "@/lib/muhasebe/kdv-mahsup"
import { computeVatDeclaration } from "@/lib/raporlar/vergiler"

/**
 * AYLIK KDV MAHSUBU — uygulama (kural: kdv-mahsup.ts).
 *
 * Mahsup fişi kullanıcı başlatınca ONAYLI yazılır (kapanış fişleri gibi; ön izlemeyi
 * görüp onaylar). Kaynağı başka bir kayıt değil defterin kendisidir: `sourceType
 * KDV_MAHSUP`, `sourceId "YYYY-AA"`. Senkron bu türe dokunmaz.
 *
 * Kurallar:
 *   - Aylar SIRAYLA mahsup edilir (devreden KDV bir önceki aydan gelir).
 *   - Ayın (ve öncesinin) KDV satırı olan TASLAK fişi kalmamalı: taslaktaki KDV
 *     mahsuba girmez, sonradan onaylanınca 391/191 yeniden bakiye verir.
 *   - Mahsuptan sonra o aya KDV'li fiş onaylanırsa ya da onay geri alınırsa mahsup
 *     "güncel değil" sayılır: geri alınıp yeniden yapılır.
 *   - Yalnız EN SON mahsup geri alınabilir (sonrakiler onun devredenini kullanır).
 */

type Ctx = DefterBaglami & { ayar: MuhasebeAyari }

export const KDV_MAHSUP_KAYNAGI = "KDV_MAHSUP"
const KDV_ROLLERI = ["KDV_HESAPLANAN", "KDV_INDIRILECEK"]
const ODENECEK_ANAHTARI = "kdv-mahsup:odenecek"
const DEVREDEN_ANAHTARI = "kdv-mahsup:devreden"

const altMi = (kod: string, kebir: string) => kod === kebir || kod.startsWith(`${kebir}.`)

export type KdvAyi = {
  ay: string
  /** Ayın onaylı fişlerindeki hesaplanan / indirilecek KDV (hareket, mahsup hariç). */
  hesaplanan: number
  indirilecek: number
  /** Ayda KDV satırı olan taslak fiş sayısı. */
  taslak: number
  mahsup: { id: string; no: string; odenecek: number; devreden: number; guncelDegil: boolean } | null
  durum: "yapildi" | "bekliyor" | "gerekmez"
  kilitli: boolean
}

export async function kdvAylari(ctx: Ctx, simdi: Date = new Date()): Promise<KdvAyi[]> {
  const sonAy = gecenAy(simdi)
  const liste = aylar(ctx.ayar.startDate, sonAy)
  if (liste.length === 0) return []

  const [hareketler, taslaklar, mahsuplar, sonOnaylar] = await Promise.all([
    prisma.$queryRaw<Array<{ ay: string; kebir: string; b: unknown; a: unknown }>>`
      SELECT to_char(v.date, 'YYYY-MM') AS ay, split_part(a.code, '.', 1) AS kebir,
        SUM(CASE WHEN l.side = 'DEBIT' THEN l.amount ELSE 0 END) AS b,
        SUM(CASE WHEN l.side = 'CREDIT' THEN l.amount ELSE 0 END) AS a
      FROM journal_voucher_lines l
      JOIN journal_vouchers v ON v.id = l."voucherId"
      JOIN account_plans a ON a.id = l."accountId"
      WHERE v."companyId" = ${ctx.defterId} AND v.status = 'POSTED' AND v."sourceType" <> ${KDV_MAHSUP_KAYNAGI}
        AND split_part(a.code, '.', 1) IN ('191', '391')
      GROUP BY 1, 2
    `,
    prisma.$queryRaw<Array<{ ay: string; n: number }>>`
      SELECT to_char(v.date, 'YYYY-MM') AS ay, COUNT(DISTINCT v.id)::int AS n
      FROM journal_voucher_lines l JOIN journal_vouchers v ON v.id = l."voucherId"
      WHERE v."companyId" = ${ctx.defterId} AND v.status = 'DRAFT' AND l.role IN (${Prisma.join(KDV_ROLLERI)})
      GROUP BY 1
    `,
    prisma.journalVoucher.findMany({
      where: { companyId: ctx.defterId, sourceType: KDV_MAHSUP_KAYNAGI },
      select: {
        id: true,
        voucherNo: true,
        sourceId: true,
        approvedAt: true,
        createdAt: true,
        lines: { select: { side: true, amount: true, role: true } },
      },
    }),
    // Ay başına KDV'li onaylı fişin EN SON onay anı — mahsuptan sonra onaylanan var mı.
    prisma.$queryRaw<Array<{ ay: string; son: Date }>>`
      SELECT to_char(v.date, 'YYYY-MM') AS ay, MAX(v."approvedAt") AS son
      FROM journal_vouchers v
      WHERE v."companyId" = ${ctx.defterId} AND v.status = 'POSTED' AND v."sourceType" <> ${KDV_MAHSUP_KAYNAGI}
        AND EXISTS (SELECT 1 FROM journal_voucher_lines l WHERE l."voucherId" = v.id AND l.role IN (${Prisma.join(KDV_ROLLERI)}))
      GROUP BY 1
    `,
  ])
  const hareket = (ay: string, kebir: string) => {
    const h = hareketler.find((x) => x.ay === ay && x.kebir === kebir)
    return h ? r2(Number(h.b ?? 0) - Number(h.a ?? 0)) : 0
  }
  const taslakSay = new Map(taslaklar.map((t) => [t.ay, t.n]))
  const sonOnay = new Map(sonOnaylar.map((s) => [s.ay, s.son]))
  const mahsupMap = new Map(mahsuplar.map((m) => [m.sourceId ?? "", m]))

  let oncekiTaslak = 0
  return liste.map((ay) => {
    const m = mahsupMap.get(ay)
    const taslak = taslakSay.get(ay) ?? 0
    oncekiTaslak += taslak
    const hesaplanan = r2(-hareket(ay, "391"))
    const indirilecek = hareket(ay, "191")
    const odenecek = m ? r2(m.lines.filter((l) => l.role === "KDV_ODENECEK").reduce((a, l) => a + Number(l.amount), 0)) : 0
    const devredenB = m ? m.lines.filter((l) => l.role === "KDV_DEVREDEN" && l.side === "DEBIT").reduce((a, l) => a + Number(l.amount), 0) : 0
    const son = sonOnay.get(ay)
    // Ay ve öncesinde taslak KDV fişi kaldıysa ya da mahsuptan sonra onay geldiyse mahsup eskidir.
    const guncelDegil = Boolean(m && (oncekiTaslak > 0 || (son && m.approvedAt && son.getTime() > m.approvedAt.getTime())))
    const kdvVar = hesaplanan !== 0 || indirilecek !== 0 || taslak > 0
    return {
      ay,
      hesaplanan,
      indirilecek,
      taslak,
      mahsup: m ? { id: m.id, no: m.voucherNo, odenecek, devreden: r2(devredenB), guncelDegil } : null,
      durum: m ? "yapildi" : kdvVar ? "bekliyor" : "gerekmez",
      kilitli: kilitliMi(ctx.ayar, ayAraligi(ay).son),
    }
  })
}

export type KdvOnizleme = {
  plan: KdvMahsupPlani
  engeller: string[]
  /** 360 / 190 alt hesaplıysa seçilebilecek yapraklar. */
  secenekler: { odenecek: Array<{ kod: string; ad: string }> | null; devreden: Array<{ kod: string; ad: string }> | null }
  secim: { odenecek: string | null; devreden: string | null }
  /** Vergi raporundaki (belgelerden) KDV — defterle karşılaştırma için. */
  vergiRaporu: { hesaplanan: number; indirilecek: number; kursuzBelge: number }
}

export async function kdvMahsupOnizleme(
  ctx: Ctx,
  ay: string,
  istenen: { odenecek?: string | null; devreden?: string | null } = {},
  simdi: Date = new Date(),
): Promise<KdvOnizleme> {
  if (!/^\d{4}-\d{2}$/.test(ay)) throw new FisHatasi("Ay YYYY-AA biçiminde olmalı.")
  const liste = await kdvAylari(ctx, simdi)
  const i = liste.findIndex((a) => a.ay === ay)
  if (i < 0) throw new FisHatasi("Bu ay mahsup edilebilecek aylar arasında değil (defterin başlangıcından geçen aya kadar).")
  const engeller: string[] = []
  const bu = liste[i]
  if (bu.mahsup) engeller.push("Bu ayın mahsubu yapılmış.")
  if (bu.kilitli) engeller.push("Ay kapanmış (kilitli) dönemde.")
  const oncekiBekleyen = liste.slice(0, i).filter((a) => a.durum === "bekliyor")
  if (oncekiBekleyen.length) engeller.push(`Önce ${oncekiBekleyen.map((a) => a.ay).join(", ")} mahsup edilmeli (devreden KDV oradan gelir).`)
  const taslak = liste.slice(0, i + 1).reduce((a, x) => a + x.taslak, 0)
  if (taslak > 0) engeller.push(`Bu ay ve öncesinde KDV satırı olan ${taslak} taslak fiş var — önce onaylayın.`)

  const { bas, son } = ayAraligi(ay)
  const [m, plan, kurallar] = await Promise.all([
    mizan(ctx.defterId, { bas: null, bit: son }),
    planHaritasi(ctx.defterId),
    prisma.accountMappingRule.findMany({
      where: { companyId: ctx.defterId, key: { in: [ODENECEK_ANAHTARI, DEVREDEN_ANAHTARI] } },
      select: { key: true, account: { select: { code: true } } },
    }),
  ])
  const yaprakMi = (kod: string) => plan.get(kod)?.yaprak ?? true
  const yapraklar = (kebir: string): YaprakBakiye[] =>
    m
      .filter((s) => s.duzey >= 3 && altMi(s.kod, kebir) && yaprakMi(s.kod))
      .map((s) => ({ kod: s.kod, bakiye: r2(s.bakiyeBorc - s.bakiyeAlacak) }))
  const adlar = await prisma.accountPlan.findMany({
    where: { companyId: ctx.defterId, OR: [{ code: { startsWith: "360." } }, { code: { startsWith: "190." } }], isActive: true },
    select: { id: true, code: true, name: true },
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
  const secim = {
    odenecek: hesapSec("360", istenen.odenecek, ODENECEK_ANAHTARI),
    devreden: hesapSec("190", istenen.devreden, DEVREDEN_ANAHTARI),
  }
  const p = kdvMahsupPlani({
    ay,
    hesaplanan: yapraklar("391"),
    indirilecek: yapraklar("191"),
    devreden: yapraklar("190").reduce((a, h) => a + h.bakiye, 0),
    odenecekHesabi: secim.odenecek,
    devredenHesabi: secim.devreden,
  })

  // Vergi raporu (belgelerden) — defterin her firması için aynı ay.
  const [y, mo] = ay.split("-").map(Number)
  const beyanlar = await Promise.all(ctx.sirketIds.map((id) => computeVatDeclaration({ companyId: id, year: y, month: mo })))
  void bas
  return {
    plan: p,
    engeller,
    secenekler: { odenecek: secenek("360"), devreden: secenek("190") },
    secim,
    vergiRaporu: {
      hesaplanan: r2(beyanlar.reduce((a, b) => a + b.calculatedVAT, 0)),
      indirilecek: r2(beyanlar.reduce((a, b) => a + b.deductibleVAT, 0)),
      kursuzBelge: beyanlar.reduce((a, b) => a + b.unconvertedForeign, 0),
    },
  }
}

const ROL: Record<string, string> = {
  "Hesaplanan KDV kapatıldı": "KDV_HESAPLANAN",
  "İndirilecek KDV kapatıldı": "KDV_INDIRILECEK",
  "Ödenecek KDV": "KDV_ODENECEK",
}

export async function kdvMahsupYap(
  ctx: Ctx,
  ay: string,
  istenen: { odenecek?: string | null; devreden?: string | null },
  kullaniciId: string,
): Promise<{ id: string; odenecek: number; devreden: number }> {
  const o = await kdvMahsupOnizleme(ctx, ay, istenen)
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
      role: ROL[s.aciklama] ?? "KDV_DEVREDEN",
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
          description: `${ayMetni(ay)} KDV mahsubu`,
          status: "POSTED",
          sourceType: KDV_MAHSUP_KAYNAGI,
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
      // Alt hesap seçimi sonraki aylar için hatırlanır.
      for (const [anahtar, kod] of [
        [ODENECEK_ANAHTARI, o.secim.odenecek],
        [DEVREDEN_ANAHTARI, o.secim.devreden],
      ] as const) {
        const h = kod ? plan.get(kod) : null
        if (!h || kod === "360" || kod === "190") continue
        await prisma.accountMappingRule.upsert({
          where: { companyId_key: { companyId: ctx.defterId, key: anahtar } },
          create: { companyId: ctx.defterId, key: anahtar, accountId: h.id, updatedBy: kullaniciId },
          update: { accountId: h.id, hits: { increment: 1 }, updatedBy: kullaniciId },
        })
      }
      return { id: fis.id, odenecek: o.plan.odenecek, devreden: o.plan.devredenSonraki }
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        const hedef = String(e.meta?.target ?? "")
        if (!hedef.includes("voucherNo")) throw new FisHatasi("Bu ayın mahsubu bu sırada başka bir oturumda yapıldı.", 409)
        await numara.tazele(son)
        continue
      }
      throw e
    }
  }
  throw new FisHatasi("Fiş numarası alınamadı, tekrar deneyin.", 409)
}

/** Yalnız EN SON mahsup geri alınır (sonraki ay onun devredenini kullanırdı). */
export async function kdvMahsupGeriAl(ctx: Ctx, ay: string): Promise<void> {
  const mahsuplar = await prisma.journalVoucher.findMany({
    where: { companyId: ctx.defterId, sourceType: KDV_MAHSUP_KAYNAGI },
    select: { id: true, sourceId: true, date: true },
  })
  const bu = mahsuplar.find((m) => m.sourceId === ay)
  if (!bu) throw new FisHatasi("Bu ayın mahsubu yok.", 404)
  if (mahsuplar.some((m) => (m.sourceId ?? "") > ay)) {
    throw new FisHatasi("Yalnız en son yapılan mahsup geri alınabilir; önce sonraki ayların mahsubunu geri alın.", 409)
  }
  if (kilitliMi(ctx.ayar, bu.date)) throw new FisHatasi("Ay kapanmış (kilitli) dönemde.")
  await prisma.journalVoucher.deleteMany({ where: { id: bu.id, sourceType: KDV_MAHSUP_KAYNAGI } })
}

const AYLAR = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"]
const ayMetni = (ay: string) => {
  const [y, m] = ay.split("-").map(Number)
  return `${AYLAR[m - 1]} ${y}`
}
