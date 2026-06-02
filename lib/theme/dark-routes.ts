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
  "/satis",
  "/stok",
  "/teklif",
] as const

export function isDarkRoute(pathname: string | null | undefined): boolean {
  if (!pathname) return false
  return DARK_ROUTE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix + "/"),
  )
}
