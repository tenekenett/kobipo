/**
 * K-BLG-01 · "N gelen fatura aktarılmadı — gider ve KDV indirimi kayıtlarda yok."
 *
 * Katalogdaki en ucuz kartlardan biri ve doğrudan PARA kaybı: aktarılmayan alış
 * faturası ne gidere ne KDV indirimine girer, beyan döneminde eksik indirim
 * olarak kalır.
 *
 * ── Süzgeçlerin üçü de ölçümden geldi (2026-09-06) ──────────────────────────
 *
 *  1. `status = 'KABUL'`. Veride 48 RED ve 66 YANIT_BEKLENIYOR fatura var;
 *     reddedilmiş faturayı "aktarmadın" diye hatırlatmak yanlış, yanıt bekleyen
 *     de henüz aktarılabilir değil.
 *
 *  2. TUTAR YALNIZ TRY'DEN TOPLANIR. 62 USD + 1 EUR + 1 CAD fatura var; bunları
 *     TL toplamına katmak kurları karıştırıp uydurma bir rakam üretirdi. Döviz
 *     faturalar SAYILIR ama tutara girmez ve kart bunu söyler.
 *
 *  3. PENCERE VAR: `PENCERE_GUN` günden eski fatura hesaba girmez. Veride 1789
 *     gün önceye giden kayıtlar ve ₺24.500.490.000 tutarlı altı çöp fatura
 *     vardı; pencere olmadan kart "₺78 milyar gider kayıtlarda yok" diyordu.
 *     Beş yıllık birikmiş kuyruk zaten bir AKSİYON değil. Pencereyle rakamlar
 *     kendiliğinden makul hâle geldi (Reypo: 461 fatura, ₺3,8M, KDV ₺373K).
 */

import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"
import { sayi, gunOnce } from "@/lib/asistan/veri/temel"

/** Bundan yeni fatura "gecikmiş" sayılmaz — bugün gelen fatura geç değildir. */
export const GECIKME_GUN = 7

/** Bundan eski kuyruk aksiyon değil, arşiv sorunudur; karta girmez. */
export const PENCERE_GUN = 90

export type IslenmemisFaturaOzeti = {
  adet: number
  /** Yalnız TRY faturaların toplamı. */
  tutarTL: number
  kdvTL: number
  /** Tutara katılmayan döviz fatura sayısı. */
  dovizAdet: number
  /** En eski faturanın kaç gün önce geldiği. */
  enEskiGun: number
}

export async function islenmemisFaturaOzeti(
  companyId: string
): Promise<IslenmemisFaturaOzeti | null> {
  // Sınırlar SQL'de değil burada kuruluyor: `make_interval` Prisma'nın bigint
  // parametresini kabul etmiyor, ayrıca gün sınırı kod tabanının her yerinde
  // `gunOnce` ile (İstanbul takvim günü → UTC 00:00) çiziliyor. İkinci bir
  // tarih ekseni açmak, kartın saydığı günle raporun saydığı günü ayırırdı.
  const enYeni = gunOnce(GECIKME_GUN)
  const enEskiSinir = gunOnce(PENCERE_GUN)

  const rows = await prisma.$queryRaw<
    Array<{
      adet: bigint
      tutar: unknown
      kdv: unknown
      doviz: bigint
      en_eski: unknown
    }>
  >(Prisma.sql`
    SELECT COUNT(*)                                                   AS adet,
           COALESCE(SUM("payableAmount") FILTER (WHERE tl), 0)         AS tutar,
           COALESCE(SUM("vatAmount")     FILTER (WHERE tl), 0)         AS kdv,
           COUNT(*) FILTER (WHERE NOT tl)                              AS doviz,
           COALESCE(MAX(EXTRACT(EPOCH FROM (now() - "docDate")) / 86400), 0) AS en_eski
    FROM (
      SELECT "payableAmount", "vatAmount", "docDate",
             COALESCE("currencyCode", 'TRY') = 'TRY' AS tl
      FROM incoming_invoices
      WHERE "companyId" = ${companyId}
        AND "isLinkedToPurchase" = false
        AND "isArchived" = false
        AND status = 'KABUL'
        AND "docDate" IS NOT NULL
        AND "docDate" <= ${enYeni}
        AND "docDate" >= ${enEskiSinir}
    ) f
  `)

  const r = rows[0]
  const adet = Number(r?.adet ?? 0)
  if (adet === 0) return null

  return {
    adet,
    tutarTL: sayi(r.tutar),
    kdvTL: sayi(r.kdv),
    dovizAdet: Number(r.doviz ?? 0),
    enEskiGun: Math.floor(sayi(r.en_eski)),
  }
}
