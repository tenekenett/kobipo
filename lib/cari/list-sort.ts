/**
 * Cari listesinin SIRALAMASI — saf modül (liste ekranı, uç ve dışa aktarım okur).
 *
 * Bakiye sütun başlığına basınca döngü: ada göre → çoktan aza → azdan çoka →
 * ada göre. İlk tık "çoktan aza"dır: listeye bakanın sorusu çoğunlukla
 * "en çok kimde alacağım / kime borcum var".
 *
 * Sıralama TÜM süzülmüş cariler üzerinde yapılır, sayfa ondan SONRA kesilir
 * (`lib/cari/list-query.ts`). Sayfanın kendi içinde sıralamak "en büyük
 * bakiye"yi yalnız o 50 kayıt içinde bulurdu.
 */

export const CARI_LIST_SORTS = ["name", "balance_desc", "balance_asc"] as const
export type CariListSort = (typeof CARI_LIST_SORTS)[number]

export function parseCariListSort(value: unknown): CariListSort {
  return typeof value === "string" && (CARI_LIST_SORTS as readonly string[]).includes(value)
    ? (value as CariListSort)
    : "name"
}

/** Başlığa her basışta sıradaki sıralama. */
export function nextCariListSort(current: CariListSort): CariListSort {
  if (current === "name") return "balance_desc"
  if (current === "balance_desc") return "balance_asc"
  return "name"
}

/**
 * Bakiye kuruşa yuvarlanarak karşılaştırılır: toplamlar kayan noktayla kurulur,
 * 0,1 + 0,2 gibi artıklar eşit bakiyeli iki cariyi rastgele sıraya sokmasın.
 * Eşitlikte ad (Türkçe) belirler — sayfalar arası sıra kararlı kalsın.
 */
export function sortCariRows<T extends { name: string; balance: number }>(
  rows: T[],
  sort: CariListSort,
): T[] {
  if (sort === "name") return rows
  const dir = sort === "balance_desc" ? -1 : 1
  const kurus = (n: number) => Math.round((Number(n) || 0) * 100)
  return [...rows].sort(
    (a, b) => dir * (kurus(a.balance) - kurus(b.balance)) || a.name.localeCompare(b.name, "tr"),
  )
}
