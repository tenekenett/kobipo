export const DARK_ROUTE_PREFIXES = [
  "/dashboard",
  "/alis",
  "/ayarlar",
  "/banka",
  "/cari",
  "/cek-senet",
  "/companies",
  "/depolar",
  "/e-donusum",
  "/e-irsaliye",
  "/faturalar",
  "/finans",
  "/kasa",
  "/muhasebe",
  "/personel",
  "/raporlar",
  "/restoran",
  "/satis",
  "/stok",
  "/teklif",
] as const

/**
 * Kullanıcının tema tercihinden BAĞIMSIZ daima koyu olan bölümler.
 *
 * Sistem yönetim paneli sayfaları elle koyu boyanmış (slate-950 zemin, slate-900
 * kartlar) ama tema token'ları açık kalıyordu. Portal'a çıkan parçalar — dialog
 * overlay'i (`bg-background/80`), dropdown, toast, confirm — panelin DOM ağacının
 * dışında (body) render edildiği için panele sınıf eklemek yetmez; karar `html`
 * seviyesinde, yani burada verilmeli. Açık temada overlay beyaz olduğu için koyu
 * panelin üstüne süt gibi bir perde çekiyordu.
 */
export const FORCED_DARK_ROUTE_PREFIXES = ["/system-admin"] as const

function matchesPrefix(pathname: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(prefix + "/"))
}

export function isForcedDarkRoute(pathname: string | null | undefined): boolean {
  if (!pathname) return false
  return matchesPrefix(pathname, FORCED_DARK_ROUTE_PREFIXES)
}

export function isDarkRoute(pathname: string | null | undefined): boolean {
  if (!pathname) return false
  return matchesPrefix(pathname, DARK_ROUTE_PREFIXES)
}
