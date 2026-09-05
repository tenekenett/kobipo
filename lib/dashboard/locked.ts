// PANO YERİNE KARŞILAMA EKRANI GÖSTERİLECEK Mİ? — altı rol panosunun ortak kararı.
//
// Kural altı sayfada (dashboard, admin, accountant, sales, stock, viewer) birebir aynı
// kopyalanmıştı; giriş sonrası kullanıcı rolüne göre bunlardan BİRİNE düşüyor, yani
// kontrolün hepsinde durması şart. Kopya olduğu için de hepsi aynı anda yanlışa düştü:
// ölçü değiştiğinde altı yerde birden düzeltmek gerekiyordu. Karar buraya alındı.
//
// İki ayrı sebep var ve KARIŞTIRILMAMALI:
//
//   arşiv  → firmanın verisi salt-okunur arşivde (`Company.archivedAt`). Gösterilecek şey
//            satış değil, "verileriniz duruyor, indirebilirsiniz"dir.
//   kilit  → firmanın hiçbir modülü açık değil, basılacak rakam yok.
//
// Eskiden arşiv ekranı kilidin İÇİNDE yaşıyordu (arşivdeki hesabın ücretli modülleri
// kapalı olduğu için kilit de doğru çıkıyordu). Ölçü "hiç açık modül yok" olunca bu
// bağ koptu: temel modülleri açık olan arşivdeki firma kilitli sayılmaz ve arşiv mesajını
// hiç görmezdi. Bu yüzden arşiv ÖNCE ve BAĞIMSIZ sorulur.

import { isAccountLocked } from "@/lib/modules"

/** `LockedAccount` bileşenine geçilecek özellikler; null = ekran basılmayacak. */
export type LockedScreenProps = {
  companyId: string
  canPurchase: boolean
  isArchived: boolean
}

export function lockedScreenFor(company: {
  /** Linklerde taşınacak firma kimliği (slug varsa o, yoksa id). */
  href: string
  role: string
  disabledModules: string[] | undefined | null
  isArchived: boolean
}): LockedScreenProps | null {
  if (company.isArchived) {
    return { companyId: company.href, canPurchase: company.role === "ADMIN", isArchived: true }
  }
  if (isAccountLocked(company.disabledModules)) {
    return { companyId: company.href, canPurchase: company.role === "ADMIN", isArchived: false }
  }
  return null
}
