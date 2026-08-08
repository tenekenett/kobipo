"use client"

// Açılış/kapanış listesi uyarı şeridi + onay diyaloğu. Satış ekranı (açılış) ve
// gün sonu raporu (kapanış) aynı bileşeni kullanır.
//
// ENGELLEMEZ: eksik madde ne satışı ne gün sonunu durdurur — şerit yalnız
// "şu maddeler onaylanmadı" der, kasa çalışmaya devam eder. Gerekçe:
// prisma/schema.prisma → ChecklistItem. Aynı desen, aynı ekrandaki yetersiz stok
// uyarısı (cafe-sale-screen.tsx başlığı: "engelleyici kontrol kasayı kilitler").
//
// Madde tanımlanmamış firmada HİÇ render edilmez: listeyi kurmamış işletmeye her
// ekranda boş uyarı basmak, şeridi ilk günden görmezden gelinen gürültüye çevirir.

import { useMemo, useState } from "react"
import { Check, ClipboardList } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useDashboardCompany } from "@/components/dashboard/dashboard-company-provider"
import { ChecklistDayList } from "./checklist-day-list"
import { useChecklistDay } from "@/lib/swr/use-restoran"
import {
  CHECKLIST_TYPE_LABELS,
  checklistProgress,
  todayIso,
  type ChecklistType,
} from "@/lib/restoran/checklist"

type Props = {
  type: ChecklistType
  /** "YYYY-MM-DD"; verilmezse bugün. Gün sonu raporu seçili günü geçer. */
  date?: string
  className?: string
}

export function ChecklistBanner({ type, date, className }: Props) {
  const { selectedCompanyId: companyId } = useDashboardCompany()
  const day = date ?? todayIso()
  const { day: data, isLoading, mutate } = useChecklistDay(companyId, type, day)
  const [open, setOpen] = useState(false)

  const progress = useMemo(() => checklistProgress(data?.items ?? []), [data?.items])
  const label = CHECKLIST_TYPE_LABELS[type]

  // Yüklenirken de madde yokken de sessiz: iskelet göstermek ekranın üstünü her
  // açılışta zıplatırdı.
  if (isLoading || progress.total === 0) return null

  return (
    <>
      {progress.complete ? (
        <div
          className={`flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400 ${className ?? ""}`}
        >
          <Check className="h-4 w-4 shrink-0" />
          <span>
            {label} listesi tamamlandı ({progress.done}/{progress.total})
          </span>
          <Button variant="link" size="sm" className="h-auto p-0" onClick={() => setOpen(true)}>
            Görüntüle
          </Button>
        </div>
      ) : (
        <Card className={`border-amber-300 dark:border-amber-700/60 ${className ?? ""}`}>
          <CardContent className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-2 text-amber-700 dark:text-amber-400">
              <ClipboardList className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="text-sm">
                <p className="font-medium">
                  {label} listesinde {progress.pending} madde onaylanmadı
                </p>
                <p className="text-muted-foreground">
                  {data?.items
                    .filter((item) => !item.entry)
                    .map((item) => item.title)
                    .slice(0, 3)
                    .join(" · ")}
                  {progress.pending > 3 ? " …" : ""}
                </p>
              </div>
            </div>
            <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
              Listeyi aç
            </Button>
          </CardContent>
        </Card>
      )}

      <ChecklistDialog
        open={open}
        onOpenChange={setOpen}
        type={type}
        date={day}
        companyId={companyId}
        data={data}
        onChanged={mutate}
      />
    </>
  )
}

function ChecklistDialog({
  open,
  onOpenChange,
  type,
  date,
  companyId,
  data,
  onChanged,
}: {
  open: boolean
  onOpenChange: (value: boolean) => void
  type: ChecklistType
  date: string
  companyId: string | null
  data: ReturnType<typeof useChecklistDay>["day"]
  onChanged: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{CHECKLIST_TYPE_LABELS[type]} listesi</DialogTitle>
          <DialogDescription>
            {date} · Onayla'ya basınca maddeyi yapan personeli seçeceksiniz. Onay satışı
            engellemez.
          </DialogDescription>
        </DialogHeader>

        <ChecklistDayList
          companyId={companyId}
          date={date}
          items={data?.items ?? []}
          employees={data?.employees ?? []}
          onChanged={onChanged}
        />
      </DialogContent>
    </Dialog>
  )
}
