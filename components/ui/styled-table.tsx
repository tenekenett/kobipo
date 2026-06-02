"use client"

import * as React from "react"
import { Building2, User } from "lucide-react"
import { cn } from "@/lib/utils"
import { TableRow, TableHead, TableCell } from "@/components/ui/table"

export function StyledTableContainer({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("overflow-x-auto rounded-md border", className)}>{children}</div>
  )
}

export const StyledTableHeaderRow = React.forwardRef<
  HTMLTableRowElement,
  React.HTMLAttributes<HTMLTableRowElement>
>(({ className, ...props }, ref) => (
  <TableRow
    ref={ref}
    className={cn(
      "bg-kobipo-blue hover:bg-kobipo-blue dark:bg-kobipo-navy dark:hover:bg-kobipo-navy",
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
