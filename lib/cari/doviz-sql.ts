import { Prisma } from "@prisma/client"

/**
 * Dövizli faturanın kuru — ham SQL karşılığı (kural: lib/cari/doviz.ts → faturaKuru).
 * `<alias>` fatura tablosunun takma adı; kur yoksa ya da TL ise 1.
 */
export const faturaKuruSql = (alias: string) =>
  Prisma.raw(
    `(CASE WHEN COALESCE(${alias}.currency, 'TRY') <> 'TRY' AND COALESCE(${alias}."exchangeRate", 0) > 0 THEN ${alias}."exchangeRate" ELSE 1 END)`,
  )
