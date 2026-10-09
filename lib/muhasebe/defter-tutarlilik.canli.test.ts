/**
 * MUHASEBE MOTORU TUTARLILIĞI — GERÇEK VERİTABANINA KARŞI, SALT OKUR.
 *
 * Fişleri veritabanına YAZMAZ: her defterin (ana firma + şubeleri) bütün kaynaklarını
 * motorun yükleyicilerinden (kaynaklar.server.ts) geçirip fişleri BELLEKTE kurar,
 * başlangıç tarihi "en baştan" (açılış fişi boş) alınır. Böylece kurulum yapılmamış
 * firmalarda da motoru ölçer.
 *
 *  1. Her fiş dengeli (fisKur dengesiz fişte fırlatır — burada patlar).
 *  2. Cari alt hesaplarının (120.xx / 320.xx) bakiyesi = carinin bakiyesi
 *     (lib/cari/bakiye-asof.ts — bilanço ve cari listesiyle aynı formül). Bilinen fark:
 *     GİB'e gitmemiş e-belge taslağı cari bakiyesine girer, deftere girmez — beklenen
 *     değere o belgeler düşülerek bakılır. Dövizli belgesi olan cari ölçülmez
 *     (cari bakiyesi ham tutarla, defter kurla çalışır).
 *  3. Kasa/banka alt hesaplarının bakiyesi = hesabın bugünkü bakiyesi
 *     (`financial_accounts.balance`; dövizli hesap ölçülmez).
 *
 * Kapsam `DEFTER_FIRMA` (defter sahibi firma id'si) ile daraltılabilir.
 */

import { afterAll, describe, expect, it } from "vitest"
import { config } from "dotenv"

config({ path: ".env.local", override: true })
config()

import { prisma } from "@/lib/db/prisma"
import { KAYNAK_TIPLERI, type KaynakFisi, type KaynakTipi } from "./kaynaklar.server"
import { altAnahtar } from "./hesap-plani"
import { BOS_ESLESME } from "./fis"
import { cariBalancesAsOf } from "@/lib/cari/bakiye-asof"
import { kdvyeGirerMi } from "@/lib/raporlar/kdv-kural"

afterAll(() => prisma.$disconnect())

const FIRMA = process.env.DEFTER_FIRMA || null
const ESKI = new Date(Date.UTC(2000, 0, 1))
const GELECEK = new Date(Date.UTC(2999, 0, 1))
const r2 = (n: number) => Math.round(n * 100) / 100

async function defterler() {
  const sahipler = await prisma.company.findMany({
    where: { parentCompanyId: null, ...(FIRMA ? { id: FIRMA } : {}) },
    select: { id: true, name: true, branches: { select: { id: true } } },
  })
  return sahipler.map((s) => ({ id: s.id, ad: s.name, sirketIds: [s.id, ...s.branches.map((b) => b.id)] }))
}

async function tumFisler(sirketIds: string[]): Promise<KaynakFisi[]> {
  const ctx = { sirketIds, baslangic: ESKI, eslesme: BOS_ESLESME }
  const out: KaynakFisi[] = []
  for (const tip of Object.keys(KAYNAK_TIPLERI) as KaynakTipi[]) out.push(...(await KAYNAK_TIPLERI[tip].yukle(ctx, {})))
  return out
}

describe("muhasebe motoru — canlı veriyle defter tutarlılığı", () => {
  it(
    "fişler dengeli; cari ve kasa alt hesapları kaynak bakiyelerle aynı",
    async () => {
      const liste = await defterler()
      const sorunlar: string[] = []
      const bilinen: string[] = []
      let fisSayisi = 0
      let cariSayisi = 0
      let kasaSayisi = 0
      const turSayisi = new Map<string, number>()

      for (const d of liste) {
        const fisler = await tumFisler(d.sirketIds)
        const alt = new Map<string, number>() // altAnahtar → borç − alacak
        for (const k of fisler) {
          if (k.fis.durum !== "hazir") continue
          fisSayisi++
          turSayisi.set(k.tip, (turSayisi.get(k.tip) ?? 0) + 1)
          for (const s of k.fis.satirlar) {
            if (!s.alt) continue
            const a = altAnahtar(s.alt)
            alt.set(a, r2((alt.get(a) ?? 0) + (s.taraf === "B" ? s.tutar : -s.tutar)))
          }
        }

        // Defterde OLMAYAN ama cari bakiyesine giren belgeler: iptal/dönüşmüş olmayan,
        // KDV'ye (= deftere) girmeyen e-belge taslakları. Dövizli belgeli cari ölçülmez.
        const faturalar = await prisma.invoice.findMany({
          where: { companyId: { in: d.sirketIds }, status: { notIn: ["CANCELLED", "CONVERTED"] } },
          select: {
            type: true,
            returnKind: true,
            status: true,
            invoiceType: true,
            currency: true,
            totalAmount: true,
            customerId: true,
            supplierId: true,
          },
        })
        const duzeltme = new Map<string, number>()
        const dovizli = new Set<string>()
        const ekle = (a: string, v: number) => duzeltme.set(a, r2((duzeltme.get(a) ?? 0) + v))
        for (const f of faturalar) {
          // bakiye-asof.ts işaretleri: müşteri ekseninde satış +, satış iadesi −, alış −,
          // alış iadesi +; tedarikçide tersi. Belge HER iki carisine de yazılır.
          const eksen =
            f.type === "SALES" ? 1 : f.type === "PURCHASE" ? -1 : f.type === "RETURN" && f.returnKind === "PURCHASE" ? 1 : f.type === "RETURN" ? -1 : 0
          const dovizMi = (f.currency || "TRY").toUpperCase() !== "TRY"
          const girer = kdvyeGirerMi(f)
          if (f.customerId) {
            if (dovizMi) dovizli.add(`musteri:${f.customerId}`)
            if (!girer) ekle(`musteri:${f.customerId}`, eksen * Number(f.totalAmount))
          }
          if (f.supplierId) {
            if (dovizMi) dovizli.add(`tedarikci:${f.supplierId}`)
            if (!girer) ekle(`tedarikci:${f.supplierId}`, -eksen * Number(f.totalAmount))
          }
        }

        for (const sirketId of d.sirketIds) {
          const { customers, suppliers } = await cariBalancesAsOf(sirketId, GELECEK)
          for (const [tur, liste2, isaret] of [
            ["musteri", customers, 1],
            ["tedarikci", suppliers, -1],
          ] as const) {
            for (const c of liste2) {
              const a = `${tur}:${c.id}`
              if (dovizli.has(a)) continue
              const beklenen = r2(c.balance - (duzeltme.get(a) ?? 0))
              const defter = r2(isaret * (alt.get(a) ?? 0))
              if (beklenen === 0 && defter === 0) continue
              cariSayisi++
              if (Math.abs(beklenen - defter) > 0.01) {
                sorunlar.push(`${d.ad} · ${a}: cari bakiyesi ${beklenen} ≠ defter ${defter}`)
              }
            }
          }
        }

        const kasalar = await prisma.financialAccount.findMany({
          where: { companyId: { in: d.sirketIds } },
          select: { id: true, name: true, currency: true, balance: true },
        })
        // Kasası bu defterde ama kendisi başka firmanın hareketi (veri tutarsızlığı): kasa
        // bakiyesine girer, bu defterin fişine girmez. Ayrıca raporlanır.
        const yabanci = await prisma.$queryRaw<Array<{ accountId: string; net: unknown; adet: bigint }>>`
          SELECT t."accountId", SUM(CASE WHEN t.type = 'INCOME' THEN t.amount ELSE -t.amount END) AS net, COUNT(*) AS adet
          FROM transactions t JOIN financial_accounts fa ON fa.id = t."accountId"
          WHERE fa."companyId" = ANY(${d.sirketIds}) AND NOT (t."companyId" = ANY(${d.sirketIds}))
          GROUP BY t."accountId"
        `
        const yabanciNet = new Map(yabanci.map((y) => [y.accountId, Number(y.net)]))
        for (const y of yabanci) bilinen.push(`${d.ad} · kasa ${y.accountId}: ${y.adet} hareket başka firmanın (${Number(y.net)} TL)`)
        for (const k of kasalar) {
          if ((k.currency || "TRY").toUpperCase() !== "TRY") continue
          const defter = r2(alt.get(`finans:${k.id}`) ?? 0)
          const bakiye = r2(Number(k.balance) - (yabanciNet.get(k.id) ?? 0))
          if (bakiye === 0 && defter === 0) continue
          kasaSayisi++
          if (Math.abs(bakiye - defter) > 0.01) sorunlar.push(`${d.ad} · kasa ${k.name}: bakiye ${bakiye} ≠ defter ${defter}`)
        }
      }

      console.log(
        `[defter-tutarlılık] ${liste.length} defter · ${fisSayisi} fiş (${[...turSayisi].map(([t, n]) => `${t} ${n}`).join(", ")}) · ${cariSayisi} cari · ${kasaSayisi} kasa`,
      )
      expect(sorunlar, sorunlar.slice(0, 40).join("\n")).toEqual([])
    },
    // Süre veritabanı turuyla doğrusal (defter başına ~20 ardışık sorgu): ~420 ms turda ~4,5 dk,
    // 2026-10-09 gecesi ~750 ms turda 10 dk sınırını aştı — doğrulama değil süre düşürüyordu.
    1_200_000,
  )
})
