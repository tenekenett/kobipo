// ARŞİV KADEMESİ — kilitlenmiş hesabın saklama süresi dolduktan sonraki hâli.
//
// Neden var: abonelik biten hesap `EXPIRED` olur ve ücretli modülleri kapanır, ama VERİSİ
// olduğu gibi durur. Bu kalıcı olamaz — süresiz büyüyen bir veri yükü ve müşterinin
// unuttuğu bir hesap. Kademe: `EXPIRED` → 30 gün → **arşiv (salt-okunur)**.
//
// Arşiv SİLME DEĞİLDİR ve silmeye giden bir yol da değildir. Fatura/e-fatura/defter
// kayıtları VUK gereği saklanmak zorunda; "ödemedi, sildik" hukuken yapılamaz. Silme
// yalnız kullanıcının açık talebiyle, elle yapılır. Arşivde:
//
//   - OKUMA açık   → müşteri geçmişini görebilir.
//   - DIŞA AKTARMA açık → verisini alıp gidebilmeli; arşivin varlık sebebi bu.
//   - YAZMA kapalı → yeni kayıt/fatura/işlem yok.
//
// Kapı `Company.archivedAt` üzerinden işler ve `disabledModules` ile AYNI desende
// hesabın TÜM üyelerine (şubeler + ek firmalar) yazılır: istek başına ek sorgu
// gerekmesin diye. Sayacın başlangıcı `Subscription.lockedAt`tir, `periodEnd` değil —
// aradan hoşgörü süresi geçtiği için periodEnd'den saymak o günleri iki kez saymak olurdu.

/** `EXPIRED` damgasından arşive kaç gün var. */
export const ARCHIVE_AFTER_DAYS = 30

/** 403 gövdesindeki makine-okunur kod; arayüz "verilerinizi indirin" ekranını buna açar. */
export const ACCOUNT_ARCHIVED_CODE = "ACCOUNT_ARCHIVED"

const ACCOUNT_ARCHIVED_MESSAGE = "Access denied: account archived"

/**
 * Arşiv kapısının fırlattığı hata (bkz. lib/middleware/company.ts → `ensureCompanyWrite`).
 *
 * Mesaj bilerek `"Access denied"` ile BAŞLAR: uçların çoğu 403'e maplemeyi bu ifadeye
 * bakarak yapıyor, dolayısıyla `accessDeniedResponse`e geçmemiş bir uçta da yazma
 * reddedilmeye devam eder — kod eklenmemiş olur, kapı yine kapalıdır.
 */
export class AccountArchivedError extends Error {
  readonly code = ACCOUNT_ARCHIVED_CODE

  constructor() {
    super(ACCOUNT_ARCHIVED_MESSAGE)
    this.name = "AccountArchivedError"
  }
}

/**
 * Yakalanan hatayı arşiv kilidi olarak tanır. `instanceof` yetmez: hata bir `cause`
 * zincirinden ya da Next'in ayrı derlediği bir katmandan başka bir sınıf örneği olarak
 * gelebilir; mesaj biçimi ikinci kanaldır ([[lib/module-access.ts]] ile aynı gerekçe).
 */
export function accountArchivedFrom(error: unknown): AccountArchivedError | null {
  if (error instanceof AccountArchivedError) return error
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : ""
  return message.includes(ACCOUNT_ARCHIVED_MESSAGE) ? new AccountArchivedError() : null
}

/** Kullanıcıya gösterilecek metin — tek yerde, hem 403 gövdesi hem ekran bunu kullanır. */
export const ACCOUNT_ARCHIVED_MESSAGE_TR =
  "Hesabınız arşivde: verileriniz duruyor ve indirilebilir, ancak yeni kayıt yapılamaz. " +
  "Devam etmek için bir abonelik başlatın."

/**
 * `lockedAt` damgasına göre arşiv tarihi. Damga yoksa null — kilitlenmemiş hesabın
 * arşiv sayacı da işlemez.
 */
export function archiveDueAt(lockedAt: Date | null | undefined): Date | null {
  if (!lockedAt) return null
  const due = new Date(lockedAt)
  due.setDate(due.getDate() + ARCHIVE_AFTER_DAYS)
  return due
}

/** Bu hesap şu an arşivlenmeli mi? (`EXPIRED` + `lockedAt` + 30 gün geçmiş) */
export function shouldArchive(
  sub: { status: string; lockedAt: Date | null },
  now: Date = new Date(),
): boolean {
  if (sub.status !== "EXPIRED") return false
  const due = archiveDueAt(sub.lockedAt)
  return due != null && due.getTime() <= now.getTime()
}
