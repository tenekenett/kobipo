// Açılış/kapanış kontrol listesi — istemcinin de kullandığı saf sabitler ve
// hesaplar. Sunucu yardımcıları `checklist-server.ts`te (Prisma import'u
// istemci paketine sızmasın; ticket-constants/tickets ayrımının aynısı).
//
// Liste BLOKLAMAZ: eksik madde satışı da gün sonunu da durdurmaz, yalnız uyarı
// basar. Gerekçe prisma/schema.prisma → ChecklistItem başlığında.

export const CHECKLIST_TYPES = ["OPENING", "CLOSING"] as const

export type ChecklistType = (typeof CHECKLIST_TYPES)[number]

export const CHECKLIST_TYPE_LABELS: Record<ChecklistType, string> = {
  OPENING: "Açılış",
  CLOSING: "Kapanış",
}

/** Uyarı metinlerinde geçen ek: "Açılış listesinde 3 madde onaylanmadı". */
export const CHECKLIST_TYPE_HINTS: Record<ChecklistType, string> = {
  OPENING: "Gün başında yapılacaklar",
  CLOSING: "Gün sonunda yapılacaklar",
}

export const isChecklistType = (value: unknown): value is ChecklistType =>
  typeof value === "string" && (CHECKLIST_TYPES as readonly string[]).includes(value)

/** `checklist_items.title` / `checklist_entries.itemTitle` kolon genişliği. */
export const CHECKLIST_TITLE_MAX = 160

export type ChecklistEntryView = {
  id: string
  employeeId: string | null
  employeeName: string
  note: string | null
  checkedAt: string
}

export type ChecklistItemView = {
  id: string
  title: string
  sortOrder: number
  isActive: boolean
  /** O GÜNE ait onay; yoksa madde yapılmamıştır (ayrı "yapılmadı" durumu yok). */
  entry: ChecklistEntryView | null
}

export type ChecklistDay = {
  date: string
  type: ChecklistType
  items: ChecklistItemView[]
  /** Personel seçici için liste — bkz. `gun/route.ts`, neden burada döndüğü. */
  employees: { id: string; name: string; position: string | null }[]
}

/**
 * Uyarı şeridinin tek karar noktası. Madde tanımlanmamış bir firmada `total: 0`
 * döner ve şerit HİÇ çıkmaz: listeyi kurmamış bir işletmeye her ekranda "0/0
 * madde" uyarısı basmak, özelliği ilk günden görmezden gelinen bir gürültüye
 * çevirirdi.
 */
export function checklistProgress(items: Pick<ChecklistItemView, "entry">[]): {
  total: number
  done: number
  pending: number
  complete: boolean
} {
  const total = items.length
  const done = items.filter((item) => item.entry != null).length
  return { total, done, pending: total - done, complete: total > 0 && done === total }
}

/** "YYYY-MM-DD" — kullanıcının YEREL günü (sunucunun UTC günü değil). */
export function todayIso(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
}
