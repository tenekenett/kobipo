/**
 * Fiş/Belge Tarama erişimi — firma bazlı beyaz liste (`FIS_TARAMA_COMPANIES`).
 * Kural ve gerekçe `lib/deneme/beyaz-liste.ts`te; burası yalnız env adını bağlar.
 */

import { firmaBeyazListede } from "@/lib/deneme/beyaz-liste"

export function fisTaramaAcikMi(
  company: { id?: string | null; slug?: string | null } | null | undefined
): boolean {
  return firmaBeyazListede("FIS_TARAMA_COMPANIES", company)
}
