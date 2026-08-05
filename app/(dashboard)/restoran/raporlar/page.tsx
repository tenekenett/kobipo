"use client"

// Restoran & Kafe raporları — hepsi tek sayfada, sekmeli.
//
// Eskiden dört ayrı sayfaydı ve menüde dört satır kaplıyordu; her biri KENDİ
// tarih aralığını tuttuğu için "bu ay"ı seçip menü performansından karlılığa
// geçince seçim sıfırlanıyordu. Aralık artık burada, bir kez yaşıyor.
//
// İki ayrı aralık bilinçli: üç rapor tarih ARALIĞI ile çalışıyor, gün sonu ise
// tek GÜN ile (kasa sayımı bir güne aittir). Ortak tek aralık kullansaydık gün
// sonu sekmesine geçmek diğerlerinin seçimini bozardı.

import { Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { BarChart3, ClipboardList, LayoutGrid, Package, ShieldAlert, TrendingUp } from "lucide-react"
import { RangeBar, useReportRange } from "@/components/restoran/report-ui"
import { KarlilikReport } from "@/components/restoran/reports/karlilik"
import { MenuPerformansReport } from "@/components/restoran/reports/menu-performans"
import { TuketimReport } from "@/components/restoran/reports/tuketim"
import { MasalarReport } from "@/components/restoran/reports/masalar"
import { GunSonuReport } from "@/components/restoran/reports/gun-sonu"
import { DenetimReport } from "@/components/restoran/reports/denetim"
import { cn } from "@/lib/utils"

const TABS = [
  { key: "karlilik", label: "Karlılık", icon: TrendingUp },
  { key: "menu", label: "Menü Performansı", icon: BarChart3 },
  { key: "tuketim", label: "Hammadde Tüketimi", icon: Package },
  { key: "masalar", label: "Masalar", icon: LayoutGrid },
  { key: "denetim", label: "İkram & Denetim", icon: ShieldAlert },
  { key: "gun-sonu", label: "Gün Sonu", icon: ClipboardList },
] as const

type TabKey = (typeof TABS)[number]["key"]

const isTabKey = (v: string | null): v is TabKey => TABS.some((t) => t.key === v)

function RaporlarContent() {
  const router = useRouter()
  const searchParams = useSearchParams()

  // Sekme URL'de durur: paylaşılabilir link, çalışan geri tuşu, yenilemede kayıp yok.
  const raw = searchParams.get("rapor")
  const active: TabKey = isTabKey(raw) ? raw : "karlilik"

  const range = useReportRange("week")
  const day = useReportRange("today")

  const selectTab = (key: TabKey) => {
    const next = new URLSearchParams(searchParams.toString())
    next.set("rapor", key)
    router.replace(`?${next.toString()}`, { scroll: false })
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-3xl font-bold">Restoran Raporları</h1>
        <p className="text-muted-foreground">
          Karlılık, menü performansı, hammadde tüketimi, masa doluluğu ve gün sonu — tek yerde.
        </p>
      </div>

      <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
        {TABS.map((t) => {
          const Icon = t.icon
          const isActive = t.key === active
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => selectTab(t.key)}
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold transition-colors",
                isActive
                  ? "bg-kobipo-blue text-white dark:bg-primary dark:text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/70"
              )}
            >
              <Icon className="h-4 w-4" />
              {t.label}
            </button>
          )
        })}
      </div>

      {/* Gün sonu kendi gün gezgini taşıyor (önceki/sonraki gün); aralık çubuğu
          yalnız diğer üçünde anlamlı. */}
      {active !== "gun-sonu" && <RangeBar range={range} />}

      {active === "karlilik" && <KarlilikReport range={range} />}
      {active === "menu" && <MenuPerformansReport range={range} />}
      {active === "tuketim" && <TuketimReport range={range} />}
      {active === "masalar" && <MasalarReport range={range} />}
      {active === "denetim" && <DenetimReport range={range} />}
      {active === "gun-sonu" && <GunSonuReport range={day} />}
    </div>
  )
}

export default function RestoranRaporlarPage() {
  // useSearchParams istemci bileşenini prerender sırasında askıya alır.
  return (
    <Suspense fallback={<div className="py-10 text-center text-muted-foreground">Yükleniyor…</div>}>
      <RaporlarContent />
    </Suspense>
  )
}
