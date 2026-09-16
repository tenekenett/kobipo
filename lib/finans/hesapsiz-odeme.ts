// Hesap seçilmeden girilen ödemenin NEREYE yazıldığını ekrana söyleyen not.
//
// Sunucu hesapsız ödemeyi varsayılan Kasa'ya yazar (lib/finans/varsayilan-kasa.ts)
// ve yanıtında bunu `accountDefaulted` ile bildirir. Ekran söylemezse kullanıcı
// parayı "hiçbir hesaba" girmiş sanır ya da kasası olmayan firmada birden
// beliren "Kasa" hesabını tanımaz — sessiz geçilmez.
//
// Saf ve istemcide çalışır: sunucu modülü (prisma) içe aktarılmaz.

/** `/api/faturalar/odemeler` POST yanıtından okunan alanlar. */
export type PaymentAccountResult = {
  accountDefaulted?: boolean
  /** Varsayılan Kasa bu ödemeyle AÇILDI (firmanın hiç kasası yoktu). */
  accountCreated?: boolean
  account?: { name?: string | null } | null
}

/**
 * Bir ya da birden çok ödeme yanıtı (parçalı ödeme) için tek cümlelik not.
 * Hiçbir parça varsayılana düşmediyse `null` — ekran bir şey eklemez.
 */
export function defaultedAccountNote(
  results: ReadonlyArray<PaymentAccountResult | null | undefined>,
): string | null {
  const defaulted = results.filter((r): r is PaymentAccountResult => !!r?.accountDefaulted)
  if (defaulted.length === 0) return null
  // Varsayılana düşen her parça aynı hesaba gider (firmanın en eski aktif kasası).
  const name = defaulted.find((r) => r.account?.name)?.account?.name || "Kasa"
  return defaulted.some((r) => r.accountCreated)
    ? `Hesap seçilmedi: «${name}» hesabı açıldı ve tutar oraya yazıldı`
    : `Hesap seçilmedi: tutar «${name}» hesabına yazıldı`
}

/** Mevcut toast açıklamasının sonuna notu ekler (toast sınırı 1: ayrı toast ötekini ezer). */
export function withAccountNote(description: string, note: string | null): string {
  return note ? `${description}. ${note}` : description
}
