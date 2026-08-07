"use client"

/**
 * Toplu doldurma — bir şablonu seçilen personellere, seçilen günlere uygular.
 *
 * Ekran görüntüsündeki "auto fill" karşılığı. Çakışanlar ATLANIR (sunucu tarafı
 * da öyle davranıyor): amaç boş yerleri doldurmak, mevcut planı ezmek değil.
 * Kaç tanesinin atlandığı işlem sonunda söylenir.
 */

import { useEffect, useMemo, useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import { Loader2 } from "lucide-react"
import { durationLabel, minuteToHHMM, netMinutes, weekdayLabel, weekdayOf } from "@/lib/personel/vardiya"
import { SHIFT_COLOR_DOT, type ShiftColor } from "@/components/personel/shift-colors"
import type { ShiftTemplate } from "@/components/personel/sablon-dialog"

export function TopluDoldurDialog({
  open,
  templates,
  employees,
  days,
  isSaving,
  onClose,
  onApply,
  onManageTemplates,
}: {
  open: boolean
  templates: ShiftTemplate[]
  employees: { id: string; name: string }[]
  /** Doldurulabilecek günler — gün görünümünde tek gün, hafta görünümünde yedi. */
  days: string[]
  isSaving: boolean
  onClose: () => void
  onApply: (input: { templateId: string; employeeIds: string[]; days: string[] }) => void
  onManageTemplates: () => void
}) {
  const [templateId, setTemplateId] = useState("")
  const [selectedEmployees, setSelectedEmployees] = useState<string[]>([])
  const [selectedDays, setSelectedDays] = useState<string[]>([])

  useEffect(() => {
    if (!open) return
    setTemplateId(templates[0]?.id ?? "")
    setSelectedEmployees([])
    // Günler varsayılan olarak TÜMÜ seçili: pencere hafta görünümünden açıldığında
    // asıl istenen "haftayı doldur", tek tek gün işaretlemek değil.
    setSelectedDays(days)
  }, [open, templates, days])

  const template = useMemo(() => templates.find((t) => t.id === templateId), [templates, templateId])

  if (!open) return null

  const toggle = (list: string[], v: string) =>
    list.includes(v) ? list.filter((x) => x !== v) : [...list, v]

  const count = selectedEmployees.length * selectedDays.length
  const canApply = Boolean(template) && count > 0

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Şablondan doldur</DialogTitle>
        </DialogHeader>

        {templates.length === 0 ? (
          <div className="space-y-3 rounded-lg border border-dashed border-border p-6 text-center">
            <p className="text-sm text-muted-foreground">
              Önce bir vardiya şablonu tanımlayın (ör. Sabah 09:00–17:00).
            </p>
            <Button size="sm" onClick={onManageTemplates}>
              Şablon oluştur
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Şablon</Label>
              <div className="flex flex-wrap gap-2">
                {templates.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTemplateId(t.id)}
                    className={cn(
                      "flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
                      templateId === t.id
                        ? "border-kobipo-blue bg-kobipo-blue/10 text-kobipo-blue dark:border-primary dark:bg-primary/15 dark:text-primary"
                        : "border-border text-muted-foreground hover:bg-muted",
                    )}
                  >
                    <span
                      className={cn(
                        "h-2.5 w-2.5 rounded-full",
                        SHIFT_COLOR_DOT[(t.color as ShiftColor) ?? "blue"] ?? SHIFT_COLOR_DOT.blue,
                      )}
                    />
                    {t.name}
                    <span className="tabular-nums opacity-70">
                      {minuteToHHMM(t.startMinute)}–{minuteToHHMM(t.endMinute)}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>Personel</Label>
                <button
                  type="button"
                  className="text-xs text-muted-foreground underline-offset-4 hover:underline"
                  onClick={() =>
                    setSelectedEmployees(
                      selectedEmployees.length === employees.length ? [] : employees.map((e) => e.id),
                    )
                  }
                >
                  {selectedEmployees.length === employees.length ? "Hiçbiri" : "Tümü"}
                </button>
              </div>
              <div className="flex max-h-40 flex-wrap gap-2 overflow-y-auto rounded-lg border border-border/70 p-2">
                {employees.map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => setSelectedEmployees((prev) => toggle(prev, e.id))}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                      selectedEmployees.includes(e.id)
                        ? "border-kobipo-blue bg-kobipo-blue text-white dark:border-primary dark:bg-primary dark:text-primary-foreground"
                        : "border-border text-muted-foreground hover:bg-muted",
                    )}
                  >
                    {e.name}
                  </button>
                ))}
              </div>
            </div>

            {days.length > 1 && (
              <div className="space-y-1.5">
                <Label>Günler</Label>
                <div className="flex flex-wrap gap-2">
                  {days.map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setSelectedDays((prev) => toggle(prev, d))}
                      className={cn(
                        "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                        selectedDays.includes(d)
                          ? "border-kobipo-blue bg-kobipo-blue/10 text-kobipo-blue dark:border-primary dark:bg-primary/15 dark:text-primary"
                          : "border-border text-muted-foreground hover:bg-muted",
                      )}
                    >
                      {weekdayLabel(weekdayOf(d)).slice(0, 3)} {Number(d.split("-")[2])}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <p className="text-sm text-muted-foreground">
              {canApply ? (
                <>
                  <span className="font-semibold text-foreground">{count}</span> vardiya açılacak
                  {template && (
                    <>
                      {" · "}
                      {durationLabel(
                        netMinutes(template.startMinute, template.endMinute, template.breakMinutes),
                      )}{" "}
                      / gün
                    </>
                  )}
                  . Zaten vardiyası olan günler atlanır.
                </>
              ) : (
                "Personel ve gün seçin."
              )}
            </p>
          </div>
        )}

        <div className="flex justify-between gap-2 pt-2">
          <Button variant="ghost" size="sm" onClick={onManageTemplates}>
            Şablonları yönet
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={isSaving}>
              Vazgeç
            </Button>
            <Button
              onClick={() =>
                onApply({ templateId, employeeIds: selectedEmployees, days: selectedDays })
              }
              disabled={!canApply || isSaving}
            >
              {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Doldur
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
