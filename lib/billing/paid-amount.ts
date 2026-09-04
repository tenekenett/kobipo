/**
 * ÖDENEN TUTAR = SİPARİŞ TUTARI MI?
 *
 * PayTR bildiriminde gelen `total_amount` bugüne kadar yalnız HASH'e giriyordu: imza
 * `merchant_oid + salt + status + total_amount` üzerinden hesaplandığı için tutarı
 * DEĞİŞTİREN bir istek imzayı bozar ve callback 400 yer. Yani tutar sahteciliğe kapalıydı;
 * kapalı olmayan şey, gelen tutarın SİPARİŞİN tutarıyla aynı olup olmadığıydı — imza
 * "PayTR bunu gönderdi" der, "bu, o siparişin bedelidir" demez.
 *
 * Bu modül o son adımı ekler: karşılaştırma kuruş üzerinden yapılır (`payment_amount`
 * PayTR'a `Math.round(amount * 100)` olarak gidiyor, bkz. orders/[id]/paytr-token).
 *
 * Ölçüt EŞİTLİK DEĞİL, "en az" — bilerek:
 *   - PayTR `total_amount` alanını TAHSİL EDİLEN tutar olarak döner ve taksitte komisyon
 *     eklenince `payment_amount`tan BÜYÜK gelebilir. Paket ödemelerinde taksit kapalı
 *     (`noInstallment: 1`) ama buna bel bağlamak kırılgan olurdu: bir gün taksit açılırsa
 *     eşitlik arayan kontrol ödeyen müşteriyi kilitler.
 *   - Eksik ödeme ise kapıyı kapatmak zorunda: yetkiyi açan tek şey bu bildirimdir.
 *
 * Okunamayan tutar da başarısızdır (fail-closed): "0" ya da boş bir alanla modül açmak,
 * kontrolü hiç koymamaktan farksızdır.
 */

export type PaidAmountCheck =
  | { ok: true; paidKurus: number; expectedKurus: number; overpaid: boolean }
  | { ok: false; reason: "unreadable" | "short"; paidKurus: number | null; expectedKurus: number }

/** TL tutarını kuruşa çevirir — PayTR'a giden `payment_amount` ile AYNI yuvarlama. */
export function toKurus(amount: unknown): number | null {
  // `Number(null)` ve `Number("")` SIFIR döner — sessizce 0 TL'ye çevirmek, doğrulamayı
  // yapmamakla aynı kapıya çıkardı. Bu yüzden boş değerler önce eleniyor.
  if (amount == null) return null
  if (typeof amount === "string" && amount.trim() === "") return null
  const n = Number(amount)
  if (!Number.isFinite(n)) return null
  return Math.round(n * 100)
}

export function checkPaidAmount(params: {
  /** Bildirimdeki `total_amount` (kuruş, string). */
  totalAmount: unknown
  /** Siparişin tahsil edilecek tutarı (TL; Prisma Decimal string olarak da gelebilir). */
  expected: unknown
}): PaidAmountCheck {
  const expectedKurus = toKurus(params.expected)
  // Beklenen tutar okunamıyor ya da pozitif değilse doğrulayacak bir şey yok. Ücretsiz
  // sipariş PayTR'a hiç gitmez (settleFreePackageOrder), yani buraya düşmesi anormaldir.
  if (expectedKurus == null || expectedKurus <= 0) {
    return { ok: false, reason: "unreadable", paidKurus: null, expectedKurus: expectedKurus ?? 0 }
  }

  const raw = String(params.totalAmount ?? "").trim()
  // PayTR kuruşu tam sayı olarak gönderir; yine de "12345.00" gibi bir biçime hazırlıklı ol.
  const paid = raw === "" ? Number.NaN : Number(raw)
  if (!Number.isFinite(paid) || paid <= 0) {
    return { ok: false, reason: "unreadable", paidKurus: null, expectedKurus }
  }
  const paidKurus = Math.round(paid)

  if (paidKurus < expectedKurus) {
    return { ok: false, reason: "short", paidKurus, expectedKurus }
  }
  return { ok: true, paidKurus, expectedKurus, overpaid: paidKurus > expectedKurus }
}
