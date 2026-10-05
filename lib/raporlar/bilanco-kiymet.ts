/**
 * BİLANÇODA ÇEK/SENET PORTFÖYÜ — saf modül (Prisma yok).
 *
 * Çek alındığı gün cariden düşer (`lib/cari/check-credit.ts`), para ise ancak
 * vadesinde tahsil edilince kasaya girer (`lib/cek-senet/tahsil.ts`). Aradaki
 * sürede evrak ne alacaktır ne nakittir: "Alınan çek ve senetler" varlığıdır.
 * Verdiğimiz çek de bankadan ödenene kadar "Verilen çek ve senetler" borcudur.
 * Bu satırlar olmasaydı portföydeki evrak bilançodan düşer, tutarı sessizce
 * "sermaye ve diğer düzeltmeler"e kayardı.
 *
 * Tarih itibarıyla portföyde sayılan evrak:
 *   - düzenleme tarihi (`issueDate`) sınırdan ÖNCE — cari de aynı tarihle düşer
 *     (lib/cari/bakiye-asof.ts), ikisi aynı gün yer değiştirir;
 *   - durumu PORTFÖYDE; ya da TAHSİL_EDİLDİ ama tahsil hareketi (kasadaki
 *     `CEK:`/`SENET:` referanslı işlem) sınırdan SONRA — o tarihte henüz
 *     portföydeydi;
 *   - ya da ALINAN evrak CİRO_EDİLDİ ama ciro günü (`statusChangedAt`, 2026-10-05)
 *     sınırdan SONRA. Verilen evrakın "ciro"su başkasının çekini devretmektir, bizim
 *     borcumuz olmaz: portföye hiç girmez.
 *
 * İADE_EDİLDİ ve PROTESTOLU evrak HİÇ sayılmaz — cari bakiyesi de onu hiç düşürmez
 * (lib/cari/check-credit.ts): evrak hiç alınmamış/verilmemiş gibidir, iki taraf aynı
 * modelde kalır. Ciro tarihi girilmemiş eski evrakta migrasyon son güncelleme gününü
 * yazdı. Tahsil edilmiş ama kasa hareketi olmayan eski kayıt (2026-09-15 öncesi)
 * portföy dışıdır.
 */

import { resolveCekSenetDirection } from "@/lib/cek-senet/labels"

export type KiymetBilancoKaydi = {
  amount: unknown
  status: string
  issueDate: Date | string
  direction: string | null
  supplierId: string | null
  /** Tahsil/ödeme kasa hareketinin tarihi; yoksa null. */
  settledAt: Date | string | null
  /** Durumun değiştiği gün (ciro tarihi); yoksa null. */
  statusChangedAt?: Date | string | null
}

export const PORTFOY_DURUMU = "PORTFÖYDE"
export const TAHSIL_DURUMU = "TAHSİL_EDİLDİ"
export const CIRO_DURUMU = "CİRO_EDİLDİ"

/** Evrak `end` anından hemen önce portföyde miydi? */
export function portfoydeMi(kayit: KiymetBilancoKaydi, end: Date): boolean {
  const verilis = new Date(kayit.issueDate).getTime()
  if (!(verilis < end.getTime())) return false
  if (kayit.status === PORTFOY_DURUMU) return true
  if (kayit.status === TAHSIL_DURUMU) {
    if (!kayit.settledAt) return false
    return new Date(kayit.settledAt).getTime() >= end.getTime()
  }
  if (kayit.status === CIRO_DURUMU && resolveCekSenetDirection(kayit) === "RECEIVED") {
    if (!kayit.statusChangedAt) return false
    return new Date(kayit.statusChangedAt).getTime() >= end.getTime()
  }
  return false
}

/**
 * Tarih itibarıyla portföy sorgusunun durum süzgeci (Prisma `where` parçası): portföyde,
 * tahsil edilmiş ve sınırdan sonra ciro edilmiş evrak. Son ayıklama `portfoydeMi`dedir.
 */
export function portfoyDurumSuzgeci(end: Date) {
  return {
    OR: [
      { status: { in: [PORTFOY_DURUMU, TAHSIL_DURUMU] } },
      { status: CIRO_DURUMU, statusChangedAt: { gte: end } },
    ],
  }
}

/** Portföydeki alınan (varlık) ve verilen (borç) evrak toplamı. */
export function kiymetPortfoyu(
  kayitlar: KiymetBilancoKaydi[],
  end: Date,
): { received: number; given: number } {
  let received = 0
  let given = 0
  for (const k of kayitlar) {
    const tutar = Number(k.amount)
    if (!Number.isFinite(tutar) || tutar <= 0) continue
    if (!portfoydeMi(k, end)) continue
    if (resolveCekSenetDirection(k) === "GIVEN") given += tutar
    else received += tutar
  }
  return { received: Math.round(received * 100) / 100, given: Math.round(given * 100) / 100 }
}
