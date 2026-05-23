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
    className={cn("text-white dark:text-kobipo-text", className)}
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
    const stripe = index % 2 === 0 ? "bg-card" : "bg-muted/40"
    return (
      <TableRow
        ref={ref}
        className={cn(
          stripe,
          "hover:bg-kobipo-pale/60 dark:hover:bg-kobipo-blue/20",
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
  maxWidth = 260,
}: {
  name?: string | null
  type?: "company" | "person"
  className?: string
  maxWidth?: number
}) {
  const Icon = type === "person" ? User : Building2
  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <Icon className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
      <span
        className="truncate"
        style={{ maxWidth: `${maxWidth}px` }}
        title={name ?? ""}
      >
        {name && name.trim().length > 0 ? name : "-"}
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
  return (
    <span className={cn("font-mono text-xs", className)}>
      {value && value.trim().length > 0 ? value : "-"}
    </span>
  )
}
