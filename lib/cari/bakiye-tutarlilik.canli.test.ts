/**
 * CARİ BAKİYE TUTARLILIĞI — GERÇEK VERİTABANINA KARŞI.
 *
 * ── Neden gerekli ───────────────────────────────────────────────────────────
 * Cari bakiyesi TEK bir yerde hesaplanmıyor: liste (ham SQL), ekstre (satır
 * satır), arşiv kapısı (aggregate), kart ucu (aggregate + satır) ve yaşlandırma
 * ayrı ayrı kuruyor. Geçmişteki "liste bir rakam, ekstre başka rakam" hatalarının
 * hepsi yeni bir bakiye kaynağının bunlardan BİRİNE eklenmesinin unutulmasından
 * doğdu (açılış bakiyesi 2026-09-07, çek yönü 2026-09-08, iade/mahsup
 * 2026-09-16). Cari virman fişi (2026-09-23) altıncı kaynaktır; bu test onun —
 * ve bundan sonra eklenecek her kaynağın — her yere girdiğini ölçer.
 *
 * ── Değişmezler ─────────────────────────────────────────────────────────────
 *  1. Liste bakiyesi = ekstre son bakiyesi (tarih süzgeci yok). Ekstrenin ekseni
 *     borç − alacak olduğu için tedarikçide işaret terstir.
 *  2. Arşiv kapısının "açık bakiye var" cevabı liste bakiyesiyle aynı.
 *  3. Yaşlandırma toplamı (taslaklar dahil) = max(liste bakiyesi, 0). Rapor
 *     yalnız açık (pozitif) pozisyonu yaşlandırır; bakiye eksiyse kalem kalmaz.
 *  4. Tarih itibarıyla bakiye (lib/cari/bakiye-asof.ts — bilançonun kaynağı)
 *     gelecekteki bir tarihte = liste bakiyesi.
 *
 * Kart ucu (`app/api/cari/{customers,suppliers}/[id]`) bakiyesini route içinde
 * kurduğu için burada ÖLÇÜLMÜYOR — bilinen boşluk.
 *
 * ── Veri güvenliği ──────────────────────────────────────────────────────────
 * SALT OKUR: yalnız SELECT çalışır, fixture açmaz. Kapsam `TUTARLILIK_FIRMA`
 * (firma id'si) ile daraltılabilir; tavan `TUTARLILIK_LIMIT` (varsayılan 2000
 * cari). Virman bacağı olan cariler ÖNCE ölçülür. Cariler 8'li gruplar hâlinde
 * paralel ölçülür (havuz sınırı 20); sırayla 500 cari 10 dakikayı aşıyordu.
 */

import { describe, expect, it, afterAll } from "vitest"
import { config } from "dotenv"
import { PrismaClient } from "@prisma/client"
import { fetchCustomerList, fetchSupplierList } from "./list-query"
import { fetchEkstre } from "./ekstre-query"
import { getCustomerDeletability, getSupplierDeletability } from "./archive-guard"
import { CARI_VISIBILITY_ALL } from "./visibility"
import { computeCariAging } from "@/lib/raporlar/cari-yaslandirma"
import { cariBalancesAsOf } from "./bakiye-asof"

config({ path: ".env.local", override: true })
config()

const prisma = new PrismaClient()
afterAll(() => prisma.$disconnect())

const LIMIT = Number(process.env.TUTARLILIK_LIMIT ?? 2000)
const FIRMA = process.env.TUTARLILIK_FIRMA || null
const PARALEL = 8
const kurus = (n: number) => Math.round(n * 100)

type Tur = "müşteri" | "tedarikçi"
type Fark = { firma: string; tur: Tur; cari: string; id: string; liste: number; diger: number }
type Is = { firma: string; companyId: string; tur: Tur; id: string; name: string; balance: number }

describe("cari bakiyesi her ekranda aynı", () => {
  it(
    "liste = ekstre = tarih itibarıyla bakiye, liste ≈ arşiv kapısı, liste ≈ yaşlandırma",
    async () => {
      const companies = await prisma.company.findMany({
        where: FIRMA ? { id: FIRMA } : {},
        select: { id: true, name: true },
        orderBy: { createdAt: "asc" },
      })
      // Virmanı olan cariler önce: yeni kaynağın ölçülmesi tavana takılmasın.
      const virmanli = new Set(
        (
          await prisma.cariVirmanLeg.findMany({
            where: FIRMA ? { companyId: FIRMA } : {},
            select: { customerId: true, supplierId: true },
          })
        ).map((l) => l.customerId ?? l.supplierId),
      )

      const isler: Is[] = []
      // Yaşlandırma FİRMA başına bir kez: cari başına sorulsaydı her seferinde
      // firmanın bütün çek/senet haritası yeniden kurulurdu.
      const yaslandirma = new Map<string, number>()
      const asOf = new Map<string, number>()
      const GELECEK = new Date("2100-01-01T00:00:00Z")
      for (const company of companies) {
        const [ag, bak] = await Promise.all([
          computeCariAging(company.id, { includeDrafts: true }),
          cariBalancesAsOf(company.id, GELECEK),
        ])
        for (const a of [...ag.customers.accounts, ...ag.suppliers.accounts]) yaslandirma.set(a.id, a.totals.total)
        for (const b of [...bak.customers, ...bak.suppliers]) asOf.set(b.id, b.balance)
      }
      for (const company of companies) {
        const [musteriler, tedarikciler] = await Promise.all([
          fetchCustomerList({ companyId: company.id, visibility: CARI_VISIBILITY_ALL }),
          fetchSupplierList({ companyId: company.id, visibility: CARI_VISIBILITY_ALL }),
        ])
        for (const r of musteriler.items)
          isler.push({ firma: company.name, companyId: company.id, tur: "müşteri", id: r.id, name: r.name, balance: r.balance })
        for (const r of tedarikciler.items)
          isler.push({ firma: company.name, companyId: company.id, tur: "tedarikçi", id: r.id, name: r.name, balance: r.balance })
      }
      isler.sort((a, b) => Number(virmanli.has(b.id)) - Number(virmanli.has(a.id)))
      const olculecek = isler.slice(0, LIMIT)
      console.log(`Firma: ${companies.length} · cari: ${isler.length} · ölçülecek: ${olculecek.length} · virmanlı: ${virmanli.size}`)

      const ekstreFarki: Fark[] = []
      const kapiFarki: Fark[] = []
      const yasFarki: Fark[] = []
      const asOfFarki: Fark[] = []
      for (const is of isler) {
        const tarihli = asOf.get(is.id)
        if (tarihli === undefined || kurus(tarihli) !== kurus(is.balance)) {
          asOfFarki.push({ firma: is.firma, tur: is.tur, cari: is.name, id: is.id, liste: is.balance, diger: tarihli ?? NaN })
        }
        const beklenen = Math.max(is.balance, 0)
        const yas = yaslandirma.get(is.id) ?? 0
        if (kurus(yas) !== kurus(beklenen)) {
          yasFarki.push({ firma: is.firma, tur: is.tur, cari: is.name, id: is.id, liste: is.balance, diger: yas })
        }
      }

      const olc = async (is: Is) => {
        const musteri = is.tur === "müşteri"
        const [ekstre, kapi] = await Promise.all([
          fetchEkstre({
            companyId: is.companyId,
            ...(musteri ? { customerId: is.id } : { supplierId: is.id }),
            visibility: CARI_VISIBILITY_ALL,
            withAging: false,
          }),
          musteri ? getCustomerDeletability(is.id) : getSupplierDeletability(is.id),
        ])
        const ekstreKartIsaretinde = musteri ? ekstre.finalBalance : -ekstre.finalBalance
        const satir = { firma: is.firma, tur: is.tur, cari: is.name, id: is.id, liste: is.balance }
        if (kurus(ekstreKartIsaretinde) !== kurus(is.balance)) {
          ekstreFarki.push({ ...satir, diger: ekstreKartIsaretinde })
        }
        if (kapi.hasOpenBalance !== Math.abs(is.balance) >= 0.01) {
          kapiFarki.push({ ...satir, diger: kapi.hasOpenBalance ? 1 : 0 })
        }
      }

      for (let i = 0; i < olculecek.length; i += PARALEL) {
        await Promise.all(olculecek.slice(i, i + PARALEL).map(olc))
        if ((i / PARALEL) % 25 === 0) console.log(`… ${Math.min(i + PARALEL, olculecek.length)}/${olculecek.length}`)
      }

      if (ekstreFarki.length) {
        console.log(`Liste ↔ ekstre farkı: ${ekstreFarki.length} cari (diger = ekstre, kart işaretinde)`)
        console.table(ekstreFarki)
      }
      if (kapiFarki.length) {
        console.log(`Liste ↔ arşiv kapısı farkı: ${kapiFarki.length} cari (diger: 1 = kapı "açık bakiye" diyor)`)
        console.table(kapiFarki)
      }
      if (asOfFarki.length) {
        console.log(`Liste ↔ tarih itibarıyla bakiye farkı: ${asOfFarki.length} cari`)
        console.table(asOfFarki)
      }
      if (yasFarki.length) {
        console.log(`Liste ↔ yaşlandırma farkı: ${yasFarki.length} cari (diger = yaşlandırma toplamı)`)
        console.table(yasFarki)
      }
      expect(olculecek.length).toBeGreaterThan(0)
      expect(ekstreFarki).toEqual([])
      expect(kapiFarki).toEqual([])
      expect(yasFarki).toEqual([])
      expect(asOfFarki).toEqual([])
    },
    1_800_000,
  )
})
