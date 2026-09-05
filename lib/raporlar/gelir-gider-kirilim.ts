/**
 * Gelir-gider KIRILIMLARI — SAF modül.
 *
 * Ayrı dosya çünkü hem hesap (`gelir-gider.ts`, Prisma'lı) hem test buradan
 * okur; aynı ayrım `cari-yaslandirma-plan.ts` ve `satis-alis-shared.ts`te var.
 *
 * ÖLÇÜ NET TUTARDIR (KDV hariç). KDV tahsil edilen ama devlete ait bir tutardır;
 * gelir sayılırsa kârlılık %20'ye varan bir yanılgıyla şişer. Eski ölü uç
 * (`/api/raporlar/gelir-gider`) `totalAmount` topluyordu.
 *
 * İADE, kendi ailesinin EKSİSİDİR: satış iadesi ciroyu, alış iadesi gideri
 * azaltır — ayrı bir "iade" kalemi açılmaz, yoksa kategori satırları geri gelen
 * malı hâlâ satılmış gösterirdi.
 */

export type BreakdownAxis = "category" | "tag" | "party" | "month"

/** Kırılıma giren tek bir belge/işlem. `amount` İŞARETLİDİR (iade eksi). */
export type ClassifiedEntry = {
  direction: "revenue" | "expense"
  amount: number
  /** Boş/`null` = kategorisiz; satır "Kategorisiz" başlığında toplanır. */
  category: string | null
  /** Serbest metin etiketler. Bir belge birden çok etikete girebilir. */
  tags: string[]
  /** `YYYY-MM`. */
  month: string
  /** Carinin id'si — satırları gruplamak için. Yoksa null. */
  partyKey: string | null
  partyLabel: string | null
  /**
   * Cari kartının ADRESİ: slug varsa SEF hâli, yoksa id. Adres YOLU DEĞİL, sadece
   * referanstır — yolu (`/cari/customers` mi `/cari/suppliers` mi) `partyKind`
   * söyler ve ekran `CariLink` ile kurar. URL bilgisi saf modüle sızmasın.
   */
  partyRef: string | null
  partyKind: "customer" | "supplier" | null
  /** Belge sayısı — faturasız toplu kalemlerde 0 verilebilir. */
  count: number
}

export type BreakdownRow = {
  key: string
  label: string
  /** Cari satırlarında kartın referansı (slug ya da id); diğer eksenlerde null. */
  ref: string | null
  /** Cari satırlarında kartın türü — link yönünü belirler. */
  kind: "customer" | "supplier" | null
  revenue: number
  expense: number
  profit: number
  count: number
}

export type BreakdownTotals = {
  revenue: number
  expense: number
  profit: number
  /** Kâr marjı (%). Ciro sıfırsa oran YOKTUR — `null`, "%0 marj" değil. */
  marginPct: number | null
}

export const UNCATEGORIZED_LABEL = "Kategorisiz"
export const UNTAGGED_LABEL = "Etiketsiz"

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function emptyRow(
  key: string,
  label: string,
  ref: string | null,
  kind: "customer" | "supplier" | null
): BreakdownRow {
  return { key, label, ref, kind, revenue: 0, expense: 0, profit: 0, count: 0 }
}

/** Satırı bulur ya da açar; tutarı yönüne göre işler. */
function accumulate(
  map: Map<string, BreakdownRow>,
  key: string,
  label: string,
  entry: ClassifiedEntry,
  ref: string | null = null,
  kind: "customer" | "supplier" | null = null
) {
  let row = map.get(key)
  if (!row) {
    row = emptyRow(key, label, ref, kind)
    map.set(key, row)
  }
  if (entry.direction === "revenue") row.revenue += entry.amount
  else row.expense += entry.amount
  row.count += entry.count
}

/** Tutara göre büyükten küçüğe; eşitlikte ada göre (liste her çağrıda aynı sırada). */
function finalize(map: Map<string, BreakdownRow>): BreakdownRow[] {
  const rows = Array.from(map.values())
  for (const row of rows) {
    row.revenue = round2(row.revenue)
    row.expense = round2(row.expense)
    row.profit = round2(row.revenue - row.expense)
  }
  return rows.sort((a, b) => {
    const weight = Math.abs(b.revenue) + Math.abs(b.expense) - (Math.abs(a.revenue) + Math.abs(a.expense))
    if (weight !== 0) return weight
    return a.label.localeCompare(b.label, "tr")
  })
}

/** Aylık satırlar TARİHE göre sıralanır — tutara göre değil (eksen zamandır). */
function finalizeMonths(map: Map<string, BreakdownRow>): BreakdownRow[] {
  const rows = Array.from(map.values())
  for (const row of rows) {
    row.revenue = round2(row.revenue)
    row.expense = round2(row.expense)
    row.profit = round2(row.revenue - row.expense)
  }
  return rows.sort((a, b) => a.key.localeCompare(b.key))
}

export type Breakdowns = {
  totals: BreakdownTotals
  byCategory: BreakdownRow[]
  /**
   * DİKKAT: bir belge birden çok etikete girebilir, dolayısıyla etiket
   * satırlarının toplamı genel toplamı AŞABİLİR. Ekran bunu yazmak zorunda;
   * yoksa kullanıcı "toplamlar tutmuyor" der.
   */
  byTag: BreakdownRow[]
  byParty: BreakdownRow[]
  byMonth: BreakdownRow[]
}

export function buildBreakdowns(entries: ClassifiedEntry[]): Breakdowns {
  const categories = new Map<string, BreakdownRow>()
  const tags = new Map<string, BreakdownRow>()
  const parties = new Map<string, BreakdownRow>()
  const months = new Map<string, BreakdownRow>()

  let revenue = 0
  let expense = 0

  for (const entry of entries) {
    if (entry.direction === "revenue") revenue += entry.amount
    else expense += entry.amount

    const category = entry.category?.trim() || ""
    accumulate(categories, category, category || UNCATEGORIZED_LABEL, entry)

    const entryTags = entry.tags.map((tag) => tag.trim()).filter(Boolean)
    if (entryTags.length === 0) {
      accumulate(tags, "", UNTAGGED_LABEL, entry)
    } else {
      // Aynı etiket iki kez yazılmışsa bir kez sayılır; aksi halde belge kendi
      // satırında iki kat görünürdü.
      for (const tag of new Set(entryTags)) {
        accumulate(tags, tag, tag, entry)
      }
    }

    if (entry.partyKey) {
      accumulate(
        parties,
        entry.partyKey,
        entry.partyLabel || entry.partyKey,
        entry,
        entry.partyRef,
        entry.partyKind
      )
    }

    accumulate(months, entry.month, entry.month, entry)
  }

  revenue = round2(revenue)
  expense = round2(expense)
  const profit = round2(revenue - expense)

  return {
    totals: {
      revenue,
      expense,
      profit,
      marginPct: revenue === 0 ? null : round2((profit / revenue) * 100),
    },
    byCategory: finalize(categories),
    byTag: finalize(tags),
    byParty: finalize(parties),
    byMonth: finalizeMonths(months),
  }
}
