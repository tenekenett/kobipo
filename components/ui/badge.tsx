import type { ReactNode } from "react"

type KobipoBadgeVariant = "aktif" | "odendi" | "bekliyor" | "gecikti"

type BadgeVariant =
  | KobipoBadgeVariant
  | "default"
  | "secondary"
  | "destructive"
  | "outline"

const styles: Record<KobipoBadgeVariant, { wrap: string; dot: string; label: string }> = {
  aktif: { wrap: "bg-kobipo-pale text-kobipo-blue", dot: "bg-kobipo-blue", label: "Aktif" },
  odendi: {
    wrap: "bg-kobipo-green-light text-kobipo-green-dark",
    dot: "bg-kobipo-green",
    label: "Ödendi",
  },
  bekliyor: { wrap: "bg-amber-50 text-amber-700", dot: "bg-amber-400", label: "Bekliyor" },
  gecikti: { wrap: "bg-red-50 text-red-700", dot: "bg-red-500", label: "Gecikmiş" },
}

type BadgeProps = {
  variant: BadgeVariant
  children?: ReactNode
}

const fallbackStyles: Record<"default" | "secondary" | "destructive" | "outline", string> = {
  default: "bg-kobipo-pale text-kobipo-blue",
  secondary: "bg-kobipo-offwhite text-kobipo-gray border border-kobipo-border",
  destructive: "bg-red-50 text-red-700",
  outline: "border border-kobipo-border text-kobipo-text",
}

export function Badge({ variant, children }: BadgeProps) {
  if (variant === "default" || variant === "secondary" || variant === "destructive" || variant === "outline") {
    return (
      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${fallbackStyles[variant]}`}>
        {children}
      </span>
    )
  }

  const s = styles[variant]
  return (
    <span
      className={`
      inline-flex items-center gap-1.5
      px-2.5 py-0.5 rounded-full
      text-[11px] font-semibold
      ${s.wrap}
    `}
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${s.dot}`} />
      {children ?? s.label}
    </span>
  )
}

