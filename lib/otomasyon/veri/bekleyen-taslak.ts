/**
 * K-BLG-04 · "N satış faturası taslakta kalmış — bu ciro hiç faturalanmadı."
 *
 * Taslak fatura, YAPILMIŞ ama FATURALANMAMIŞ işin kaydıdır: mal gitmiş, hizmet
 * verilmiş, kayıt açılmış ama belge kesilmemiştir. Cirosu yoktur, tahsilatı
 * yoktur, vadesi işlemez. K-BLG-01'in aynası: o gelen faturayı, bu gideni değil
 * GELİRİ kaçırır.
 *
 * SATIŞ ile sınırlı. Alış tarafındaki eksik zaten K-BLG-01'in konusu; ikisini tek
 * kartta toplamak "ne yapmalıyım" sorusunu iki farklı ekrana bölerdi.
 *
 * DRAFT ve GIB_DRAFT birlikte sayılır: ikisi de KESİLMEMİŞTİR. Ayrım
 * resmileştirme akışının içindedir (DRAFT → GIB_DRAFT → SENT, bkz. GİB taslak
 * akışı) ama kullanıcı açısından sonuç aynı — belge müşteriye gitmemiştir.
 *
 * SATIŞ FİŞİ SAYILMAZ (`isReceipt = false`). Fiş faturanın taslağı değil, AYRI
 * bir belgedir ve ayrı ekranda durur ("Satış Fişleri"); fatura listesi onları
 * `isReceipt: false` ile dışarıda bırakıyor (`lib/faturalar/list-query.ts`).
 * Sayılınca kartın gönderdiği ekranda BULUNAMAYAN belgeler oluşuyordu:
 * 2026-09-06'da kart "167 taslak" derken liste 131 satır gösteriyordu, aradaki
 * 41 belge fişti. Kartın saydığı her belge, aksiyonun açtığı ekranda görünmeli.
 */

import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"
import { sayi, gunOnce } from "@/lib/asistan/veri/temel"

/** Bugün açılan taslak "unutulmuş" değildir. */
export const BEKLEME_GUN = 3

/** Gerekçede adı geçecek örnek belge sayısı. */
export const ORNEK_BELGE_SAYISI = 3

export type BekleyenTaslakSatiri = {
  no: string
  tutar: number
  gun: number
}

export type BekleyenTaslakOzeti = {
  adet: number
  /** Yalnız TRY belgelerin toplamı — gerekçesi K-BLG-01 ile aynı. */
  tutarTL: number
  dovizAdet: number
  enEskiGun: number
  /** En yüksek tutarlı birkaç taslak; kullanıcı nereden başlayacağını görsün. */
  ornekler: BekleyenTaslakSatiri[]
}

export async function bekleyenTaslakOzeti(
  companyId: string
): Promise<BekleyenTaslakOzeti | null> {
  const sinir = gunOnce(BEKLEME_GUN)

  const rows = await prisma.$queryRaw<
    Array<{
      no: string
      tutar: unknown
      tl: boolean
      gun: unknown
    }>
  >(Prisma.sql`
    SELECT "invoiceNo" AS no,
           "totalAmount" AS tutar,
           COALESCE(currency, 'TRY') = 'TRY' AS tl,
           EXTRACT(EPOCH FROM (now() - date)) / 86400 AS gun
    FROM invoices
    WHERE "companyId" = ${companyId}
      AND type = 'SALES'
      AND "isReceipt" = false
      AND status IN ('DRAFT', 'GIB_DRAFT')
      AND date <= ${sinir}
    ORDER BY "totalAmount" DESC
  `)

  if (rows.length === 0) return null

  const tlSatirlar = rows.filter((r) => r.tl)

  return {
    adet: rows.length,
    tutarTL: tlSatirlar.reduce((t, r) => t + sayi(r.tutar), 0),
    dovizAdet: rows.length - tlSatirlar.length,
    enEskiGun: Math.floor(Math.max(...rows.map((r) => sayi(r.gun)))),
    // Sorgu tutara göre sıralı; en büyükler kullanıcının başlangıç noktasıdır.
    ornekler: rows.slice(0, ORNEK_BELGE_SAYISI).map((r) => ({
      no: r.no,
      tutar: sayi(r.tutar),
      gun: Math.floor(sayi(r.gun)),
    })),
  }
}
