/**
 * PERSONEL AVANSI — saf kurallar (2026-10-09, muhasebe eksik turu B2).
 *
 * Avans kasa/banka hareketidir (`Transaction.purpose = ADVANCE`, `employeeId` dolu):
 * verilince para çıkar (EXPENSE), geri alınırsa girer (INCOME). Bordrodaki "Avans"
 * alanı aynı avansı maaştan düşer (`PayrollRecord.advance`). Açık avans:
 *
 *   bakiye = verilen − geri alınan − bordrolarda düşülen
 *
 * Muhasebede avans 196 Personel Avansları'na borç yazılır, bordronun avans mahsubu aynı
 * hesaba alacak yazar (lib/muhasebe/para-kurallari.ts) — iki taraf aynı hesapta buluşur.
 * Bugüne kadar avans hiçbir yerde kayda girmiyor, 196 bordrodan dolayı eksiye düşüyordu.
 */

export type AvansSatiri =
  | { tur: "VERILDI" | "GERI_ALINDI"; id: string; tarih: string; tutar: number; aciklama: string | null; hesap: { id: string; ad: string } | null }
  | { tur: "BORDRO"; id: string; tarih: string; tutar: number; aciklama: string | null; donem: { yil: number; ay: number } }

const r2 = (n: number) => Math.round(n * 100) / 100

export function avansBakiyesi(satirlar: Array<Pick<AvansSatiri, "tur" | "tutar">>): number {
  return r2(satirlar.reduce((a, s) => a + (s.tur === "VERILDI" ? s.tutar : -s.tutar), 0))
}

/** Bordro döneminin son günü (00:00 UTC) — mahsup o güne yazılır (bordro fişiyle aynı). */
export function bordroSonGunu(yil: number, ay: number): Date {
  return new Date(Date.UTC(yil, ay, 0))
}

/**
 * Bordro formunun önerisi: açık avans varsa "Avans" alanına yazılabilecek tutar. Bu ayın
 * bordrosu zaten avans düşüyorsa (düzenleme) onun tutarı açık bakiyeye eklenir — aksi
 * hâlde kendi düştüğü avansı "kalmadı" sanardı.
 */
export function bordroAvansOnerisi(acikBakiye: number, buBordroAvansi: number): number {
  return Math.max(0, r2(acikBakiye + buBordroAvansi))
}
