"use client"

import * as React from "react"
import { Building2, User } from "lucide-react"
import { cn } from "@/lib/utils"
import { TableRow, TableHead, TableCell } from "@/components/ui/table"

export function StyledTableContainer({
  children,
  className,
  stickyFirstColumn = true,
}: {
  children: React.ReactNode
  className?: string
  /** Mobilde (max-md) ilk sütunu sabitler. Kimlik sütunu olmayan tablolarda kapatılabilir. */
  stickyFirstColumn?: boolean
}) {
  return (
    <div className="relative">
      <div
        className={cn(
          "overflow-x-auto rounded-md border",
          // Yalnız-mobil sticky ilk sütun. bg-inherit, satırın şerit/başlık rengini
          // devralır → sticky hücre arkası opak kalır. md+ ekranda hiç devreye girmez.
          stickyFirstColumn &&
            "max-md:[&_tr>*:first-child]:sticky max-md:[&_tr>*:first-child]:left-0 max-md:[&_tr>*:first-child]:z-20 max-md:[&_tr>*:first-child]:bg-inherit",
          className,
        )}
      >
        {children}
      </div>
      {/* Mobilde sağ kenarda "kaydırılabilir" ipucu; md+ ekranda gizli. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-px right-px w-8 rounded-r-md bg-gradient-to-l from-background to-transparent md:hidden"
      />
    </div>
  )
}

export const StyledTableHeaderRow = React.forwardRef<
  HTMLTableRowElement,
  React.HTMLAttributes<HTMLTableRowElement>
>(({ className, ...props }, ref) => (
  <TableRow
    ref={ref}
    className={cn(
      "bg-kobipo-blue hover:bg-kobipo-blue dark:bg-[#122544] dark:hover:bg-[#122544]",
      className,
    )}
    {...props}
  />
))
StyledTableHeaderRow.displayName = "StyledTableHeaderRow"

export const StyledTableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <TableHead
    ref={ref}
    className={cn(
      "h-11 text-xs font-semibold uppercase tracking-wider text-white dark:text-kobipo-text",
      className,
    )}
    {...props}
  />
))
StyledTableHead.displayName = "StyledTableHead"

export interface StyledTableRowProps
  extends React.HTMLAttributes<HTMLTableRowElement> {
  index?: number
}

export const StyledTableRow = React.forwardRef<HTMLTableRowElement, StyledTableRowProps>(
  ({ index = 0, className, ...props }, ref) => {
    // Şerit kontrastı: açık temada slate-100 net görünüyor, koyu temada bg-muted
    // tam tonlu — kart arka planı 11% lightness, muted 18% → 7 puanlık fark satırı
    // belirgin yapıyor.
    const stripe = index % 2 === 0 ? "bg-card" : "bg-slate-100 dark:bg-muted"
    return (
      <TableRow
        ref={ref}
        className={cn(
          stripe,
          "border-b border-border/60 transition-colors hover:bg-kobipo-pale/70 dark:hover:bg-kobipo-blue/25 [&>td]:py-3.5",
          className,
        )}
        {...props}
      />
    )
  },
)
StyledTableRow.displayName = "StyledTableRow"

export function EntityCell({
  name,
  type = "company",
  className,
  maxWidth = 320,
}: {
  name?: string | null
  type?: "company" | "person"
  className?: string
  maxWidth?: number
}) {
  const Icon = type === "person" ? User : Building2
  const hasName = !!(name && name.trim().length > 0)
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Icon className="h-4 w-4 shrink-0 text-kobipo-blue/70 dark:text-kobipo-mid/80" />
      <span
        className={cn(
          "truncate font-semibold",
          hasName ? "text-foreground" : "text-muted-foreground",
        )}
        style={{ maxWidth: `${maxWidth}px` }}
        title={name ?? ""}
      >
        {hasName ? name : "-"}
      </span>
    </div>
  )
}

export function MonoCell({
  value,
  className,
}: {
  value?: string | null
  className?: string
}) {
  const hasValue = !!(value && value.trim().length > 0)
  return (
    <span
      className={cn(
        "font-mono text-xs tabular-nums",
        hasValue ? "text-muted-foreground" : "text-muted-foreground/60",
        className,
      )}
    >
      {hasValue ? value : "-"}
    </span>
  )
}
