// Kroki öğelerinin ve masa durumlarının GÖRÜNÜŞÜ — tek kaynak.
//
// Tuval (floor-plan-canvas) ile araç çubuğu (floor-plan-screen) aynı listeden
// beslenir: ikisi kendi listesini tutsaydı araç çubuğuna eklenen bir öğe türü
// tuvalde varsayılan görünüme düşerdi (sessizce yanlış çizim).

import {
  Armchair,
  CalendarClock,
  ChefHat,
  Coffee,
  DoorOpen,
  Leaf,
  Receipt,
  Snowflake,
  Sparkles,
  Square,
  Speaker,
  StretchHorizontal,
  Type,
  type LucideIcon,
} from "lucide-react"
import type { PlanTable } from "@/lib/swr/use-restoran"

export interface PlanKindDef {
  kind: string
  label: string
  icon: LucideIcon
  className: string
  /** Etiketsiz öğede (duvar, bitki) tür adı yazılmaz — kroki okunmaz hale gelir. */
  showLabel: boolean
}

export const PLAN_KINDS: PlanKindDef[] = [
  {
    kind: "WALL",
    label: "Duvar",
    icon: StretchHorizontal,
    className: "bg-foreground/75 border-foreground/75 text-background",
    showLabel: false,
  },
  {
    kind: "DOOR",
    label: "Kapı",
    icon: DoorOpen,
    className: "border-dashed border-foreground/50 bg-background text-foreground/70",
    showLabel: true,
  },
  {
    kind: "BAR",
    label: "Bar",
    icon: Coffee,
    className:
      "border-amber-500/70 bg-amber-200/50 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200",
    showLabel: true,
  },
  {
    kind: "KITCHEN",
    label: "Mutfak",
    icon: ChefHat,
    className: "border-muted-foreground/30 bg-muted text-muted-foreground",
    showLabel: true,
  },
  {
    kind: "WC",
    label: "WC",
    icon: Square,
    className:
      "border-sky-500/50 bg-sky-100/60 text-sky-900 dark:bg-sky-900/30 dark:text-sky-200",
    showLabel: true,
  },
  {
    kind: "STAIRS",
    label: "Merdiven",
    icon: StretchHorizontal,
    className:
      "border-muted-foreground/40 bg-[repeating-linear-gradient(45deg,hsl(var(--muted))_0_8px,transparent_8px_16px)] text-muted-foreground",
    showLabel: true,
  },
  {
    kind: "PLANT",
    label: "Bitki",
    icon: Leaf,
    className:
      "rounded-full border-emerald-500/60 bg-emerald-100/70 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200",
    showLabel: false,
  },
  {
    kind: "SOFA",
    label: "Sedir",
    icon: Armchair,
    className:
      "border-orange-400/60 bg-orange-100/60 text-orange-900 dark:bg-orange-900/25 dark:text-orange-200",
    showLabel: false,
  },
  {
    kind: "FRIDGE",
    label: "Dolap",
    icon: Snowflake,
    className:
      "border-cyan-500/50 bg-cyan-100/50 text-cyan-900 dark:bg-cyan-900/25 dark:text-cyan-200",
    showLabel: true,
  },
  {
    kind: "STAGE",
    label: "Sahne",
    icon: Speaker,
    className:
      "border-violet-500/50 bg-violet-100/50 text-violet-900 dark:bg-violet-900/25 dark:text-violet-200",
    showLabel: true,
  },
  {
    kind: "TEXT",
    label: "Yazı",
    icon: Type,
    className: "border-transparent bg-transparent text-muted-foreground",
    showLabel: true,
  },
]

export const kindDef = (kind: string): PlanKindDef =>
  PLAN_KINDS.find((k) => k.kind === kind) ?? PLAN_KINDS[0]

/** Araç çubuğunda masa da bir "araç"tır; kroki türleriyle aynı jesti paylaşır. */
export const TABLE_TOOL = "TABLE"

// ---- Masa durumu ------------------------------------------------------------

export type TableState = "FREE" | "OPEN" | "BILL" | "CLEANING" | "RESERVED"

/**
 * Masanın planda görüneceği durum. Sıra ÖNEMLİ: hesap istendi doluluğun önüne
 * geçer (garson önce oraya gitmeli), temizlik ve rezervasyon ancak masa boşken
 * anlamlıdır — üzerinde adisyon varken "rezerve" yazmak yanıltıcı olurdu.
 */
export function tableState(table: PlanTable): TableState {
  if (table.openTicket) return table.openTicket.billRequestedAt ? "BILL" : "OPEN"
  if (table.cleaningSince) return "CLEANING"
  if (table.reservation) return "RESERVED"
  return "FREE"
}

export const TABLE_STATE_STYLE: Record<TableState, { className: string; label: string }> = {
  FREE: {
    className:
      "border-dashed border-border bg-card hover:border-kobipo-blue hover:bg-kobipo-blue/5 dark:hover:border-primary",
    label: "Boş",
  },
  OPEN: {
    className: "border-kobipo-blue bg-kobipo-blue/10 dark:border-primary dark:bg-primary/15",
    label: "Dolu",
  },
  BILL: {
    className:
      "border-orange-500 bg-orange-100/80 text-orange-950 dark:border-orange-400 dark:bg-orange-500/20 dark:text-orange-50",
    label: "Hesap istendi",
  },
  CLEANING: {
    className:
      "border-slate-400 border-dashed bg-slate-200/70 text-slate-700 dark:border-slate-500 dark:bg-slate-700/40 dark:text-slate-200",
    label: "Temizlenecek",
  },
  RESERVED: {
    className:
      "border-violet-500 border-dashed bg-violet-100/70 text-violet-900 dark:border-violet-400 dark:bg-violet-500/15 dark:text-violet-100",
    label: "Rezerve",
  },
}

export const TABLE_STATE_ICON: Record<TableState, LucideIcon | null> = {
  FREE: null,
  OPEN: null,
  BILL: Receipt,
  CLEANING: Sparkles,
  RESERVED: CalendarClock,
}
