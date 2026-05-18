import Link from "next/link"
import { ArrowLeft, Construction, Sparkles, type LucideIcon } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"

interface ComingSoonProps {
  title: string
  description?: string
  icon?: LucideIcon
  expected?: string
  features?: string[]
  backHref?: string
}

export function ComingSoon({
  title,
  description,
  icon: Icon = Construction,
  expected,
  features,
  backHref = "/dashboard",
}: ComingSoonProps) {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link
          href={backHref}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Geri
        </Link>
      </div>

      <Card className="overflow-hidden">
        <div className="bg-gradient-to-br from-kobipo-pale/60 to-transparent p-8 dark:from-primary/10">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-kobipo-blue/10 text-kobipo-blue dark:bg-primary/15 dark:text-primary">
              <Icon className="h-6 w-6" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-bold text-kobipo-navy dark:text-foreground">{title}</h1>
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                  <Sparkles className="h-3 w-3" />
                  Yakında
                </span>
              </div>
              {description && (
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</p>
              )}
              {expected && (
                <p className="mt-3 text-xs font-medium text-muted-foreground">
                  Tahmini yayınlanma: <span className="text-foreground">{expected}</span>
                </p>
              )}
            </div>
          </div>
        </div>
        {features && features.length > 0 && (
          <CardContent className="space-y-3 border-t pt-6">
            <p className="text-sm font-semibold text-foreground">Bu modülde olacaklar</p>
            <ul className="space-y-2">
              {features.map((feature) => (
                <li
                  key={feature}
                  className="flex items-start gap-2.5 text-sm text-muted-foreground"
                >
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-kobipo-blue/60 dark:bg-primary/60" />
                  {feature}
                </li>
              ))}
            </ul>
          </CardContent>
        )}
        <CardContent className="flex flex-wrap items-center justify-between gap-3 border-t bg-muted/30 py-4">
          <p className="text-xs text-muted-foreground">
            Bu modül henüz aktif değil. Mevcut özelliklerle çalışmaya devam edebilirsiniz.
          </p>
          <Link href={backHref}>
            <Button variant="outline" size="sm">
              Dashboard'a dön
            </Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  )
}
