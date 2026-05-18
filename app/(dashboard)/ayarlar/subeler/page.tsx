"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ArrowRight, Building2, CheckCircle2, Plus } from "lucide-react"

interface Company {
  id: string
  name: string
  isEDonusumEnabled?: boolean
}

export default function SubelerPage() {
  const searchParams = useSearchParams()
  const activeCompanyId = searchParams.get("company")
  const [companies, setCompanies] = useState<Company[]>([])
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    fetch("/api/companies", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : []))
      .then((data: Company[]) => {
        if (!cancelled) setCompanies(Array.isArray(data) ? data : [])
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-kobipo-navy dark:text-foreground">Şube Yönetimi</h1>
          <p className="text-sm text-muted-foreground">
            Erişiminiz olan tüm firma/şubeleri görüntüleyin ve yenisini ekleyin
          </p>
        </div>
        <Link href="/companies/new">
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            Yeni Şube
          </Button>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Şubeler</CardTitle>
          <CardDescription>
            {isLoading ? "Yükleniyor…" : `Toplam ${companies.length} şube`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Yükleniyor…</p>
          ) : companies.length === 0 ? (
            <div className="py-10 text-center">
              <p className="text-sm font-medium">Henüz şube yok</p>
              <p className="mt-1 text-xs text-muted-foreground">
                İlk şubenizi oluşturarak başlayın.
              </p>
              <Link href="/companies/new">
                <Button className="mt-4">
                  <Plus className="mr-2 h-4 w-4" />
                  Yeni Şube
                </Button>
              </Link>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {companies.map((c) => {
                const isActive = c.id === activeCompanyId
                return (
                  <div
                    key={c.id}
                    className="group flex items-start justify-between gap-3 rounded-xl border p-4 transition-colors hover:border-primary/40 hover:bg-muted/30"
                  >
                    <div className="flex items-start gap-3 min-w-0">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-kobipo-blue/10 text-kobipo-blue dark:bg-primary/15 dark:text-primary">
                        <Building2 className="h-5 w-5" />
                      </span>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <p className="truncate font-semibold">{c.name}</p>
                          {isActive && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                              <CheckCircle2 className="h-2.5 w-2.5" />
                              Aktif
                            </span>
                          )}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          {c.isEDonusumEnabled ? (
                            <Badge variant="aktif">E-Dönüşüm</Badge>
                          ) : (
                            <Badge variant="secondary">Standart</Badge>
                          )}
                        </div>
                      </div>
                    </div>
                    <Link
                      href={`/dashboard?company=${encodeURIComponent(c.id)}`}
                      className="shrink-0 self-center text-muted-foreground transition-colors group-hover:text-foreground"
                      aria-label="Şubeye geç"
                    >
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Şube ayarları</CardTitle>
          <CardDescription>
            Aktif şubenin detaylarını düzenlemek için Firma Bilgileri sayfasına gidin.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link
            href={activeCompanyId ? `/ayarlar/firma?company=${activeCompanyId}` : "/ayarlar/firma"}
          >
            <Button variant="outline">Firma Bilgileri</Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  )
}
