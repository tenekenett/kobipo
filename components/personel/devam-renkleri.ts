/**
 * Devam takvimindeki hücre renkleri.
 *
 * `lib/` altında DEĞİL, bilerek — `components/personel/shift-colors.ts` ile aynı
 * gerekçe: Tailwind yalnız app/components/pages/src altını tarıyor, lib'e yazılan
 * sınıf adları üretilen CSS'e girmez ve hücreler renksiz kalırdı.
 *
 * İki biçim var ve ayrımı taşımaları şart:
 * - DOLU: kullanıcının elle işaretlediği gün (`AttendanceDay` satırı var).
 * - SOLUK + kesikli çerçeve: türetilmiş gün (izinden, tatilden, kapalı günden ya
 *   da varsayılandan geliyor). Kullanıcı neyi kendisinin yazdığını görebilmeli;
 *   ikisi aynı çizilseydi, sonradan girilen bir izin "benim işaretlediğim gün"
 *   sanılırdı.
 */

import type { DevamStatus } from "@/lib/personel/devam"

export const DEVAM_CELL_CLASS: Record<DevamStatus, string> = {
  WORKED: "bg-kobipo-green text-white dark:bg-emerald-500 dark:text-emerald-950",
  HALF_DAY: "bg-teal-500 text-white dark:bg-teal-400 dark:text-teal-950",
  PAID_LEAVE: "bg-kobipo-blue text-white dark:bg-primary dark:text-primary-foreground",
  SICK: "bg-violet-600 text-white dark:bg-violet-500",
  UNPAID_LEAVE: "bg-amber-500 text-amber-950 dark:bg-amber-400",
  ABSENT: "bg-rose-500 text-white dark:bg-rose-400 dark:text-rose-950",
  HOLIDAY: "bg-cyan-600 text-white dark:bg-cyan-400 dark:text-cyan-950",
  WEEKLY_OFF: "bg-muted text-muted-foreground",
}

export const DEVAM_CELL_SOFT: Record<DevamStatus, string> = {
  WORKED:
    "bg-emerald-500/10 text-emerald-700 ring-1 ring-inset ring-emerald-500/30 dark:text-emerald-300 dark:ring-emerald-400/40",
  HALF_DAY:
    "bg-teal-500/10 text-teal-700 ring-1 ring-inset ring-teal-500/30 dark:text-teal-300 dark:ring-teal-400/40",
  PAID_LEAVE:
    "bg-kobipo-blue/10 text-kobipo-blue ring-1 ring-inset ring-kobipo-blue/30 dark:bg-primary/15 dark:text-primary dark:ring-primary/40",
  SICK: "bg-violet-500/10 text-violet-700 ring-1 ring-inset ring-violet-500/30 dark:text-violet-300 dark:ring-violet-400/40",
  UNPAID_LEAVE:
    "bg-amber-500/10 text-amber-700 ring-1 ring-inset ring-amber-500/30 dark:text-amber-300 dark:ring-amber-400/40",
  ABSENT:
    "bg-rose-500/10 text-rose-700 ring-1 ring-inset ring-rose-500/30 dark:text-rose-300 dark:ring-rose-400/40",
  HOLIDAY:
    "bg-cyan-500/10 text-cyan-700 ring-1 ring-inset ring-cyan-500/30 dark:text-cyan-300 dark:ring-cyan-400/40",
  WEEKLY_OFF: "bg-muted/40 text-muted-foreground ring-1 ring-inset ring-border",
}

/** Fırça seçicideki yuvarlak örnek. */
export const DEVAM_DOT_CLASS: Record<DevamStatus, string> = {
  WORKED: "bg-kobipo-green dark:bg-emerald-500",
  HALF_DAY: "bg-teal-500 dark:bg-teal-400",
  PAID_LEAVE: "bg-kobipo-blue dark:bg-primary",
  SICK: "bg-violet-600 dark:bg-violet-500",
  UNPAID_LEAVE: "bg-amber-500 dark:bg-amber-400",
  ABSENT: "bg-rose-500 dark:bg-rose-400",
  HOLIDAY: "bg-cyan-600 dark:bg-cyan-400",
  WEEKLY_OFF: "bg-muted-foreground/40",
}
