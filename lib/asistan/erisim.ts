/**
 * Asistan erişimi — firma bazlı beyaz liste (`ASISTAN_COMPANIES`).
 * Kural ve gerekçe `lib/deneme/beyaz-liste.ts`te; burası yalnız env adını bağlar.
 */

import { firmaBeyazListede } from "@/lib/deneme/beyaz-liste"

export function asistanAcikMi(
  company: { id?: string | null; slug?: string | null } | null | undefined
): boolean {
  return firmaBeyazListede("ASISTAN_COMPANIES", company)
}
