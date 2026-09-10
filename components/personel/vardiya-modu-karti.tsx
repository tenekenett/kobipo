"use client"

/**
 * Firma ayarlarındaki "çalışma düzeni" kartı — kipin kalıcı yeri.
 *
 * Aynı soruyu personel modülünün ilk açılışında kurulum penceresi de sorar
 * (components/personel/vardiya-kurulum-dialog.tsx); orada verilen cevap buraya
 * yazılır ve buradan her zaman değiştirilebilir. Ayarın firma ayarlarında
 * durmasının sebebi kullanıcının onu ARAYACAĞI yer olması: "vardiya takvimi
 * neden kayboldu" sorusunun cevabı personel ekranlarının içinde saklı kalmamalı.
 *
 * Kip değiştirmek VERİ SİLMEZ: yazılmış vardiyalar ve devam kayıtları yerinde
 * kalır, yalnız menüde hangi takvimin duracağı değişir. Bu ekranda yazılı olması
 * önemli — aksi halde kullanıcı geri dönüşü olmayan bir seçim sanıp hiç
 * denemiyor.
 *
 * KARMA seçildiğinde bu kart kimin nerede olduğunu SÖYLEMEZ; o karar personel
 * kartındadır (`Employee.usesShifts`). Kart yalnız hangi takvimlerin var
 * olduğunu belirler.
 */

import { useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { WriteAction } from "@/components/dashboard/write-guard"
import { useToast } from "@/components/ui/use-toast"
import { useDashboardCompany } from "@/components/dashboard/dashboard-company-provider"
import { CalendarClock, CalendarDays, Check, Loader2, Shuffle } from "lucide-react"
import { cn } from "@/lib/utils"
import { MODE_LABEL, normalizeMode, type WorkScheduleMode } from "@/lib/personel/kip"

export function VardiyaModuKarti({ companyId }: { companyId: string | null }) {
  const { selectedCompany, fetchCompanies } = useDashboardCompany()
  const { toast } = useToast()
  const [value, setValue] = useState<WorkScheduleMode | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  // Seçili firma bağlamdan gelebilir; gelmezse (doğrudan link, tazelenmemiş liste)
  // uçtan okunur. İki kaynak da yoksa kart "seçilmemiş" durumunda çizilir.
  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!companyId) return
      if (selectedCompany?.id === companyId && selectedCompany.workScheduleMode !== undefined) {
        setValue(normalizeMode(selectedCompany.workScheduleMode))
        setIsLoading(false)
        return
      }
      try {
        const res = await fetch(`/api/personel/ayarlar?companyId=${companyId}`)
        if (res.ok && !cancelled) {
          const data = await res.json()
          setValue(normalizeMode(data.workScheduleMode))
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [companyId, selectedCompany?.id, selectedCompany?.workScheduleMode])

  async function save(next: WorkScheduleMode) {
    if (!companyId || next === value) return
    setIsSaving(true)
    try {
      const res = await fetch("/api/personel/ayarlar", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, workScheduleMode: next }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast({
          title: "Kaydedilemedi",
          description: data?.error || "Ayar yazılamadı.",
          variant: "destructive",
        })
        return
      }
      setValue(next)
      // Menü kipi firma listesinden çizilir; tazelenmezse kullanıcı sayfayı elle
      // yenileyene kadar eski takvimi görür.
      await fetchCompanies()
      toast({
        title: `Çalışma düzeni: ${MODE_LABEL[next]}`,
        description:
          next === "MIXED"
            ? "İki takvim de menüde. Kimin hangi takvimde olduğunu personel kartından seçin."
            : "Personel menüsü buna göre güncellendi.",
      })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Çalışma Düzeni</CardTitle>
        <CardDescription>
          Personel menüsünde hangi takvimin görüneceğini belirler. Değiştirmek girilmiş
          vardiya veya devam kayıtlarını silmez.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Yükleniyor…</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-3">
            <ModKart
              secili={value === "SHIFT"}
              disabled={isSaving}
              onSelect={() => save("SHIFT")}
              icon={<CalendarClock className="h-5 w-5" />}
              baslik="Vardiyalı çalışıyoruz"
              aciklama="Saatli vardiya takvimi: şablonlar, fazla mesai ve gecikme takibi."
            />
            <ModKart
              secili={value === "FLAT"}
              disabled={isSaving}
              onSelect={() => save("FLAT")}
              icon={<CalendarDays className="h-5 w-5" />}
              baslik="Herkes aynı saatlerde"
              aciklama="Devam takvimi: haftalık çalıştı/izinli işaretlemesi, bordroya gün kesintisi."
            />
            <ModKart
              secili={value === "MIXED"}
              disabled={isSaving}
              onSelect={() => save("MIXED")}
              icon={<Shuffle className="h-5 w-5" />}
              baslik="Bir kısmı vardiyalı"
              aciklama="İki takvim de açılır; kimin hangi takvimde olduğu personel kartında seçilir."
            />
          </div>
        )}
        {!isLoading && value === null && (
          <p className="mt-3 text-xs text-muted-foreground">
            Henüz seçim yapılmadı; şimdilik vardiya takvimi gösteriliyor.
          </p>
        )}
        {!isLoading && value === "MIXED" && (
          <p className="mt-3 text-xs text-muted-foreground">
            Personel kartında düzen seçilmeyen çalışanlar <strong>vardiyalı</strong> sayılır.
          </p>
        )}
        {isSaving && (
          <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Kaydediliyor…
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function ModKart({
  secili,
  disabled,
  onSelect,
  icon,
  baslik,
  aciklama,
}: {
  secili: boolean
  disabled: boolean
  onSelect: () => void
  icon: React.ReactNode
  baslik: string
  aciklama: string
}) {
  return (
    <WriteAction>
      <Button
        type="button"
        variant="ghost"
        onClick={onSelect}
        disabled={disabled}
        className={cn(
          "h-auto w-full flex-col items-start gap-1.5 whitespace-normal rounded-xl border p-4 text-left",
          secili
            ? "border-kobipo-blue bg-kobipo-blue/5 ring-1 ring-kobipo-blue hover:bg-kobipo-blue/10"
            : "border-border hover:border-kobipo-blue/50",
        )}
      >
        <span className="flex w-full items-center gap-2 font-semibold">
          <span className={cn(secili ? "text-kobipo-blue" : "text-muted-foreground")}>{icon}</span>
          {baslik}
          {secili && <Check className="ml-auto h-4 w-4 text-kobipo-blue" />}
        </span>
        <span className="text-xs font-normal text-muted-foreground">{aciklama}</span>
      </Button>
    </WriteAction>
  )
}
