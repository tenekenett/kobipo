/**
 * Vardiya barlarının renk paleti.
 *
 * `lib/` altında DEĞİL, bilerek: Tailwind yalnız app/components/pages/src
 * altını tarıyor (tailwind.config.ts content), lib'e yazılan sınıf adları
 * üretilen CSS'e girmez ve barlar renksiz kalırdı.
 *
 * İki renk ekseni var ve karışmamaları önemli:
 * - ŞABLON rengi (varsa kazanır): "Sabah" ile "Akşam" vardiyasını ayırır. Hafta
 *   ızgarasında asıl anlamlı olan budur — orada zaten her satır tek personeldir,
 *   personele göre renk hiçbir şey söylemez.
 * - PERSONEL rengi (yedek): şablonsuz vardiyalarda gün görünümünde bitişik
 *   satırların birbirine karışmasını önler.
 */

export const SHIFT_COLOR_TOKENS = ["blue", "violet", "green", "amber", "rose", "cyan"] as const

export type ShiftColor = (typeof SHIFT_COLOR_TOKENS)[number]

/** Dolu bar — ışık/karanlık ikisinde de metin kontrastı korunur. */
export const SHIFT_COLOR_CLASS: Record<ShiftColor, string> = {
  blue: "bg-kobipo-blue text-white dark:bg-primary dark:text-primary-foreground",
  violet: "bg-violet-600 text-white dark:bg-violet-500",
  green: "bg-kobipo-green text-white dark:bg-emerald-500 dark:text-emerald-950",
  amber: "bg-amber-500 text-amber-950 dark:bg-amber-400",
  rose: "bg-rose-500 text-white dark:bg-rose-400 dark:text-rose-950",
  cyan: "bg-cyan-600 text-white dark:bg-cyan-400 dark:text-cyan-950",
}

/**
 * Soluk (içi boş) bar — fiilî damga girildiğinde PLAN bu biçime döner, dolu bar
 * fiiliyi gösterir. "Çerçeve = plan, dolgu = fiilî" ayrımını taşıyan şey bu çift.
 */
export const SHIFT_COLOR_SOFT: Record<ShiftColor, string> = {
  blue: "bg-kobipo-blue/10 text-kobipo-blue ring-1 ring-inset ring-kobipo-blue/40 dark:bg-primary/15 dark:text-primary dark:ring-primary/50",
  violet:
    "bg-violet-500/10 text-violet-700 ring-1 ring-inset ring-violet-500/40 dark:text-violet-300 dark:ring-violet-400/50",
  green:
    "bg-emerald-500/10 text-emerald-700 ring-1 ring-inset ring-emerald-500/40 dark:text-emerald-300 dark:ring-emerald-400/50",
  amber:
    "bg-amber-500/10 text-amber-700 ring-1 ring-inset ring-amber-500/40 dark:text-amber-300 dark:ring-amber-400/50",
  rose: "bg-rose-500/10 text-rose-700 ring-1 ring-inset ring-rose-500/40 dark:text-rose-300 dark:ring-rose-400/50",
  cyan: "bg-cyan-500/10 text-cyan-700 ring-1 ring-inset ring-cyan-500/40 dark:text-cyan-300 dark:ring-cyan-400/50",
}

/** Şablon seçicideki yuvarlak örnek. */
export const SHIFT_COLOR_DOT: Record<ShiftColor, string> = {
  blue: "bg-kobipo-blue dark:bg-primary",
  violet: "bg-violet-600 dark:bg-violet-500",
  green: "bg-kobipo-green dark:bg-emerald-500",
  amber: "bg-amber-500 dark:bg-amber-400",
  rose: "bg-rose-500 dark:bg-rose-400",
  cyan: "bg-cyan-600 dark:bg-cyan-400",
}

export const isShiftColor = (v: unknown): v is ShiftColor =>
  typeof v === "string" && (SHIFT_COLOR_TOKENS as readonly string[]).includes(v)

/**
 * Barın rengi: şablon rengi varsa o, yoksa personel sırasına göre sabit bir renk.
 * Sıra bazlı yedek, aynı ekranda iki personelin aynı rengi almasını seyrekleştirir.
 */
export const barClass = (templateColor: string | null | undefined, employeeIndex: number) =>
  SHIFT_COLOR_CLASS[colorOf(templateColor, employeeIndex)]

/** Aynı renk seçiminin soluk (plan çerçevesi) karşılığı. */
export const softBarClass = (templateColor: string | null | undefined, employeeIndex: number) =>
  SHIFT_COLOR_SOFT[colorOf(templateColor, employeeIndex)]

const colorOf = (templateColor: string | null | undefined, employeeIndex: number): ShiftColor =>
  isShiftColor(templateColor)
    ? templateColor
    : SHIFT_COLOR_TOKENS[employeeIndex % SHIFT_COLOR_TOKENS.length]
