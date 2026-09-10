"use client"

/**
 * Personel modülünün KURULUM sorusu: bu işletme nasıl çalışıyor?
 *
 * NEDEN SORULUYOR: vardiya takvimi saatli bir ızgaradır ve her gün aynı saatte
 * gelen bir ekipte anlamsızdır — kullanıcı 08:00–17:00'yi otuz kez çizmek zorunda
 * kalıyor, takvim de "kim ne zaman" diye kimsenin sormadığı bir soruyu cevaplıyor.
 * Cevaba göre menüde vardiya takvimi, devam takvimi ya da (karma işletmede)
 * ikisi birden durur.
 *
 * ÜÇÜNCÜ SEÇENEK ŞART: gerçek işletmelerin bir kısmı karmadır — kafenin servisi
 * vardiyalı, muhasebesi sabit mesai. İki seçenek dayatıldığında bir grup her
 * hâlükârda yanlış ekrana düşüyordu.
 *
 * SORU BİR KEZ SORULUR: cevap `Company.workScheduleMode`a yazılır ve firma
 * ayarlarından her zaman değiştirilebilir. "Sonra karar veririm" seçeneği bilerek
 * var — kararsız kullanıcıyı bir kipe hapsetmek, yanlış kipte kurulmuş bir
 * takvimden daha kötü. O durumda bugünkü davranış (vardiya takvimi) sürer ve soru
 * bir sonraki girişte yeniden çıkar.
 */

import { useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { CalendarClock, CalendarDays, Check, Loader2, Shuffle } from "lucide-react"
import { cn } from "@/lib/utils"
import type { WorkScheduleMode } from "@/lib/personel/kip"

export function VardiyaKurulumDialog({
  open,
  isSaving,
  onSkip,
  onSave,
}: {
  open: boolean
  isSaving: boolean
  onSkip: () => void
  onSave: (mode: WorkScheduleMode) => void
}) {
  const [secim, setSecim] = useState<WorkScheduleMode | null>(null)

  if (!open) return null

  return (
    <Dialog open onOpenChange={(o) => !o && onSkip()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Personel modülü kurulumu</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          İşletmenizde çalışma saatleri kişiden kişiye veya günden güne değişiyor mu?
          Cevabınıza göre size uygun takvimi göstereceğiz.
        </p>

        <div className="grid gap-3 sm:grid-cols-3">
          <KurulumKart
            secili={secim === "SHIFT"}
            onSelect={() => setSecim("SHIFT")}
            icon={<CalendarClock className="h-5 w-5" />}
            baslik="Evet, vardiyalı çalışıyoruz"
            aciklama="Sabahçı/akşamcı, dönüşümlü mesai, farklı saatlerde başlayan personel."
            sonuc="Vardiya Takvimi — saatli ızgara, şablonlar, fazla mesai ve gecikme takibi."
          />
          <KurulumKart
            secili={secim === "FLAT"}
            onSelect={() => setSecim("FLAT")}
            icon={<CalendarDays className="h-5 w-5" />}
            baslik="Hayır, herkes aynı saatlerde"
            aciklama="Sabit mesai; takip edilen tek şey kimin geldiği, kimin izinli olduğu."
            sonuc="Devam Takvimi — haftalık çalıştı/izinli işaretlemesi, bordroya gün kesintisi."
          />
          <KurulumKart
            secili={secim === "MIXED"}
            onSelect={() => setSecim("MIXED")}
            icon={<Shuffle className="h-5 w-5" />}
            baslik="Bir kısmı vardiyalı"
            aciklama="Örneğin servis ekibi vardiyalı, ofis/muhasebe sabit mesai."
            sonuc="Her iki takvim de açılır; personel kartından kimin nerede olduğunu seçersiniz."
          />
        </div>

        <p className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
          Bu ayarı istediğiniz zaman <strong>Ayarlar → Firma Bilgileri</strong> altından
          değiştirebilirsiniz. Kip değiştirmek girilmiş kayıtları silmez.
        </p>

        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={onSkip} disabled={isSaving}>
            Sonra karar vereyim
          </Button>
          <Button onClick={() => secim && onSave(secim)} disabled={!secim || isSaving}>
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Devam et
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function KurulumKart({
  secili,
  onSelect,
  icon,
  baslik,
  aciklama,
  sonuc,
}: {
  secili: boolean
  onSelect: () => void
  icon: React.ReactNode
  baslik: string
  aciklama: string
  sonuc: string
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex h-full flex-col gap-2 rounded-xl border p-4 text-left transition",
        secili
          ? "border-kobipo-blue bg-kobipo-blue/5 ring-1 ring-kobipo-blue"
          : "border-border hover:border-kobipo-blue/50 hover:bg-muted/40",
      )}
    >
      <span className="flex items-center gap-2 font-semibold">
        <span className={cn(secili ? "text-kobipo-blue" : "text-muted-foreground")}>{icon}</span>
        {baslik}
        {secili && <Check className="ml-auto h-4 w-4 text-kobipo-blue" />}
      </span>
      <span className="text-xs text-muted-foreground">{aciklama}</span>
      <span className="mt-auto text-xs font-medium text-foreground/80">{sonuc}</span>
    </button>
  )
}
