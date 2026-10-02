/**
 * GENEL KAYIT ARAMASI — sorgular. Kurallar (yetki, hedef sayfa, etiket)
 * `kayit-arama-kural.ts`te; uç `app/api/arama`.
 *
 * Arama Türkçe duyarsızdır (`trFoldAnyLike`, bkz. CLAUDE.md "Arama Türkçe
 * duyarsızdır"); belge no gibi ASCII alanlar da aynı katlamadan geçer ki
 * "sat-2026" yazan "SAT-2026-0120"yi bulsun. Her grup firmaya süzülür ve
 * küçük bir tavanla sorgulanır: önce terimle BAŞLAYAN kayıtlar, sonra içeren.
 * Kullanıcının hiç açamayacağı grubun sorgusu hiç çalışmaz.
 */

import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"
import { trFoldAnyLike, trFoldColumn, trLikePattern } from "@/lib/db/tr-search"
import { TR_FOLD_FROM, TR_FOLD_TO, trFold } from "@/lib/text/tr-fold"
import type { PagePermissions } from "@/lib/page-access"
import type { CariVisibility } from "@/lib/cari/visibility"
import { invoiceStatusLabel } from "@/lib/invoice/status-label"
import { cekSenetStatusLabel, resolveCekSenetDirection } from "@/lib/cek-senet/labels"
import {
  GRUPLAR,
  GRUP_BASINA,
  altSatir,
  belgeHedefi,
  gunMetni,
  kayitAcikMi,
  tutarMetni,
  type AramaGrubu,
  type AramaSonucu,
  type KayitTuru,
} from "./kayit-arama-kural"

/**
 * Yetki süzgecinden ÖNCE çekilen aday sayısı. Süzgeç satır satır eler (ör.
 * yalnız alış faturasını gören kullanıcı); tavan GRUP_BASINA olsaydı ilk beşi
 * satış çıkan aramada hiç sonuç kalmazdı.
 */
const ADAY = 25

type Baglam = {
  companyId: string
  perms: PagePermissions
  disabledModules: readonly string[]
  visibility: CariVisibility
  desen: string
  /** Terimle BAŞLAYAN eşleşmeyi öne almak için: `x%`. */
  basDesen: string
  /** Katlanmış terimin kendisi — tam eşleşme (belge no) en üste. */
  tam: string
}

/** Bir ifadenin (sütun birleşimi) katlanmış hâli — `trFoldColumn`ın ifade sürümü. */
const katla = (ifade: Prisma.Sql) => Prisma.sql`lower(translate(btrim(${ifade}), ${TR_FOLD_FROM}, ${TR_FOLD_TO}))`

const acik = (b: Baglam, liste: string, path: string) => kayitAcikMi(b.perms, b.disabledModules, { liste, path })

/**
 * Sıralama: önce terimin TAMAMI, sonra terimle başlayan, sonra içeren.
 * Her karşılaştırma `COALESCE(…, false)`: boş kolon (e-belge no'su olmayan
 * fatura) NULL üretir ve `DESC` sıralama NULL'ı EN ÜSTE koyar — eşleşmeyen
 * belgeler tam eşleşmenin önüne geçiyordu.
 */
const sira = (b: Baglam, kolonlar: string[]) => {
  const herhangi = (kosul: (k: string) => Prisma.Sql) =>
    Prisma.join(kolonlar.map((k) => Prisma.sql`COALESCE(${kosul(k)}, false)`), " OR ")
  return Prisma.sql`(${herhangi((k) => Prisma.sql`${trFoldColumn(k)} = ${b.tam}`)}) DESC,
             (${herhangi((k) => Prisma.sql`${trFoldColumn(k)} LIKE ${b.basDesen}`)}) DESC`
}

const CARI_TABLOLARI = [
  { tablo: "customers", segment: "customers", liste: "/cari/musteri", adi: "Müşteri" },
  { tablo: "suppliers", segment: "suppliers", liste: "/cari/tedarikci", adi: "Tedarikçi" },
] as const

async function cariler(b: Baglam): Promise<AramaSonucu[]> {
  const gorunurluk =
    b.visibility.kind === "all" ? Prisma.empty : Prisma.sql`AND c."authorizedUserId" = ${b.visibility.userId}`
  const parcalar = await Promise.all(
    CARI_TABLOLARI.map(async ({ tablo, segment, liste, adi }) => {
      // Yetki tablo bazında: yalnız tedarikçileri gören müşteri bulmaz.
      if (!acik(b, liste, `/cari/${segment}/x`)) return []
      const rows = await prisma.$queryRaw<
        Array<{ id: string; slug: string; name: string; taxNumber: string | null; phone: string | null; arsiv: boolean }>
      >(Prisma.sql`
        SELECT c.id, c.slug, c.name, c."taxNumber", c.phone, (c."archivedAt" IS NOT NULL) AS arsiv
        FROM ${Prisma.raw(tablo)} c
        WHERE c."companyId" = ${b.companyId}
          AND ${trFoldAnyLike(["c.name", "c.code", 'c."taxNumber"', "c.phone", "c.email"], b.desen)}
          ${gorunurluk}
        ORDER BY (c."archivedAt" IS NOT NULL), ${sira(b, ["c.name", "c.code", 'c."taxNumber"'])}, c.name
        LIMIT ${ADAY}
      `)
      return rows.map(
        (r): AramaSonucu => ({
          tur: "cari",
          id: r.id,
          baslik: r.name,
          alt: altSatir(adi, r.taxNumber && `VKN/TCKN ${r.taxNumber}`, r.phone),
          href: `/cari/${segment}/${r.slug || r.id}`,
          rozet: r.arsiv ? "Arşivde" : undefined,
        }),
      )
    }),
  )
  return parcalar.flat()
}

async function belgeler(b: Baglam): Promise<AramaSonucu[]> {
  // Dört listenin hiçbiri açık değilse sorgu çalışmaz.
  const listeler = ["/satis/fatura", "/alis/fatura", "/satis/fisler", "/alis/fisler"]
  if (!listeler.some((liste) => kayitAcikMi(b.perms, b.disabledModules, { liste, path: liste }))) return []

  const rows = await prisma.$queryRaw<
    Array<{
      id: string
      invoiceNo: string
      eDocumentNo: string | null
      type: string
      returnKind: string | null
      isReceipt: boolean
      status: string
      invoiceType: string | null
      date: Date
      totalAmount: unknown
      currency: string | null
      cari: string | null
    }>
  >(Prisma.sql`
    SELECT i.id, i."invoiceNo", i."eDocumentNo", i.type, i."returnKind", i."isReceipt", i.status,
           i."invoiceType", i.date, i."totalAmount", i.currency, COALESCE(cu.name, su.name) AS cari
    FROM invoices i
    LEFT JOIN customers cu ON cu.id = i."customerId"
    LEFT JOIN suppliers su ON su.id = i."supplierId"
    WHERE i."companyId" = ${b.companyId}
      AND ${trFoldAnyLike(['i."invoiceNo"', 'i."eDocumentNo"'], b.desen)}
    ORDER BY ${sira(b, ['i."invoiceNo"', 'i."eDocumentNo"'])}, i.date DESC
    LIMIT ${ADAY}
  `)

  const sonuc: AramaSonucu[] = []
  for (const r of rows) {
    const hedef = belgeHedefi(r)
    if (!acik(b, hedef.liste, hedef.path)) continue
    const alis = r.type === "PURCHASE"
    sonuc.push({
      tur: "belge",
      id: r.id,
      baslik: r.eDocumentNo && r.eDocumentNo !== r.invoiceNo ? `${r.invoiceNo} · ${r.eDocumentNo}` : r.invoiceNo,
      alt: altSatir(
        hedef.turAdi,
        r.cari,
        gunMetni(r.date),
        tutarMetni(r.totalAmount, r.currency),
        invoiceStatusLabel(r.status, { isPurchase: alis, invoiceType: r.invoiceType }),
      ),
      href: hedef.path,
    })
  }
  return sonuc
}

async function urunler(b: Baglam): Promise<AramaSonucu[]> {
  if (!acik(b, "/stok/urunler", "/stok/x")) return []
  const rows = await prisma.$queryRaw<
    Array<{ id: string; slug: string; name: string; code: string | null; barcode: string | null; isActive: boolean; isService: boolean }>
  >(Prisma.sql`
    SELECT p.id, p.slug, p.name, p.code, p.barcode, p."isActive", p."isService"
    FROM products p
    WHERE p."companyId" = ${b.companyId}
      AND ${trFoldAnyLike(["p.name", "p.code", "p.barcode"], b.desen)}
    ORDER BY p."isActive" DESC, ${sira(b, ["p.name", "p.code", "p.barcode"])}, p.name
    LIMIT ${ADAY}
  `)
  return rows.map((r) => ({
    tur: "urun" as const,
    id: r.id,
    baslik: r.name,
    alt: altSatir(r.isService ? "Hizmet" : "Ürün", r.code && `Kod ${r.code}`, r.barcode && `Barkod ${r.barcode}`),
    href: `/stok/${r.slug || r.id}`,
    rozet: r.isActive ? undefined : "Pasif",
  }))
}

async function teklifler(b: Baglam): Promise<AramaSonucu[]> {
  if (!acik(b, "/teklif", "/teklif/x") && !acik(b, "/alis/teklif", "/teklif/x")) return []
  const rows = await prisma.$queryRaw<
    Array<{ id: string; slug: string; quoteNo: string; supplierId: string | null; date: Date; totalAmount: unknown; currency: string | null; cari: string | null }>
  >(Prisma.sql`
    SELECT q.id, q.slug, q."quoteNo", q."supplierId", q.date, q."totalAmount", q.currency,
           COALESCE(cu.name, su.name) AS cari
    FROM quotes q
    LEFT JOIN customers cu ON cu.id = q."customerId"
    LEFT JOIN suppliers su ON su.id = q."supplierId"
    WHERE q."companyId" = ${b.companyId}
      AND ${trFoldAnyLike(['q."quoteNo"'], b.desen)}
    ORDER BY ${sira(b, ['q."quoteNo"'])}, q.date DESC
    LIMIT ${ADAY}
  `)
  const sonuc: AramaSonucu[] = []
  for (const r of rows) {
    // Tedarikçili teklif satın alma teklifidir: listesi ayrı, detayı ortak.
    const alis = Boolean(r.supplierId)
    const path = `/teklif/${r.slug || r.id}`
    if (!acik(b, alis ? "/alis/teklif" : "/teklif", path)) continue
    sonuc.push({
      tur: "teklif",
      id: r.id,
      baslik: r.quoteNo,
      alt: altSatir(alis ? "Satın alma teklifi" : "Teklif", r.cari, gunMetni(r.date), tutarMetni(r.totalAmount, r.currency)),
      href: path,
    })
  }
  return sonuc
}

const KIYMET_TABLOLARI = [
  { tablo: "checks", no: "checkNo", segment: "cek", adi: "Çek" },
  { tablo: "promissory_notes", no: "noteNo", segment: "senet", adi: "Senet" },
] as const

async function cekSenetler(b: Baglam): Promise<AramaSonucu[]> {
  const parcalar = await Promise.all(
    KIYMET_TABLOLARI.map(async ({ tablo, no, segment, adi }) => {
      if (!acik(b, `/cek-senet/${segment}`, `/cek-senet/${segment}/x`)) return []
      const noKolonu = `k."${no}"`
      const rows = await prisma.$queryRaw<
        Array<{ id: string; no: string; amount: unknown; dueDate: Date; status: string; direction: string | null; supplierId: string | null; cari: string | null }>
      >(Prisma.sql`
        SELECT k.id, ${Prisma.raw(noKolonu)} AS no, k.amount, k."dueDate", k.status, k.direction, k."supplierId",
               COALESCE(cu.name, su.name) AS cari
        FROM ${Prisma.raw(tablo)} k
        LEFT JOIN customers cu ON cu.id = k."customerId"
        LEFT JOIN suppliers su ON su.id = k."supplierId"
        WHERE k."companyId" = ${b.companyId}
          AND ${trFoldAnyLike([noKolonu], b.desen)}
        ORDER BY ${sira(b, [noKolonu])}, k."dueDate" DESC
        LIMIT ${ADAY}
      `)
      const kucuk = adi.toLocaleLowerCase("tr")
      return rows.map(
        (r): AramaSonucu => ({
          tur: "cek-senet",
          id: r.id,
          baslik: `${adi} ${r.no}`,
          alt: altSatir(
            resolveCekSenetDirection(r) === "GIVEN" ? `Verilen ${kucuk}` : `Alınan ${kucuk}`,
            r.cari,
            `vade ${gunMetni(r.dueDate)}`,
            tutarMetni(r.amount),
            cekSenetStatusLabel(r.status),
          ),
          href: `/cek-senet/${segment}/${r.id}`,
        }),
      )
    }),
  )
  return parcalar.flat()
}

async function personeller(b: Baglam): Promise<AramaSonucu[]> {
  if (!acik(b, "/personel", "/personel/x")) return []
  const tamAd = katla(Prisma.sql`e."firstName" || ' ' || e."lastName"`)
  const rows = await prisma.$queryRaw<
    Array<{ id: string; slug: string; firstName: string; lastName: string; phone: string | null; email: string | null; status: string }>
  >(Prisma.sql`
    SELECT e.id, e.slug, e."firstName", e."lastName", e.phone, e.email, e.status
    FROM employees e
    WHERE e."companyId" = ${b.companyId}
      AND (${tamAd} LIKE ${b.desen} OR ${trFoldAnyLike(["e.phone", "e.email"], b.desen)})
    ORDER BY (e.status = 'TERMINATED'), (${tamAd} LIKE ${b.basDesen}) DESC, e."firstName", e."lastName"
    LIMIT ${ADAY}
  `)
  return rows.map((r) => ({
    tur: "personel" as const,
    id: r.id,
    baslik: `${r.firstName} ${r.lastName}`.trim(),
    alt: altSatir("Personel", r.phone, r.email),
    href: `/personel/${r.slug || r.id}`,
    rozet: r.status === "TERMINATED" ? "Ayrıldı" : r.status === "ON_LEAVE" ? "İzinde" : undefined,
  }))
}

const ARAYICILAR: Record<KayitTuru, (b: Baglam) => Promise<AramaSonucu[]>> = {
  cari: cariler,
  belge: belgeler,
  urun: urunler,
  teklif: teklifler,
  "cek-senet": cekSenetler,
  personel: personeller,
}

/** Terim `aramaTerimi`nden geçmiş olmalı. Boş gruplar dönmez. */
export async function kayitAra(args: {
  companyId: string
  terim: string
  perms: PagePermissions
  disabledModules: readonly string[]
  visibility: CariVisibility
}): Promise<AramaGrubu[]> {
  const desen = trLikePattern(args.terim)
  if (!desen) return []
  const baglam: Baglam = { ...args, desen, basDesen: desen.slice(1), tam: trFold(args.terim) }

  const sonuclar = await Promise.all(GRUPLAR.map((g) => ARAYICILAR[g.tur](baglam)))
  return GRUPLAR.map((g, i) => ({ ...g, sonuclar: sonuclar[i].slice(0, GRUP_BASINA) })).filter(
    (g) => g.sonuclar.length > 0,
  )
}
