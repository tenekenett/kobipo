/**
 * HARCAMA KATEGORİ AĞACI — SAF modül.
 *
 * Gelir-gider raporunun kategori sekmesi DÜZ bir liste basar: "Personel > Maaş",
 * "Personel > SGK" ve "Ofis > Kira" orada üç ayrı satırdır ve "personele toplam
 * ne ödedim" sorusu cevapsız kalır. Harcamalar raporu aynı kategorileri İKİ
 * SEVİYEDE toplar; ayrımı yapan şey ayrı bir alan değil, kategori metnindeki
 * `>` ayracıdır.
 *
 * NEDEN AYRI BİR ALAN DEĞİL: kategori serbest metindir ve fatura ile kasa
 * hareketi aynı kümeyi paylaşır (bkz. lib/finans/siniflandirma.ts). Ana/alt
 * kategori için ikinci bir sütun eklemek, o kümeyi ikiye bölerdi — ayraç ise
 * hiçbir şeyi bozmadan, kullanan için hiyerarşi üretir: ayraç yazmayan
 * kullanıcının kategorisi tek seviyeli kalır ve rapor aynen çalışır.
 *
 * İKİ SEVİYE YETER: "Personel > Maaş > İkramiye" gibi daha derin bir metinde ilk
 * parça ana, GERİ KALANIN TAMAMI alt kategoridir. Üçüncü seviye eklemek tabloyu
 * okunmaz yapardı ve kimse böyle bir kategori yazmıyor.
 */

/** Ana ve alt kategoriyi ayıran işaret. Etrafındaki boşluklar önemsizdir. */
export const CATEGORY_SEPARATOR = ">"

/** Kategorisi girilmemiş harcamaların toplandığı satır. */
export const UNCATEGORIZED_EXPENSE_LABEL = "Kategorisiz"

export type ExpenseTreeEntry = {
  /** İşaretli tutar — alış iadesi EKSİ gelir, gideri azaltır. */
  amount: number
  category: string | null
  count: number
}

export type ExpenseTreeNode = {
  key: string
  label: string
  amount: number
  count: number
  /** Genel toplam içindeki pay (%). Toplam sıfırsa 0. */
  sharePct: number
}

export type ExpenseTreeGroup = ExpenseTreeNode & {
  /**
   * Alt kategoriler. BOŞ dizi = kategori tek seviyeli yazılmış (ayraç yok);
   * satırın kendisi yaprak demektir.
   */
  children: ExpenseTreeNode[]
}

export type ExpenseTree = {
  total: number
  groups: ExpenseTreeGroup[]
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * "Personel > Maaş" → `{ main: "Personel", sub: "Maaş" }`.
 *
 * Boş/eksik kategori "Kategorisiz"e düşer. Ayracın bir tarafı boşsa (ör.
 * "Personel >") o taraf yok sayılır — kullanıcının yarım bıraktığı metin,
 * adı boş bir alt kategori üretmemeli.
 */
export function splitCategory(raw: string | null | undefined): { main: string; sub: string | null } {
  const value = (raw ?? "").trim()
  if (!value) return { main: UNCATEGORIZED_EXPENSE_LABEL, sub: null }

  const index = value.indexOf(CATEGORY_SEPARATOR)
  if (index === -1) return { main: value, sub: null }

  const main = value.slice(0, index).trim()
  const sub = value.slice(index + CATEGORY_SEPARATOR.length).trim()
  if (!main) return { main: sub || UNCATEGORIZED_EXPENSE_LABEL, sub: null }
  return { main, sub: sub || null }
}

export function buildExpenseTree(entries: ExpenseTreeEntry[]): ExpenseTree {
  const groups = new Map<string, { node: ExpenseTreeGroup; children: Map<string, ExpenseTreeNode> }>()
  let total = 0

  for (const entry of entries) {
    total += entry.amount
    const { main, sub } = splitCategory(entry.category)

    let group = groups.get(main)
    if (!group) {
      group = {
        node: { key: main, label: main, amount: 0, count: 0, sharePct: 0, children: [] },
        children: new Map(),
      }
      groups.set(main, group)
    }
    group.node.amount += entry.amount
    group.node.count += entry.count

    if (!sub) continue
    let child = group.children.get(sub)
    if (!child) {
      // Alt kategorinin anahtarı TAM metindir: iki farklı ana kategorinin
      // "Diğer" altları aynı satıra düşmesin.
      child = { key: `${main}${CATEGORY_SEPARATOR}${sub}`, label: sub, amount: 0, count: 0, sharePct: 0 }
      group.children.set(sub, child)
    }
    child.amount += entry.amount
    child.count += entry.count
  }

  total = round2(total)
  // Pay GENEL TOPLAMA göre: alt kategori payı da öyle, böylece "Maaş toplam
  // giderin %18'i" doğrudan okunur. Üst kaleme göre olsaydı iki farklı ana
  // kategorinin alt satırları kıyaslanamazdı.
  const share = (amount: number) => (total === 0 ? 0 : round2((amount / total) * 100))

  const out: ExpenseTreeGroup[] = []
  for (const group of groups.values()) {
    group.node.amount = round2(group.node.amount)
    group.node.sharePct = share(group.node.amount)
    group.node.children = Array.from(group.children.values())
      .map((child) => ({ ...child, amount: round2(child.amount), sharePct: share(child.amount) }))
      .sort((a, b) => b.amount - a.amount || a.label.localeCompare(b.label, "tr"))
    out.push(group.node)
  }

  out.sort((a, b) => b.amount - a.amount || a.label.localeCompare(b.label, "tr"))
  return { total, groups: out }
}
