/**
 * K-NKT-08 · "Kasada eksi bakiye var — kasa fiziksel olarak eksiye düşemez."
 *
 * ── Neden yalnız KASA (CASH), banka DEĞİL ───────────────────────────────────
 * Bu kartın gücü tek bir gerçeğe dayanıyor: kasadaki nakit para eksiye DÜŞEMEZ.
 * Eksi görünüyorsa kesin bir kayıt hatası vardır — ya bir tahsilat girilmemiş,
 * ya bir ödeme yanlış hesaptan işlenmiştir. Cümle tartışılmaz olduğu için kart
 * da tartışılmaz.
 *
 * Banka hesabı için AYNI ŞEY SÖYLENEMEZ: kredili mevduat, kredi kartı ve
 * teminatlı limit hesapları eksi bakiyeyle çalışır — eksi olması NORMALDİR.
 * ÖLÇÜM (2026-09-07, canlı): eksi bakiyeli 6 hesabın 2'si banka ve biri
 * doğrudan "KREDİ KARTI FAHR." (−24.843 TL). O hesap için "hata var" demek,
 * kartın ilk gün haksız çıkması demekti (kart anatomisi kuralı 5).
 *
 * Panonun eski `negatif-kasa` sinyali (lib/asistan/sinyaller.ts) ikisini birden
 * listeliyor ve başlığında yine "kasa eksiye düşmez" diyor; kart o ayrımı
 * yapıyor, sinyal ayrı bir iş olarak duruyor.
 *
 * ── Kart neden firma başına tek ────────────────────────────────────────────
 * Aksiyon her hesapta AYNI ekrana götürüyor ve karşı taraf yok (bu bir iç kayıt
 * sorunu, aranacak kimse yok). Hesap başına kart üretmek panonun üç kartlık
 * bütçesini tek firmanın kasalarıyla doldururdu — K-NKT-06'daki gibi evraklar
 * kartın içinde tek tek listelenir.
 */

import { prisma } from "@/lib/db/prisma"
import { sayi } from "@/lib/asistan/veri/temel"

/** Kartta adı geçecek hesap sayısı. */
export const ORNEK_HESAP_SAYISI = 3

/** Bu tutarın altındaki eksi bakiye kartı KRİTİK yapmaz. */
export const KRITIK_ESIK = 100_000

export type EksiKasa = {
  ad: string
  bakiye: number
}

export type EksiKasaOzeti = {
  adet: number
  /** En derin eksi bakiye — mutlak değer. */
  enDerin: number
  toplam: number
  ornekler: EksiKasa[]
}

/**
 * Eksi bakiyeli AKTİF kasa hesapları.
 *
 * Para birimi ayrımı yapılmaz: hangi para biriminde olursa olsun fiziksel bir
 * kasanın eksiye düşmesi kayıt hatasıdır. Tutarlar toplanırken karışmasın diye
 * kart toplamı değil, hesapları TEK TEK yazar.
 */
export async function eksiKasaOzeti(companyId: string): Promise<EksiKasaOzeti | null> {
  const hesaplar = await prisma.financialAccount.findMany({
    where: {
      companyId,
      isActive: true,
      type: "CASH",
      balance: { lt: 0 },
    },
    select: { name: true, balance: true },
    orderBy: { balance: "asc" },
  })

  if (hesaplar.length === 0) return null

  const satirlar: EksiKasa[] = hesaplar.map((h) => ({ ad: h.name, bakiye: sayi(h.balance) }))

  return {
    adet: satirlar.length,
    enDerin: Math.abs(satirlar[0].bakiye),
    toplam: satirlar.reduce((t, h) => t + h.bakiye, 0),
    ornekler: satirlar.slice(0, ORNEK_HESAP_SAYISI),
  }
}
