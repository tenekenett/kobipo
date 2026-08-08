"use client"

// Kontrol Listesi sayfasının "Günün listesi" sekmesi — yöneticinin, personelin
// satış ekranında gördüğü listenin AYNISINI görüp kendisinin de onaylayabildiği
// yer. Kimin onayladığı her satırın altında.
//
// Neden ayrı bir ekran: uyarı şeridi yalnız satış ekranlarında ve gün sonu
// raporunda duruyor; yönetici gün içinde kasaya hiç girmeden "liste doldu mu"
// sorusuna cevap alamıyordu. Tik mantığı yine ORTAK bileşende
// (checklist-day-list.tsx) — iki yerde iki ayrı onay yolu olmasın.
//
// Gün gezinebilir: dün akşamın kapanışı ertesi sabah işaretlenebilir (liste
// engelleyici olmadığı için geçmişe onay atmak da meşru).

import { useState } from "react"
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { FetchErrorText } from "@/components/ui/fetch-error"
import { shiftDayIso } from "@/lib/personel/vardiya"
import { useChecklistDay } from "@/lib/swr/use-restoran"
import {
  CHECKLIST_TYPES,
  CHECKLIST_TYPE_HINTS,
  CHECKLIST_TYPE_LABELS,
  checklistProgress,
  todayIso,
  type ChecklistType,
} from "@/lib/restoran/checklist"
import { cn } from "@/lib/utils"
import { ChecklistDayList } from "./checklist-day-list"

export function ChecklistTodayPanel({ companyId }: { companyId: string }) {
  const [date, setDate] = useState(() => todayIso())

  const opening = useChecklistDay(companyId, "OPENING", date)
  const closing = useChecklistDay(companyId, "CLOSING", date)

  const lists: Record<ChecklistType, ReturnType<typeof useChecklistDay>> = {
    OPENING: opening,
    CLOSING: closing,
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => setDate((d) => shiftDayIso(d, -1))}
            aria-label="Önceki gün"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Input
            type="date"
            value={date}
            onChange={(e) => e.target.value && setDate(e.target.value)}
            className="h-9 w-40"
          />
          <Button
            variant="outline"
            size="icon"
            onClick={() => setDate((d) => shiftDayIso(d, 1))}
            aria-label="Sonraki gün"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="outline" onClick={() => setDate(todayIso())}>
            <CalendarDays className="mr-1.5 h-4 w-4" />
            Bugün
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">
          Onayla'ya basınca maddeyi yapan personeli seçeceksiniz.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {CHECKLIST_TYPES.map((type) => {
          const { day, error, isLoading, mutate } = lists[type]
          const progress = checklistProgress(day?.items ?? [])
          return (
            <Card key={type}>
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-base">
                      {CHECKLIST_TYPE_LABELS[type]} listesi
                    </CardTitle>
                    <CardDescription>{CHECKLIST_TYPE_HINTS[type]}</CardDescription>
                  </div>
                  {progress.total > 0 && (
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold tabular-nums",
                        progress.complete
                          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400"
                          : "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400",
                      )}
                    >
                      {progress.done}/{progress.total}
                    </span>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {error ? (
                  <FetchErrorText error={error} subject="kontrol listesi" />
                ) : isLoading ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">Yükleniyor…</p>
                ) : (
                  <ChecklistDayList
                    companyId={companyId}
                    date={date}
                    items={day?.items ?? []}
                    employees={day?.employees ?? []}
                    onChanged={mutate}
                    emptyText={`${CHECKLIST_TYPE_LABELS[type]} listesinde madde yok — "${CHECKLIST_TYPE_LABELS[type]} listesi" sekmesinden ekleyin.`}
                  />
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
