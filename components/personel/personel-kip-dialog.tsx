"use client"

/**
 * Takvimden personelin çalışma düzenini değiştirme.
 *
 * NEDEN TAKVİMDE: "bu kişi neden burada / neden burada değil" sorusu takvime
 * bakarken doğuyor. Ayarı yalnız personel kartına koymak, kullanıcıyı ekran
 * değiştirip kartı bulup Düzenle'ye basmaya zorluyordu — kimin nerede olduğunu
 * gördüğü yerde düzeltebilmeli. Personel kartındaki seçim de duruyor; ikisi aynı
 * alanı (`Employee.usesShifts`) yazar.
 *
 * Kip değiştirmek VERİ SİLMEZ: kişinin yazılmış vardiyaları ve devam kayıtları
 * yerinde kalır, yalnız hangi takvimde göründüğü (ve ayın hangi özetten
 * bordroya gittiği) değişir.
 */

import { useEffect, useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { CalendarClock, CalendarDays, Check, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  attendanceCalendarEnabled,
  defaultUsesShifts,
  normalizeMode,
  shiftCalendarEnabled,
} from "@/lib/personel/kip"

export type KipHedefi = {
  id: string
  name: string
  /** Kişinin mevcut seçimi; null = firmanın düzeni. */
  usesShifts?: boolean | null
}

type Secim = "DEFAULT" | "SHIFT" | "FLAT"

export function PersonelKipDialog({
  hedef,
  companyMode,
  isSaving,
  onClose,
  onSave,
}: {
  hedef: KipHedefi | null
  /** `Company.workScheduleMode` — varsayılanın hangi tarafa düştüğünü yazmak için. */
  companyMode: string | null | undefined
  isSaving: boolean
  onClose: () => void
  /**
   * `karmaYap`: seçilen taraf firmanın düzeninde YOKSA (ör. vardiyalı firmada
   * sabit mesai) firma karmaya alınmalıdır — yoksa o takvim menüde olmadığı için
   * kişinin günleri hiçbir yerde işaretlenemez, kişi ekransız kalır.
   */
  onSave: (employeeId: string, usesShifts: boolean | null, karmaYap: boolean) => void
}) {
  const [secim, setSecim] = useState<Secim>("DEFAULT")

  useEffect(() => {
    if (!hedef) return
    setSecim(hedef.usesShifts === true ? "SHIFT" : hedef.usesShifts === false ? "FLAT" : "DEFAULT")
  }, [hedef])

  if (!hedef) return null

  const mode = normalizeMode(companyMode)
  const varsayilan = defaultUsesShifts(mode) ? "Vardiyalı" : "Sabit mesai"
  const degeri = (s: Secim): boolean | null => (s === "SHIFT" ? true : s === "FLAT" ? false : null)

  // Seçilen tarafın takvimi firmada açık mı? Kapalıysa firma karmaya alınacak.
  const secilen = degeri(secim)
  const karmaGerekli =
    (secilen === false && !attendanceCalendarEnabled(mode)) ||
    (secilen === true && !shiftCalendarEnabled(mode))

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Çalışma düzeni — {hedef.name}</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          Bu çalışanın hangi takvimde görüneceğini belirler. Değiştirmek girilmiş vardiya
          veya devam kayıtlarını silmez.
        </p>

        <div className="space-y-2">
          <KipSecenek
            secili={secim === "SHIFT"}
            onSelect={() => setSecim("SHIFT")}
            icon={<CalendarClock className="h-4 w-4" />}
            baslik="Vardiyalı"
            aciklama="Vardiya takviminde saatli plan yapılır."
          />
          <KipSecenek
            secili={secim === "FLAT"}
            onSelect={() => setSecim("FLAT")}
            icon={<CalendarDays className="h-4 w-4" />}
            baslik="Sabit mesai"
            aciklama="Devam takviminde çalıştı/izinli olarak işaretlenir."
          />
          <KipSecenek
            secili={secim === "DEFAULT"}
            onSelect={() => setSecim("DEFAULT")}
            icon={<span className="text-xs font-bold">≡</span>}
            baslik={`Firma varsayılanı (${varsayilan})`}
            aciklama="Firma ayarı değişirse bu çalışan da onunla birlikte taşınır."
          />
        </div>

        {karmaGerekli && (
          <p className="rounded-lg border border-dashed border-kobipo-blue/40 bg-kobipo-blue/5 p-3 text-xs text-muted-foreground">
            Firmanızın çalışma düzeni şu an{" "}
            <strong>{mode === "FLAT" ? "Herkes aynı saatlerde" : "Vardiyalı"}</strong>, yani{" "}
            {secilen === false ? "devam takvimi" : "vardiya takvimi"} menüde değil. Kaydedince
            firma <strong>&quot;Bir kısmı vardiyalı&quot;</strong> düzenine alınacak ve iki takvim de
            açılacak — yoksa bu çalışanın günleri hiçbir ekranda işaretlenemezdi.
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={isSaving}>
            Vazgeç
          </Button>
          <Button onClick={() => onSave(hedef.id, secilen, karmaGerekli)} disabled={isSaving}>
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Kaydet
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function KipSecenek({
  secili,
  onSelect,
  icon,
  baslik,
  aciklama,
}: {
  secili: boolean
  onSelect: () => void
  icon: React.ReactNode
  baslik: string
  aciklama: string
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex w-full items-start gap-2.5 rounded-lg border p-3 text-left transition",
        secili
          ? "border-kobipo-blue bg-kobipo-blue/5 ring-1 ring-kobipo-blue"
          : "border-border hover:border-kobipo-blue/50 hover:bg-muted/40",
      )}
    >
      <span className={cn("mt-0.5", secili ? "text-kobipo-blue" : "text-muted-foreground")}>
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{baslik}</span>
        <span className="block text-xs text-muted-foreground">{aciklama}</span>
      </span>
      {secili && <Check className="mt-0.5 h-4 w-4 shrink-0 text-kobipo-blue" />}
    </button>
  )
}
