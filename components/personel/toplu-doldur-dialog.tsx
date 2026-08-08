"use client"

/**
 * Toplu doldurma — bir şablonu ya da bir ROTASYON DESENİNİ seçilen personellere
 * ve günlere uygular.
 *
 * Ekran görüntüsündeki "auto fill" karşılığı. Çakışanlar ATLANIR (sunucu tarafı
 * da öyle davranıyor): amaç boş yerleri doldurmak, mevcut planı ezmek değil.
 * Kaç tanesinin atlandığı işlem sonunda söylenir.
 *
 * İKİ KİP tek pencerede: "aynı şablonu herkese" ile "desen" arasındaki fark
 * kullanıcı için bir ayar farkıdır, ayrı bir ekran açmayı hak etmez. Desen kipi
 * ekibin saatlerini birbirine göre kaydırır — asıl vardiya rotasyonu budur.
 */

import { useEffect, useMemo, useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import { Loader2, Plus, RotateCw, X } from "lucide-react"
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
  onApply: (input: {
    mode: "template" | "rotation"
    templateId: string
    employeeIds: string[]
    days: string[]
    /** Desen kipinde gün gün kalıp: şablon id'si ya da null (izin günü). */
    cycle: (string | null)[]
    stagger: boolean
  }) => void
  onManageTemplates: () => void
}) {
  const [mode, setMode] = useState<"template" | "rotation">("template")
  const [templateId, setTemplateId] = useState("")
  const [selectedEmployees, setSelectedEmployees] = useState<string[]>([])
  const [selectedDays, setSelectedDays] = useState<string[]>([])
  const [cycle, setCycle] = useState<(string | null)[]>([])
  const [stagger, setStagger] = useState(true)

  useEffect(() => {
    if (!open) return
    setMode("template")
    setTemplateId(templates[0]?.id ?? "")
    setSelectedEmployees([])
    setCycle([])
    setStagger(true)
    // Günler varsayılan olarak TÜMÜ seçili: pencere hafta görünümünden açıldığında
    // asıl istenen "haftayı doldur", tek tek gün işaretlemek değil.
    setSelectedDays(days)
  }, [open, templates, days])

  const template = useMemo(() => templates.find((t) => t.id === templateId), [templates, templateId])

  if (!open) return null

  const toggle = (list: string[], v: string) =>
    list.includes(v) ? list.filter((x) => x !== v) : [...list, v]

  /**
   * Açılacak vardiya sayısı.
   *
   * Desen kipinde her gün vardiya YAZILMAZ (izin günleri desenin parçası), o
   * yüzden sayı desendeki dolu oranından türer — "35 vardiya açılacak" deyip 21
   * açmak kullanıcının doldurmayı eksik sanmasına yol açardı.
   */
  const filledRatio = cycle.length === 0 ? 0 : cycle.filter(Boolean).length / cycle.length
  const count =
    mode === "template"
      ? selectedEmployees.length * selectedDays.length
      : Math.round(selectedEmployees.length * selectedDays.length * filledRatio)

  const canApply =
    selectedEmployees.length > 0 &&
    selectedDays.length > 0 &&
    (mode === "template" ? Boolean(template) : cycle.some(Boolean))

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
            <div className="flex rounded-full bg-muted p-0.5">
              {(["template", "rotation"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={cn(
                    "flex-1 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors",
                    mode === m
                      ? "bg-kobipo-blue text-white dark:bg-primary dark:text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {m === "template" ? "Tek şablon" : "Rotasyon deseni"}
                </button>
              ))}
            </div>

            {mode === "template" ? (
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
            ) : (
              <RotationBuilder
                templates={templates}
                cycle={cycle}
                stagger={stagger}
                onChange={setCycle}
                onStaggerChange={setStagger}
              />
            )}

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
                  <span className="font-semibold text-foreground">~{count}</span> vardiya açılacak
                  {mode === "template" && template && (
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
              ) : mode === "rotation" && !cycle.some(Boolean) ? (
                "Desene en az bir vardiya günü ekleyin."
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
                onApply({
                  mode,
                  templateId,
                  employeeIds: selectedEmployees,
                  days: selectedDays,
                  cycle,
                  stagger,
                })
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

/**
 * Rotasyon deseni kurucusu — "2 gün sabah, 2 gün akşam, 1 gün off".
 *
 * Desen GÜN GÜN kurulur, kural olarak değil: "her iki günde bir akşamcı" gibi
 * bir ifadeyi doğru anlatan bir arayüz kurmak, kullanıcıya kendi düzenini
 * doğrudan dizdirmekten hem zor hem de yanlış anlaşılmaya açık. Ekrandaki dizi
 * neyse plana düşecek olan da odur.
 */
function RotationBuilder({
  templates,
  cycle,
  stagger,
  onChange,
  onStaggerChange,
}: {
  templates: ShiftTemplate[]
  cycle: (string | null)[]
  stagger: boolean
  onChange: (next: (string | null)[]) => void
  onStaggerChange: (next: boolean) => void
}) {
  const nameOf = (id: string | null) =>
    id ? (templates.find((t) => t.id === id)?.name ?? "?") : "İzin"

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label>Desen</Label>
        {cycle.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
            Aşağıdan gün ekleyerek deseni kurun. Desen, seçilen günler boyunca baştan
            tekrarlanır.
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-1.5">
            {cycle.map((entry, i) => (
              <span
                key={i}
                className={cn(
                  "flex items-center gap-1 rounded-lg border px-2 py-1 text-xs font-semibold",
                  entry
                    ? "border-kobipo-blue/40 bg-kobipo-blue/10 text-kobipo-blue dark:border-primary/40 dark:bg-primary/15 dark:text-primary"
                    : "border-border bg-muted/50 text-muted-foreground",
                )}
              >
                <span className="tabular-nums opacity-60">{i + 1}.</span>
                {nameOf(entry)}
                <button
                  type="button"
                  onClick={() => onChange(cycle.filter((_, idx) => idx !== i))}
                  className="ml-0.5 rounded-full p-0.5 hover:bg-black/10"
                  title="Bu günü desenden çıkar"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {templates.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => onChange([...cycle, t.id])}
            className="flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted"
          >
            <Plus className="h-3 w-3" />
            <span
              className={cn(
                "h-2 w-2 rounded-full",
                SHIFT_COLOR_DOT[(t.color as ShiftColor) ?? "blue"] ?? SHIFT_COLOR_DOT.blue,
              )}
            />
            {t.name}
          </button>
        ))}
        <button
          type="button"
          onClick={() => onChange([...cycle, null])}
          className="flex items-center gap-1.5 rounded-full border border-dashed border-border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted"
        >
          <Plus className="h-3 w-3" /> İzin günü
        </button>
      </div>

      <div className="flex items-center justify-between rounded-lg border border-border/70 px-3 py-2">
        <div className="pr-3">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <RotateCw className="h-4 w-4" /> Personeli kaydırarak dağıt
          </p>
          <p className="text-xs text-muted-foreground">
            {stagger
              ? "Her personel desene bir gün ileriden başlar — vardiyalar ekip içinde döner."
              : "Herkes deseni aynı gün yaşar (ör. hafta içi sabah, hafta sonu kapalı)."}
          </p>
        </div>
        <Switch checked={stagger} onCheckedChange={onStaggerChange} />
      </div>
    </div>
  )
}
