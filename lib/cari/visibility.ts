/**
 * Cari GÖRÜNÜRLÜĞÜ — "yetkili çalışan" kısıtının TEK kaynağı.
 *
 * KURAL (2026-09-08):
 *   ADMIN ve BRANCH_MANAGER (ve süper-admin) firmanın TÜM carilerini görür.
 *   Diğer her üye YALNIZCA `authorizedUserId` kendisi olan carileri görür.
 *   Yetkili çalışanı BOŞ olan cari, kısıtlı üyelerin HİÇBİRİNE görünmez — yalnız
 *   yöneticilere. Yani hiç ataması olmayan bir çalışan hiçbir cari göremez.
 *
 * NEDEN TEK DOSYA: aynı soru sekiz yerde soruluyor (liste, kart, silinebilirlik,
 * ekstre, açık faturalar, iki dışa aktarma, yazma uçları) — üstelik formdaki alan
 * da aynı rol ayrımına bakıyor. Her birinde ayrı yazılsaydı biri gevşediğinde
 * "listede yok ama URL'den açılıyor" boşluğu doğardı. Modül ve sayfa kapılarıyla
 * (lib/module-access.ts, lib/page-access.ts) aynı desen: karar burada, uçlar uygular.
 *
 * KAPSAM cari modülüdür: cari listesi, cari kartı/detayı, ekstre, açık faturalar ve
 * bunların dışa aktarımı. Fatura/sipariş ekranlarındaki müşteri seçicileri ve cari
 * bazlı raporlar BİLEREK kapsam dışı — orası ayrıca kararlaştırılmalı; yarım
 * uygulanmış bir filtre "seçicide yok ama raporun toplamında var" tutarsızlığı üretir.
 *
 * BU DOSYA SAF: oturum ve Prisma istemcisi çekmez, bu yüzden istemci bileşeni
 * (`components/cari/cari-entity-form-page.tsx`) ve `lib/api/errors.ts` de okuyabilir.
 * Oturumdan görünürlük çözmek `lib/cari/resolve-visibility.ts`in işi.
 */

export const CARI_FORBIDDEN_CODE = "CARI_FORBIDDEN"

export const CARI_FORBIDDEN_MESSAGE_TR =
  "Bu cari size atanmamış. Yalnızca yetkili çalışanı siz olan carileri görebilirsiniz; " +
  "atamayı yönetici, cari kartının Diğer sekmesinden yapar."

const CARI_FORBIDDEN_MESSAGE = "Access denied: cari not assigned to user"

/**
 * Görünürlük kapısının hatası.
 *
 * Mesaj bilerek `"Access denied"` ile BAŞLAR: uçların çoğu 403'e maplemeyi bu
 * ifadeye bakarak yapıyor, yani helper'a geçmemiş bir uçta da istek reddedilir.
 * `ModuleLockedError` / `PageForbiddenError` ile aynı sözleşme.
 */
export class CariForbiddenError extends Error {
  readonly code = CARI_FORBIDDEN_CODE

  constructor() {
    super(CARI_FORBIDDEN_MESSAGE)
    this.name = "CariForbiddenError"
  }
}

export function cariForbiddenFrom(error: unknown): CariForbiddenError | null {
  if (error instanceof CariForbiddenError) return error
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : ""
  return message.includes(CARI_FORBIDDEN_MESSAGE) ? new CariForbiddenError() : null
}

/**
 * Tüm carileri gören roller.
 *
 * Özel rol (CUSTOM) bilerek DIŞARIDA: firmanın kendi tanımladığı rol hesap yönetimi
 * yetkisi taşıyamıyor (bkz. `assignablePages`), dolayısıyla "yönetici" sayılamaz.
 * Özel rolde geniş cari erişimi isteniyorsa yol atama yapmaktır.
 */
const FULL_ACCESS_ROLES: readonly string[] = ["ADMIN", "BRANCH_MANAGER"]

export function hasFullCariAccess(role: string | null | undefined): boolean {
  return role != null && FULL_ACCESS_ROLES.includes(role)
}

export type CariVisibility =
  /** Firmanın tüm carileri (yönetici, süper-admin, sistem işleri). */
  | { kind: "all" }
  /** Yalnız `authorizedUserId = userId` olan cariler. */
  | { kind: "own"; userId: string }

export const CARI_VISIBILITY_ALL: CariVisibility = { kind: "all" }

/** Saf karar: rol + kullanıcı → görünürlük. */
export function cariVisibilityFor(
  role: string,
  userId: string,
  isSuperAdmin: boolean,
): CariVisibility {
  if (isSuperAdmin || hasFullCariAccess(role)) return CARI_VISIBILITY_ALL
  return { kind: "own", userId }
}

/** Tek bir cari satırı bu kullanıcıya görünür mü? */
export function isCariVisible(
  cari: { authorizedUserId: string | null },
  visibility: CariVisibility,
): boolean {
  if (visibility.kind === "all") return true
  return cari.authorizedUserId === visibility.userId
}

/** Görünmüyorsa 403 fırlatır. Uçlarda `if` yazmak yerine tek satır. */
export function assertCariVisible(
  cari: { authorizedUserId: string | null },
  visibility: CariVisibility,
): void {
  if (!isCariVisible(cari, visibility)) throw new CariForbiddenError()
}

/** Prisma `where` parçası: cari tablosunun KENDİSİ sorgulanırken. */
export function cariVisibilityWhere(visibility: CariVisibility): { authorizedUserId?: string } {
  return visibility.kind === "all" ? {} : { authorizedUserId: visibility.userId }
}

/**
 * Prisma `where` parçası: cariye BAĞLI kayıt (fatura, işlem, çek, senet)
 * sorgulanırken. Kaydın müşterisi VEYA tedarikçisi bana atanmışsa görünür;
 * carisi olmayan kayıt (ör. cariye bağlanmamış kasa hareketi) kısıtlı kullanıcıya
 * görünmez — "benim carilerimin ekstresi" sorusunun doğru karşılığı budur.
 */
export function cariRelationVisibilityWhere(visibility: CariVisibility): Record<string, unknown> {
  if (visibility.kind === "all") return {}
  return {
    OR: [
      { customer: { authorizedUserId: visibility.userId } },
      { supplier: { authorizedUserId: visibility.userId } },
    ],
  }
}

/**
 * Yazarken `authorizedUserId` ne olmalı?
 *
 * Yöneticide serbest (boş bırakmak "yalnız yöneticiler görsün" demektir). Kısıtlı
 * kullanıcıda HER ZAMAN kendisi:
 *  - yeni kayıtta boş bırakılırsa kart doğar doğmaz listesinden düşerdi,
 *  - düzenlemede başkasına devredebilse ya da boşaltabilse, gördüğü cariyi kendi
 *    eliyle erişilmez yapardı (ve geri alamazdı).
 */
export function resolveAuthorizedUserIdOnWrite(
  requested: string | null,
  visibility: CariVisibility,
): string | null {
  return visibility.kind === "all" ? requested : visibility.userId
}
