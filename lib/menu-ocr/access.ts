/**
 * Menü Tarama erişimi — firma bazlı beyaz liste (`MENU_TARAMA_COMPANIES`).
 *
 * Belge taramadan AYRI liste (plan §3.12, karar G): kafe müşterisi ile e-fatura
 * müşterisi aynı küme değil. Kural ve gerekçe `lib/deneme/beyaz-liste.ts`te.
 *
 *   MENU_TARAMA_COMPANIES=kafe-x,cmf3x9k2p0001abcd
 */

import { firmaBeyazListede } from "@/lib/deneme/beyaz-liste"

export function menuTaramaAcikMi(
  company: { id?: string | null; slug?: string | null } | null | undefined
): boolean {
  return firmaBeyazListede("MENU_TARAMA_COMPANIES", company)
}
