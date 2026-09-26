/**
 * KOBİPO FATURA ŞABLONU — kolonlar ve satır ayrıştırma (veritabanısız).
 *
 * Alış ve Satış Faturaları ekranlarının "İşlem Yap" menüsündeki iki iş AYNI şablonu
 * konuşur:
 *
 *   Kobipo Şablonu ile Dışarı Aktar → lib/export/datasets/fatura-sablon.ts yazar
 *   İçeri Aktar                     → bu dosya okur, lib/faturalar/fatura-ice-aktar.ts yazar
 *
 * Kolon listesi tek yerde (`sablonKolonlari`) durur ki dışa aktarılan dosya
 * düzeltilip hiçbir sütun elle değiştirilmeden geri yüklenebilsin. İki ayrı liste
 * tutulsaydı dışa aktarım "Birim Fiyat" yazarken içe aktarım "Fiyat" beklediğinde
 * dosyanın her satırı "Birim Fiyat boş" hatasına düşerdi.
 *
 * ÜÇ TÜR, İKİ ŞABLON:
 *   alis    → karşı taraf TEDARİKÇİ; Fatura No tedarikçi bazında tekil.
 *   satis   → karşı taraf MÜŞTERİ; Fatura No firma içinde tekil; istisna kodu ve ülke sütunu var.
 *   ihracat → satış şablonunun AYNISI, kuralı farklı: KDV %0 zorunlu, istisna kodu
 *             boşsa 301 (11/1-a mal ihracatı), müşterinin vergi numarası yabancı olabilir.
 * Karşı taraf sütunlarının ADI türe göre değişir ve takma adlar türe özgüdür: alış
 * şablonu ("Tedarikçi") satış içe aktarımına verilirse zorunlu "Müşteri" sütunu eksik
 * diye reddedilir — alış faturası sessizce satış olarak açılmaz.
 *
 * Şablon SATIR BAZLIDIR: her satır bir fatura kalemidir. İkinci ve sonraki satırlarda
 * fatura bilgileri (No, cari, VKN) BOŞ bırakılırsa satır bir önceki faturanın kalemi
 * sayılır — elle hazırlanan dosyada her satıra başlığı kopyalamak gerekmez.
 *
 * Kapsam bilinçle dardır: tevkifat, ÖTV, diğer vergi ve GEKAP şablonda TAŞINMAZ
 * (tevkifatın GİB kodu Mysoft listesinden seçilir, dosyadan tahmin edilmez). Bu
 * vergileri içeren bir fatura dışa aktarılabilir ama "Genel Toplam" sütunu dosyada
 * durduğu için geri yüklemede hesaplanan toplam tutmaz ve fatura HATAYLA reddedilir
 * — sessizce vergisiz bir kopya açılmaz.
 */

import {
  computeInvoiceTotals,
  documentColumnPrecision,
  resolveLineDiscount,
} from "@/lib/invoice/document-totals"
import { normalizeHeader, parseAmountCell } from "@/lib/import/rows"
import { normalizeManualInvoiceNo } from "@/lib/utils/invoice-number-format"
import { trFold } from "@/lib/text/tr-fold"

export type SablonTuru = "alis" | "satis" | "ihracat"

export type SablonAlan =
  | "invoiceNo"
  | "date"
  | "dueDate"
  | "counterpartyName"
  | "counterpartyTaxNumber"
  | "country"
  | "currency"
  | "exchangeRate"
  | "category"
  | "notes"
  | "globalDiscount"
  | "productCode"
  | "description"
  | "quantity"
  | "unit"
  | "unitPrice"
  | "discountRate"
  | "discountAmount"
  | "vatRate"
  | "exemptionCode"
  | "lineNet"
  | "lineVat"
  | "expectedTotal"
  | "ettn"

export type SablonKolonu = {
  key: SablonAlan
  /** Dosyadaki başlık — dışa aktarım bunu yazar. */
  label: string
  /** İçe aktarımda da tanınan başlıklar (normalizeHeader biçiminde). */
  aliases: string[]
  /** fatura = aynı faturanın her satırında aynı; kalem = satıra özgü; bilgi = içe aktarımda yazılmaz */
  level: "fatura" | "kalem" | "bilgi"
  required?: boolean
  /** Boş şablonun açıklama sayfasında yazar. */
  hint: string
}

/** Karşı tarafın adı: alışta tedarikçi, satış/ihracatta müşteri. */
export function cariEtiketi(tur: SablonTuru): "Tedarikçi" | "Müşteri" {
  return tur === "alis" ? "Tedarikçi" : "Müşteri"
}

/** Bilinen KDV istisna kodlarının belgeye yazılan gerekçesi. */
export const ISTISNA_GEREKCELERI: Record<string, string> = {
  "301": "11/1-a Mal ihracatı",
  "302": "11/1-b Hizmet ihracatı",
  "350": "Diğer İstisnalar",
  "351": "KDV - İstisna Olmayan Diğer",
}

/** İhracat faturasında istisna kodu boşsa kullanılan kod — mal ihracatı. */
export const IHRACAT_VARSAYILAN_ISTISNA = "301"

export function sablonKolonlari(tur: SablonTuru): SablonKolonu[] {
  const cari = cariEtiketi(tur)
  const alis = tur === "alis"
  const cols: Array<SablonKolonu | null> = [
    {
      key: "invoiceNo",
      label: "Fatura No",
      aliases: ["faturano", "faturanumarasi", "belgeno", "invoiceno"],
      level: "fatura",
      required: true,
      hint: alis
        ? "Tedarikçinin fatura numarası. Aynı tedarikçide tekildir."
        : "Faturanın numarası (ör. GİB belge numarası). Firma içinde tekildir.",
    },
    {
      key: "date",
      label: "Fatura Tarihi",
      aliases: ["faturatarihi", "tarih", "belgetarihi", "date"],
      level: "fatura",
      required: true,
      hint: "GG.AA.YYYY (ör. 26.09.2026) ya da Excel tarih hücresi.",
    },
    {
      key: "dueDate",
      label: "Vade Tarihi",
      aliases: ["vadetarihi", "vade", "duedate"],
      level: "fatura",
      hint: `Boşsa ${cari.toLocaleLowerCase("tr-TR")} kartındaki ödeme vadesinden önerilir; kartta vade yoksa boş kalır.`,
    },
    {
      key: "counterpartyName",
      label: cari,
      aliases: alis
        ? ["tedarikci", "tedarikciunvani", "tedarikciadi", "satici", "unvan", "cariunvani", "cari", "firma"]
        : ["musteri", "musteriunvani", "musteriadi", "alici", "aliciunvani", "unvan", "cariunvani", "cari", "firma"],
      level: "fatura",
      required: true,
      hint: `Ünvan. Kayıtlı değilse yeni ${cari.toLocaleLowerCase("tr-TR")} kartı açılır.`,
    },
    {
      key: "counterpartyTaxNumber",
      label: alis ? "Tedarikçi VKN/TCKN" : "Müşteri VKN/TCKN",
      aliases: alis
        ? ["tedarikcivkntckn", "tedarikcivkn", "vkntckn", "vkn", "tckn", "vergino", "verginumarasi"]
        : ["musterivkntckn", "musterivkn", "alicivkn", "vkntckn", "vkn", "tckn", "vergino", "verginumarasi"],
      level: "fatura",
      hint:
        tur === "ihracat"
          ? "Yabancı alıcının vergi numarası (harf içerebilir); boş bırakılabilir. Doluysa müşteri önce bununla eşleşir."
          : "10 haneli VKN ya da 11 haneli TCKN. Doluysa cari önce bununla eşleşir.",
    },
    alis
      ? null
      : {
          key: "country",
          label: "Ülke",
          aliases: ["ulke", "aliciulke", "musteriulke", "country"],
          level: "fatura",
          hint: "Yalnız YENİ müşteri kartı açılırken yazılır (ihracatta zorunlu). Kayıtlı kartın ülkesi değiştirilmez.",
        },
    {
      key: "currency",
      label: "Para Birimi",
      aliases: ["parabirimi", "doviz", "dovizcinsi", "currency"],
      level: "fatura",
      hint: "Boşsa TRY. Döviz faturasında Döviz Kuru zorunludur.",
    },
    {
      key: "exchangeRate",
      label: "Döviz Kuru",
      aliases: ["dovizkuru", "kur", "exchangerate"],
      level: "fatura",
      hint: "Yalnız TRY dışı para biriminde.",
    },
    {
      key: "category",
      label: "Kategori",
      aliases: ["kategori", alis ? "giderkategorisi" : "gelirkategorisi", "category"],
      level: "fatura",
      hint: "İsteğe bağlı sınıflandırma.",
    },
    {
      key: "notes",
      label: "Fatura Açıklaması",
      aliases: ["faturaaciklamasi", "faturanotu", "notlar", "notes"],
      level: "fatura",
      hint: "Faturanın notu.",
    },
    {
      key: "globalDiscount",
      label: "Fatura Altı İskonto",
      aliases: ["faturaaltiiskonto", "geneliskonto", "faturaaltiiskontotutari"],
      level: "fatura",
      hint: "Tutar (KDV hariç). Satır iskontolarından sonra matrahtan düşülür.",
    },
    {
      key: "productCode",
      label: "Ürün/Hizmet Kodu",
      aliases: ["urunhizmetkodu", "urunkodu", "stokkodu", "hizmetkodu", "kod"],
      level: "kalem",
      hint: alis
        ? "Stok kartının kodu. Doluysa kalem ürüne bağlanır ve stok GİRİŞİ yapılır; bulunamazsa satır hata verir."
        : "Stok kartının kodu. Doluysa kalem ürüne bağlanır ve stoktan DÜŞÜLÜR; bulunamazsa satır hata verir.",
    },
    {
      key: "description",
      label: "Ürün/Hizmet Adı",
      aliases: ["urunhizmetadi", "urunadi", "hizmetadi", "malhizmet", "kalem", "kalemaciklamasi", "aciklama"],
      level: "kalem",
      required: true,
      hint: "Kalem adı. Ürün kodu verildiyse boş bırakılabilir (kartın adı kullanılır).",
    },
    {
      key: "quantity",
      label: "Miktar",
      aliases: ["miktar", "adet", "quantity"],
      level: "kalem",
      required: true,
      hint: "Sıfırdan büyük sayı.",
    },
    {
      key: "unit",
      label: "Birim",
      aliases: ["birim", "olcubirimi", "unit"],
      level: "kalem",
      hint: "Boşsa ürün kartının birimi, o da yoksa ADET.",
    },
    {
      key: "unitPrice",
      label: "Birim Fiyat",
      aliases: ["birimfiyat", "birimfiyatkdvharic", "fiyat", "unitprice"],
      level: "kalem",
      required: true,
      hint: "KDV hariç birim fiyat.",
    },
    {
      key: "discountRate",
      label: "İskonto %",
      aliases: ["iskonto", "iskontoorani", "iskontoyuzde", "discountrate"],
      level: "kalem",
      hint: "0–100. Doluysa İskonto Tutarı yok sayılır.",
    },
    {
      key: "discountAmount",
      label: "İskonto Tutarı",
      aliases: ["iskontotutari", "discountamount"],
      level: "kalem",
      hint: "Satır iskontosu tutar olarak (İskonto % boşsa kullanılır).",
    },
    {
      key: "vatRate",
      label: "KDV %",
      aliases: ["kdv", "kdvorani", "kdvyuzde", "vatrate"],
      level: "kalem",
      // İhracatta boş hücre %0 demektir (başka oran olamaz); satış ve alışta zorunlu.
      required: tur !== "ihracat",
      hint: tur === "ihracat" ? "İhracatta 0 olmalı (boş bırakılabilir)." : "0, 1, 10, 20 gibi oran.",
    },
    alis
      ? null
      : {
          key: "exemptionCode",
          label: "KDV İstisna Kodu",
          aliases: ["kdvistisnakodu", "istisnakodu", "muafiyetkodu", "taxexemptionreasoncode"],
          level: "kalem",
          hint:
            tur === "ihracat"
              ? "Boşsa 301 (11/1-a mal ihracatı). Hizmet ihracatında 302."
              : "Yalnız %0 KDV'li kalemde (ör. 351). İsteğe bağlı.",
        },
    {
      key: "lineNet",
      label: "Satır Tutarı (KDV Hariç)",
      aliases: ["satirtutarikdvharic", "satirtutari", "tutar"],
      level: "bilgi",
      hint: "Bilgi amaçlıdır; içe aktarımda Kobipo yeniden hesaplar.",
    },
    {
      key: "lineVat",
      label: "Satır KDV",
      aliases: ["satirkdv", "kdvtutari"],
      level: "bilgi",
      hint: "Bilgi amaçlıdır; içe aktarımda Kobipo yeniden hesaplar.",
    },
    {
      key: "expectedTotal",
      label: "Genel Toplam",
      aliases: ["geneltoplam", "faturatoplami", "odenecektutar", "toplamtutar"],
      level: "fatura",
      hint: "Doluysa KONTROL içindir: Kobipo'nun hesapladığı toplam 1 kuruştan fazla farklıysa fatura aktarılmaz.",
    },
    {
      key: "ettn",
      label: "ETTN",
      aliases: ["ettn", "uuid"],
      level: "bilgi",
      hint: alis
        ? "Bilgi amaçlıdır (gelen e-faturadan dönüştürülen faturada)."
        : "Bilgi amaçlıdır (GİB'e gönderilmiş e-Fatura/e-Arşiv'de).",
    },
  ]
  return cols.filter((c): c is SablonKolonu => c !== null)
}

/** Dosya başına üst sınırlar — bir istek içinde işlenebilecek hacim. */
export const SABLON_MAX_ROWS = 5000
export const SABLON_MAX_INVOICES = 300

export type SablonKalemi = {
  row: number
  productCode: string
  description: string
  quantity: number
  unit: string
  unitPrice: number
  discountMode: "PERCENT" | "AMOUNT"
  discountRate: number
  discountAmount: number
  vatRate: number
  /** KDV istisna kodu (satış/ihracat); alışta hep boş. */
  exemptionCode: string
}

export type SablonFaturasi = {
  /** Gruplama anahtarı: katlanmış Fatura No (+ alışta VKN ya da katlanmış ünvan). */
  key: string
  /** Excel satır numaraları (başlık 1. satır). */
  rows: number[]
  invoiceNo: string
  /** YYYY-MM-DD */
  date: string | null
  dueDate: string | null
  counterpartyName: string
  /** Eşleştirme biçiminde: büyük harf, yalnız harf/rakam. */
  counterpartyTaxNumber: string
  country: string
  currency: string
  exchangeRate: number | null
  category: string
  notes: string
  globalDiscount: number
  expectedTotal: number | null
  lines: SablonKalemi[]
  errors: string[]
}

export type SablonAyrisimi = {
  /** Zorunlu olup dosyada bulunmayan başlıklar — varsa hiçbir satır okunmaz. */
  missingColumns: string[]
  /** Dosyada tanınmayan (yok sayılan) başlıklar — kullanıcıya gösterilir. */
  unknownColumns: string[]
  invoices: SablonFaturasi[]
  /** Dosya düzeyinde hata (sınır aşımı, boş dosya). */
  fileError: string | null
}

/* ------------------------------------------------------------------ *
 * Hücre okuma
 * ------------------------------------------------------------------ */

/** SheetJS `raw: true` ile okunan hücre: metin, sayı, boolean ya da boş. */
type Cell = unknown

function cellText(value: Cell): string {
  if (value === null || value === undefined) return ""
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : ""
  return String(value).trim()
}

/**
 * Vergi numarasının EŞLEŞTİRME biçimi: büyük harf, yalnız harf ve rakam. Türk
 * VKN/TCKN'de rakamlar kalır ("123 456 7890" → "1234567890"); yabancı alıcının
 * numarası harf içerebildiği için harfler atılmaz (ihracat). Veritabanındaki kayıt
 * da aynı fonksiyondan geçirilerek karşılaştırılır.
 */
export function canonicalTaxNumber(value: string | null | undefined): string {
  return String(value ?? "")
    .toLocaleUpperCase("tr-TR")
    .replace(/[^A-Z0-9]/g, "")
}

const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30)

function isoFromParts(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1 || day > 31) return null
  // Takvimde olmayan gün (31.02) Date.UTC'de taşar; geri okuyup eşitliği sınarız.
  const probe = new Date(Date.UTC(year, month - 1, day))
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    return null
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

/**
 * Tarih hücresi → YYYY-MM-DD. Excel tarih hücresi SERİ NUMARASI olarak gelir
 * (raw okuma); gün UTC aritmetiğiyle çözülür — sunucunun saat dilimi günü
 * kaydıramaz. Metin hücrede GG.AA.YYYY (ayraç . / -) ve YYYY-AA-GG tanınır;
 * AA/GG/YYYY (ABD) tanınmaz: 03.04 hem 3 Nisan hem 4 Mart okunabilirdi.
 *
 * Dönüş: `undefined` = hücre boş, `null` = okunamadı.
 */
export function parseSablonDate(value: Cell): string | null | undefined {
  if (value === null || value === undefined || value === "") return undefined
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 1 || value > 2958465) return null
    const d = new Date(EXCEL_EPOCH_UTC + Math.floor(value) * 86_400_000)
    return isoFromParts(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())
  }
  const text = cellText(value)
  if (!text) return undefined
  let m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})(?:\s.*)?$/.exec(text)
  if (m) return isoFromParts(Number(m[3]), Number(m[2]), Number(m[1]))
  m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/.exec(text)
  if (m) return isoFromParts(Number(m[1]), Number(m[2]), Number(m[3]))
  return null
}

/** Sayı hücresi. `undefined` = boş; okunamazsa HATA fırlatır (sessizce 0 olmaz). */
function parseNumberCell(value: Cell, label: string): number | undefined {
  if (value === null || value === undefined || value === "") return undefined
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`"${label}" sütunu sayı değil`)
    return value
  }
  return parseAmountCell(String(value), label)
}

function normalizeCurrency(raw: string): string {
  const up = raw.trim().toLocaleUpperCase("tr-TR")
  if (!up || up === "TL" || up === "₺" || up === "TRL") return "TRY"
  return up
}

/* ------------------------------------------------------------------ *
 * Ayrıştırma
 * ------------------------------------------------------------------ */

type RowValues = Partial<Record<SablonAlan, Cell>>

function mapHeaders(
  headerRow: Cell[],
  columns: SablonKolonu[],
): { indexOf: Map<SablonAlan, number>; unknown: string[] } {
  const indexOf = new Map<SablonAlan, number>()
  const unknown: string[] = []
  headerRow.forEach((raw, index) => {
    const label = cellText(raw)
    if (!label) return
    const normalized = normalizeHeader(label)
    const column = columns.find(
      (col) => normalizeHeader(col.label) === normalized || col.aliases.includes(normalized),
    )
    // Aynı alana ikinci sütun düşerse ilki kazanır; ikincisi tanınmayan sayılır ki
    // kullanıcı hangi sütunun okunmadığını görsün.
    if (column && !indexOf.has(column.key)) indexOf.set(column.key, index)
    else unknown.push(label)
  })
  return { indexOf, unknown }
}

function readRow(row: Cell[], indexOf: Map<SablonAlan, number>): RowValues {
  const values: RowValues = {}
  for (const [key, index] of indexOf) values[key] = row[index]
  return values
}

function isBlankRow(values: RowValues): boolean {
  return Object.values(values).every((v) => cellText(v) === "")
}

const HEADER_IDENTITY: SablonAlan[] = ["invoiceNo", "counterpartyName", "counterpartyTaxNumber"]

/**
 * Gruplama anahtarı veritabanının tekillik kuralını izler: alışta numara TEDARİKÇİ
 * bazında tekil (iki tedarikçi aynı numarayı üretebilir), satışta FİRMA içinde.
 * Satışta aynı numaralı iki satır farklı müşteri yazıyorsa aynı faturaya düşer ve
 * "Müşteri farklı" hatası alır — iki ayrı fatura sanılıp ikincisi sessizce
 * reddedilmez.
 */
function groupKey(tur: SablonTuru, invoiceNo: string, taxNumber: string, name: string): string {
  if (tur !== "alis") return trFold(invoiceNo)
  return `${trFold(invoiceNo)}|${taxNumber || `ad:${trFold(name)}`}`
}

type HeaderDraft = {
  invoiceNo: string
  date: string | null | undefined
  dueDate: string | null | undefined
  counterpartyName: string
  counterpartyTaxNumber: string
  country: string
  currency: string
  exchangeRate: number | undefined
  category: string
  notes: string
  globalDiscount: number | undefined
  expectedTotal: number | undefined
}

function headerLabels(tur: SablonTuru): Record<keyof HeaderDraft, string> {
  const cari = cariEtiketi(tur)
  return {
    invoiceNo: "Fatura No",
    date: "Fatura Tarihi",
    dueDate: "Vade Tarihi",
    counterpartyName: cari,
    counterpartyTaxNumber: `${cari} VKN/TCKN`,
    country: "Ülke",
    currency: "Para Birimi",
    exchangeRate: "Döviz Kuru",
    category: "Kategori",
    notes: "Fatura Açıklaması",
    globalDiscount: "Fatura Altı İskonto",
    expectedTotal: "Genel Toplam",
  }
}

type Draft = SablonFaturasi & { header: HeaderDraft }

/**
 * Dosyanın satırlarını (ilk dolu satır başlık) faturalara ayırır ve biçim kurallarını
 * uygular. Veritabanına bakan kurallar (cari/ürün eşleşmesi, mükerrer fatura)
 * burada DEĞİL: lib/faturalar/fatura-ice-aktar.ts.
 */
export function parseFaturaSablonu(sheetRows: Cell[][], tur: SablonTuru): SablonAyrisimi {
  const columns = sablonKolonlari(tur)
  const labels = headerLabels(tur)
  const cari = cariEtiketi(tur)
  const empty = (fileError: string, unknownColumns: string[] = []): SablonAyrisimi => ({
    missingColumns: [],
    unknownColumns,
    invoices: [],
    fileError,
  })

  const headerIndex = sheetRows.findIndex((row) => Array.isArray(row) && row.some((c) => cellText(c) !== ""))
  if (headerIndex < 0) return empty("Dosya boş.")

  const { indexOf, unknown } = mapHeaders(sheetRows[headerIndex], columns)
  const missingColumns = columns.filter((col) => col.required && !indexOf.has(col.key)).map((col) => col.label)
  // Ünvan ya da vergi no'dan biri yeter: yalnız VKN'li dosya da cariyi bulur.
  if (indexOf.has("counterpartyTaxNumber")) {
    const i = missingColumns.indexOf(cari)
    if (i >= 0) missingColumns.splice(i, 1)
  }
  // Ürün kodu sütunu varsa ad sütunu şart değil (kartın adı kullanılır).
  if (indexOf.has("productCode")) {
    const i = missingColumns.indexOf("Ürün/Hizmet Adı")
    if (i >= 0) missingColumns.splice(i, 1)
  }
  if (missingColumns.length > 0) {
    return { missingColumns, unknownColumns: unknown, invoices: [], fileError: null }
  }

  const dataRows = sheetRows.slice(headerIndex + 1)
  if (dataRows.length > SABLON_MAX_ROWS) {
    return empty(
      `Dosyada ${dataRows.length.toLocaleString("tr-TR")} satır var; tek seferde en fazla ` +
        `${SABLON_MAX_ROWS.toLocaleString("tr-TR")} satır aktarılabilir. Dosyayı bölün.`,
      unknown,
    )
  }

  const invoices = new Map<string, Draft>()
  let previous: Draft | null = null

  dataRows.forEach((raw, offset) => {
    const excelRow = headerIndex + offset + 2
    const values = readRow(Array.isArray(raw) ? raw : [], indexOf)
    if (isBlankRow(values)) return

    const rowErrors: string[] = []
    const num = (key: SablonAlan, label: string): number | undefined => {
      try {
        return parseNumberCell(values[key], label)
      } catch (error: any) {
        rowErrors.push(error?.message || `"${label}" okunamadı`)
        return undefined
      }
    }
    const date = (key: SablonAlan, label: string): string | null | undefined => {
      const parsed = parseSablonDate(values[key])
      if (parsed === null) {
        rowErrors.push(`"${label}" tarih olarak okunamadı: "${cellText(values[key])}" (GG.AA.YYYY bekleniyor)`)
      }
      return parsed
    }

    // --- Fatura başlığı --------------------------------------------------
    const identityBlank = HEADER_IDENTITY.every((key) => cellText(values[key]) === "")
    let invoice: Draft | null = null

    const header: HeaderDraft = {
      invoiceNo: cellText(values.invoiceNo),
      date: date("date", "Fatura Tarihi"),
      dueDate: date("dueDate", "Vade Tarihi"),
      counterpartyName: cellText(values.counterpartyName),
      counterpartyTaxNumber: canonicalTaxNumber(cellText(values.counterpartyTaxNumber)),
      country: cellText(values.country),
      currency: cellText(values.currency) ? normalizeCurrency(cellText(values.currency)) : "",
      exchangeRate: num("exchangeRate", "Döviz Kuru"),
      category: cellText(values.category),
      notes: cellText(values.notes),
      globalDiscount: num("globalDiscount", "Fatura Altı İskonto"),
      expectedTotal: num("expectedTotal", "Genel Toplam"),
    }

    if (identityBlank) {
      // Devam satırı: bir önceki faturanın kalemi.
      if (!previous) {
        invoice = newInvoice(`satir:${excelRow}`, header.invoiceNo)
        invoice.errors.push(`Satır ${excelRow}: Fatura No ve ${cari} boş; satır hiçbir faturaya bağlanamadı.`)
        invoices.set(invoice.key, invoice)
      } else {
        invoice = previous
      }
    } else {
      const normalizedNo = normalizeManualInvoiceNo(header.invoiceNo)
      if (!normalizedNo.ok) rowErrors.push(normalizedNo.error)
      const invoiceNo = normalizedNo.ok ? normalizedNo.value ?? "" : header.invoiceNo
      header.invoiceNo = invoiceNo
      const key = invoiceNo
        ? groupKey(tur, invoiceNo, header.counterpartyTaxNumber, header.counterpartyName)
        : `satir:${excelRow}`
      invoice = invoices.get(key) ?? null
      if (!invoice) {
        invoice = newInvoice(key, invoiceNo)
        invoices.set(key, invoice)
        if (!invoiceNo) invoice.errors.push(`Satır ${excelRow}: Fatura No boş.`)
      }
    }

    invoice.rows.push(excelRow)
    mergeHeader(invoice, header, excelRow, labels)

    // --- Kalem -----------------------------------------------------------
    const productCode = cellText(values.productCode)
    const description = cellText(values.description)
    const quantity = num("quantity", "Miktar")
    const unitPrice = num("unitPrice", "Birim Fiyat")
    let vatRate = num("vatRate", "KDV %")
    const discountRate = num("discountRate", "İskonto %")
    const discountAmount = num("discountAmount", "İskonto Tutarı")
    let exemptionCode = cellText(values.exemptionCode)

    if (!productCode && !description) rowErrors.push("Ürün/Hizmet Adı boş (ya da Ürün/Hizmet Kodu verin).")
    if (quantity === undefined) rowErrors.push("Miktar boş.")
    else if (!(quantity > 0)) rowErrors.push(`Miktar sıfırdan büyük olmalı (${quantity}).`)
    if (unitPrice === undefined) rowErrors.push("Birim Fiyat boş.")
    if (tur === "ihracat") {
      if (vatRate === undefined) vatRate = 0
      if (vatRate !== 0) rowErrors.push(`İhracat faturasında KDV %0 olmalı (dosyada %${vatRate}).`)
      // Varsayılan kod yalnız geçerli (%0) kalemde: KDV'si hatalı kaleme 301 yazmak
      // "istisna kodu yalnız %0'lı kalemde" diye ikinci, yanıltıcı bir hata üretirdi.
      else if (!exemptionCode) exemptionCode = IHRACAT_VARSAYILAN_ISTISNA
    } else if (vatRate === undefined) {
      rowErrors.push("KDV % boş.")
    } else if (vatRate < 0 || vatRate > 100) {
      rowErrors.push(`KDV % 0–100 arası olmalı (${vatRate}).`)
    }
    if (exemptionCode) {
      if (!/^\d{3}$/.test(exemptionCode)) {
        rowErrors.push(`KDV İstisna Kodu 3 haneli olmalı ("${exemptionCode}").`)
      } else if (vatRate !== undefined && vatRate !== 0) {
        rowErrors.push(`KDV İstisna Kodu yalnız %0 KDV'li kalemde yazılır (kalemde %${vatRate}).`)
      }
    }
    if (discountRate !== undefined && (discountRate < 0 || discountRate > 100)) {
      rowErrors.push(`İskonto % 0–100 arası olmalı (${discountRate}).`)
    }
    if (discountAmount !== undefined && discountAmount < 0) {
      rowErrors.push(`İskonto Tutarı negatif olamaz (${discountAmount}).`)
    }

    if (rowErrors.length > 0) {
      for (const message of rowErrors) invoice.errors.push(`Satır ${excelRow}: ${message}`)
    } else {
      const usePercent = discountRate !== undefined && discountRate > 0
      invoice.lines.push({
        row: excelRow,
        productCode,
        description,
        quantity: quantity as number,
        unit: cellText(values.unit),
        unitPrice: unitPrice as number,
        discountMode: usePercent || !(discountAmount && discountAmount > 0) ? "PERCENT" : "AMOUNT",
        discountRate: usePercent ? (discountRate as number) : 0,
        discountAmount: usePercent ? 0 : discountAmount ?? 0,
        vatRate: vatRate as number,
        exemptionCode,
      })
    }

    previous = invoice
  })

  const result: SablonFaturasi[] = []
  for (const invoice of invoices.values()) {
    finalizeInvoice(invoice, tur)
    const { header: _header, ...rest } = invoice
    result.push(rest)
  }

  if (result.length === 0) return empty("Dosyada kalem satırı yok.", unknown)
  if (result.length > SABLON_MAX_INVOICES) {
    return empty(
      `Dosyada ${result.length} fatura var; tek seferde en fazla ${SABLON_MAX_INVOICES} fatura ` +
        `aktarılabilir. Dosyayı bölün.`,
      unknown,
    )
  }

  return { missingColumns: [], unknownColumns: unknown, invoices: result, fileError: null }
}

function newInvoice(key: string, invoiceNo: string): Draft {
  return {
    key,
    rows: [],
    invoiceNo,
    date: null,
    dueDate: null,
    counterpartyName: "",
    counterpartyTaxNumber: "",
    country: "",
    currency: "TRY",
    exchangeRate: null,
    category: "",
    notes: "",
    globalDiscount: 0,
    expectedTotal: null,
    lines: [],
    errors: [],
    header: {
      invoiceNo,
      date: undefined,
      dueDate: undefined,
      counterpartyName: "",
      counterpartyTaxNumber: "",
      country: "",
      currency: "",
      exchangeRate: undefined,
      category: "",
      notes: "",
      globalDiscount: undefined,
      expectedTotal: undefined,
    },
  }
}

/**
 * Satırın fatura alanlarını faturaya işler. Boş hücre "öncekini koru" demektir;
 * DOLU ama farklı değer hatadır — hangisinin doğru olduğunu seçmek, iki tarihten
 * birini sessizce atmak olurdu.
 */
function mergeHeader(
  invoice: Draft,
  incoming: HeaderDraft,
  excelRow: number,
  labels: Record<keyof HeaderDraft, string>,
) {
  const keys = Object.keys(labels) as Array<keyof HeaderDraft>
  for (const key of keys) {
    if (key === "invoiceNo") continue
    const next = incoming[key]
    if (next === undefined || next === null || next === "") continue
    const current = invoice.header[key]
    if (current === undefined || current === null || current === "") {
      ;(invoice.header as any)[key] = next
      continue
    }
    const same =
      typeof current === "number" && typeof next === "number"
        ? Math.abs(current - next) < 0.005
        : key === "counterpartyName" || key === "country"
          ? trFold(String(current)) === trFold(String(next))
          : String(current) === String(next)
    if (!same) {
      invoice.errors.push(
        `Satır ${excelRow}: "${labels[key]}" aynı faturanın önceki satırındakinden farklı ` +
          `(${String(current)} ≠ ${String(next)}).`,
      )
    }
  }
}

function finalizeInvoice(invoice: Draft, tur: SablonTuru) {
  const h = invoice.header
  const cari = cariEtiketi(tur)
  invoice.date = h.date ?? null
  invoice.dueDate = h.dueDate ?? null
  invoice.counterpartyName = h.counterpartyName
  invoice.counterpartyTaxNumber = h.counterpartyTaxNumber
  invoice.country = h.country
  invoice.currency = h.currency || "TRY"
  invoice.exchangeRate = h.exchangeRate ?? null
  invoice.category = h.category
  invoice.notes = h.notes
  invoice.globalDiscount = h.globalDiscount ?? 0
  invoice.expectedTotal = h.expectedTotal ?? null

  if (invoice.key.startsWith("satir:")) return // zaten hatalı

  if (!invoice.date && !invoice.errors.some((e) => e.includes("Fatura Tarihi"))) {
    invoice.errors.push("Fatura Tarihi boş.")
  }
  if (!invoice.counterpartyName && !invoice.counterpartyTaxNumber) {
    invoice.errors.push(`${cari} ünvanı ve vergi numarası boş.`)
  }
  const tax = invoice.counterpartyTaxNumber
  if (tax) {
    if (tur === "ihracat") {
      if (tax.length > 20) invoice.errors.push(`${cari} vergi numarası en fazla 20 karakter olabilir (${tax}).`)
    } else if (!/^\d{10,11}$/.test(tax)) {
      invoice.errors.push(`${cari} VKN/TCKN 10 ya da 11 haneli rakam olmalı (${tax}).`)
    }
  }
  if (!/^[A-Z]{3}$/.test(invoice.currency)) {
    invoice.errors.push(`Para Birimi tanınmadı: "${invoice.currency}" (TRY, USD, EUR gibi 3 harfli kod).`)
  } else if (invoice.currency !== "TRY" && !(invoice.exchangeRate && invoice.exchangeRate > 0)) {
    invoice.errors.push(`${invoice.currency} faturasında Döviz Kuru zorunlu.`)
  }
  if (invoice.globalDiscount < 0) invoice.errors.push("Fatura Altı İskonto negatif olamaz.")
  if (invoice.lines.length === 0 && invoice.errors.length === 0) {
    invoice.errors.push("Faturanın geçerli kalemi yok.")
  }
}

/* ------------------------------------------------------------------ *
 * Tutarlar — yazılacak değerlerle AYNI hesap
 * ------------------------------------------------------------------ */

export type SablonToplami = { net: number; vat: number; total: number }

/**
 * Faturanın toplamı. `createInvoiceFromBody`nin kaydederken yaptığı hesabın
 * aynısı: kolon hassasiyetine yuvarlanmış miktar/fiyat, moddan çözülmüş satır
 * iskontosu, dip toplam `computeInvoiceTotals`ten (resmî belge kuralı). Önizlemede
 * gösterilen rakam kaydedilen rakamdan ayrışmasın diye burada ikinci bir formül yok.
 */
export function faturaSablonToplami(
  invoice: { lines: Array<Omit<SablonKalemi, "row" | "productCode" | "description" | "unit" | "exemptionCode">>; globalDiscount: number },
): SablonToplami {
  const lines = invoice.lines.map((line) => {
    const quantity = documentColumnPrecision.quantity(line.quantity)
    const unitPrice = documentColumnPrecision.unitPrice(line.unitPrice)
    const discountAmount = documentColumnPrecision.amount(
      resolveLineDiscount({
        quantity,
        unitPrice,
        discountMode: line.discountMode,
        discountRate: line.discountRate,
        discountAmount: line.discountAmount,
      }),
    )
    return { quantity, unitPrice, vatRate: line.vatRate, discountRate: line.discountRate, discountAmount }
  })
  const totals = computeInvoiceTotals(lines, { globalDiscountAmount: invoice.globalDiscount })
  return { net: totals.net, vat: totals.vat, total: totals.total }
}

/**
 * Dosyadaki "Genel Toplam" ile hesaplanan toplam tutuyor mu? Tutmuyorsa hata
 * metni döner. Tevkifat/ÖTV içeren bir faturanın şablondan vergisiz kopyası
 * böyle yakalanır.
 */
export function expectedTotalMismatch(invoice: SablonFaturasi, computedTotal: number): string | null {
  if (invoice.expectedTotal === null) return null
  const diff = Math.abs(invoice.expectedTotal - computedTotal)
  if (diff <= 0.01) return null
  const fmt = (n: number) => n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return (
    `Dosyadaki Genel Toplam ${fmt(invoice.expectedTotal)}, kalemlerden hesaplanan ${fmt(computedTotal)}. ` +
    `Şablon tevkifat, ÖTV, diğer vergi, GEKAP ve fatura altı ilaveyi taşımaz; kaynak belgenin kuruş ` +
    `yuvarlaması da fark yaratabilir. Kalemleri düzeltin, faturayı elle girin ya da farkı kabul ediyorsanız ` +
    `Genel Toplam hücresini boşaltın.`
  )
}
