/**
 * Dışa aktarmanın tek veri modeli.
 *
 * Excel, PDF ve CSV üreticilerinin üçü de SADECE bu tipleri okur. Bir ekrana
 * kolon eklemek için tek yer değişir (ilgili `datasets/*.ts`), üç format birden
 * güncellenir. Daha önce her ekran kendi XLSX kodunu yazıyordu ve aralarında
 * sessiz farklar oluşuyordu (bkz. cari/ekstre'deki tek seferlik export).
 */

export type ExportFormat = "xlsx" | "pdf" | "csv"

export const EXPORT_FORMATS: ExportFormat[] = ["xlsx", "pdf", "csv"]

export function isExportFormat(value: unknown): value is ExportFormat {
  return typeof value === "string" && (EXPORT_FORMATS as string[]).includes(value)
}

/**
 * Kolon tipi biçimlendirmeyi DEĞİL, anlamı belirtir. Her üretici kendi
 * gösterimini seçer: Excel gerçek sayı/tarih hücresi yazar (toplam alınabilsin),
 * PDF ve CSV metne çevirir.
 */
export type ExportColumnType =
  | "text"
  | "number"
  | "money"
  | "qty"
  | "percent"
  | "date"
  | "datetime"
  | "boolean"

export type ExportColumn = {
  /** Satır nesnesindeki alan adı. */
  key: string
  label: string
  type?: ExportColumnType
  align?: "left" | "center" | "right"
  /** PDF kolon genişliği (mm). Verilmezse autoTable dağıtır. */
  width?: number
  /**
   * Toplam satırında bu kolon toplansın mı. `totals` elle verilmediyse
   * bu işaretli kolonlar otomatik toplanır.
   */
  total?: boolean
}

export type ExportRow = Record<string, unknown>

/**
 * Bir tablo bloğu. Çok bölümlü belgeler (kar/zarar'ın gelir + gider blokları,
 * yaşlandırmanın müşteri + tedarikçi blokları) için birden fazla section olur;
 * Excel'de her section ayrı sayfa, PDF'te art arda tablo olur.
 */
export type ExportSection = {
  title?: string
  columns: ExportColumn[]
  rows: ExportRow[]
  /**
   * Toplam satırı. `null` → toplam yok. Verilmezse `total: true` kolonlardan
   * otomatik hesaplanır.
   */
  totals?: ExportRow | null
  /** Excel sayfa adı; verilmezse `title`den türetilir. */
  sheetName?: string
}

export type ExportCompany = {
  name: string
  taxNumber?: string | null
  taxOffice?: string | null
  address?: string | null
  city?: string | null
  phone?: string | null
}

export type ExportDataset = {
  /** Belge başlığı ve dosya adının gövdesi. Ör. "Ürün Listesi". */
  title: string
  company: ExportCompany
  /**
   * Uygulanan filtrelerin okunur özeti — PDF alt başlığında ve Excel meta
   * satırında görünür. Kullanıcı indirdiği dosyanın hangi filtreyle üretildiğini
   * altı ay sonra da görebilmeli.
   */
  filters?: string[]
  sections: ExportSection[]
  generatedAt?: Date
  /** Verilmezse kolon sayısına göre seçilir (>6 kolon → landscape). */
  orientation?: "portrait" | "landscape"
  /** Satır limiti aşıldığında gösterilecek uyarı. */
  note?: string | null
}
