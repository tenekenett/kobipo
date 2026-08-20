"use client"

// Bir günün madde listesi + onaylama kontrolleri. İKİ ekranda ORTAK:
//   • satış ekranındaki uyarı şeridinin diyaloğu (checklist-banner.tsx)
//   • Kontrol Listesi sayfasının "Günün listesi" sekmesi (checklist-today.tsx)
//
// Ortak olması şart: tik atma/geri alma mantığı iki yerde ayrı yazılsaydı biri
// `employeeId` göndermeyi ya da `mutate` etmeyi unuttuğunda fark yalnızca
// raporda görülürdü. Bileşen VERİ ÇEKMEZ — çağıran `useChecklistDay` ile çeker
// ve `onChanged`i geçer; şerit aynı veriden ilerleme sayısını da hesaplıyor.
//
// PERSONEL SEÇİMİ ONAY ANINDA: "Onayla"ya basınca açılan popup'tan seçilir —
// iskonto akışındaki desenin aynısı (components/restoran/discount-dialog.tsx).
// Listenin tepesinde tek seçici de denenmişti; onay ile ismin arasındaki bağ
// ekranda görünmüyordu ve yanlış isim adına sessizce tik atmak kolaydı.
// Sıralı tiklerde tekrar tekrar seçmek zorunda kalmamak için son seçim
// hatırlanır ve popup ön-dolu açılır (onay yine tek dokunuş uzakta).

import { useState } from "react"
import { Check, Loader2, Undo2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useToast } from "@/components/ui/use-toast"
import { WriteAction } from "@/components/dashboard/write-guard"
import type { ChecklistDay, ChecklistItemView } from "@/lib/restoran/checklist"

export function ChecklistDayList({
  companyId,
  date,
  items,
  employees,
  onChanged,
  emptyText = "Bu listede madde yok.",
}: {
  companyId: string | null
  /** "YYYY-MM-DD" — geçmiş bir gün de onaylanabilir (dün akşamın kapanışı). */
  date: string
  items: ChecklistItemView[]
  /**
   * Personel seçenekleri. BOŞ ise popup hiç açılmaz, tik doğrudan atılır:
   * personel kartı tanımlamamış (ya da `hr` modülünü kullanmayan) işletmede
   * seçecek bir şey olmayan bir diyalog yalnızca engel olurdu — sunucu o durumda
   * tiki atan kullanıcının adını yazar.
   */
  employees: ChecklistDay["employees"]
  onChanged: () => void
  emptyText?: string
}) {
  const { toast } = useToast()
  const [busyItemId, setBusyItemId] = useState<string | null>(null)
  const [pending, setPending] = useState<ChecklistItemView | null>(null)
  // Son seçilen personel bu liste boyunca hatırlanır (bkz. dosya başlığı).
  const [employeeId, setEmployeeId] = useState("")

  async function submit(item: ChecklistItemView, checked: boolean, withEmployeeId?: string) {
    if (!companyId) return
    setBusyItemId(item.id)
    try {
      const response = checked
        ? await fetch(
            `/api/restoran/kontrol-listesi/gun?companyId=${companyId}&itemId=${item.id}&date=${date}`,
            { method: "DELETE" },
          )
        : await fetch("/api/restoran/kontrol-listesi/gun", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              companyId,
              itemId: item.id,
              date,
              employeeId: withEmployeeId || undefined,
            }),
          })

      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body.error || "İşlem tamamlanamadı")
      }
      onChanged()
      setPending(null)
    } catch (error: any) {
      toast({
        title: "Hata",
        description: error.message ?? "İşlem tamamlanamadı",
        variant: "destructive",
      })
    } finally {
      setBusyItemId(null)
    }
  }

  function handleClick(item: ChecklistItemView) {
    const checked = item.entry != null
    // Geri almada popup YOK: onayı kaldırmak için seçilecek bir isim yok.
    if (checked || employees.length === 0) {
      void submit(item, checked)
      return
    }
    setPending(item)
  }

  if (items.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">{emptyText}</p>
  }

  return (
    <>
      <div className="space-y-2">
        {items.map((item) => {
          const checked = item.entry != null
          const busy = busyItemId === item.id
          return (
            <div
              key={item.id}
              className={`flex items-center justify-between gap-3 rounded-md border p-2.5 ${
                checked ? "bg-muted/50" : ""
              }`}
            >
              <div className="min-w-0">
                <p className={`text-sm ${checked ? "text-muted-foreground line-through" : ""}`}>
                  {item.title}
                </p>
                {item.entry && (
                  <p className="text-xs text-muted-foreground">
                    {item.entry.employeeName} ·{" "}
                    {new Date(item.entry.checkedAt).toLocaleTimeString("tr-TR", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                )}
              </div>
              <WriteAction>
              <Button
                size="sm"
                variant={checked ? "ghost" : "default"}
                disabled={busy}
                onClick={() => handleClick(item)}
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : checked ? (
                  <>
                    <Undo2 className="mr-1 h-4 w-4" />
                    Geri al
                  </>
                ) : (
                  <>
                    <Check className="mr-1 h-4 w-4" />
                    Onayla
                  </>
                )}
              </Button>
              </WriteAction>
            </div>
          )
        })}
      </div>

      <ChecklistConfirmDialog
        item={pending}
        employees={employees}
        employeeId={employeeId}
        onEmployeeChange={setEmployeeId}
        busy={pending != null && busyItemId === pending.id}
        onClose={() => setPending(null)}
        onConfirm={(id) => pending && void submit(pending, false, id)}
      />
    </>
  )
}

/**
 * Onay popup'ı — maddeyi yapan kişi burada seçilir.
 *
 * Seçim ZORUNLU (personel tanımlıysa): sunucu seçim olmadan tiki oturumu açan
 * kullanıcının adına yazar ve kasa çoğu zaman ortak hesapla açık olduğu için
 * bütün onaylar tek isme yığılırdı. İskonto diyaloğundaki kuralın aynısı.
 */
function ChecklistConfirmDialog({
  item,
  employees,
  employeeId,
  onEmployeeChange,
  busy,
  onClose,
  onConfirm,
}: {
  item: ChecklistItemView | null
  employees: ChecklistDay["employees"]
  employeeId: string
  onEmployeeChange: (value: string) => void
  busy: boolean
  onClose: () => void
  onConfirm: (employeeId: string) => void
}) {
  return (
    <Dialog open={item != null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Maddeyi onayla</DialogTitle>
          <DialogDescription>
            Onay bir beyandır — seçilen isim, maddeyi o kişinin yaptığının kanıtı değildir.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <p className="rounded-lg bg-muted/50 px-3 py-2.5 text-sm font-medium">{item?.title}</p>

          <div>
            <Label className="text-xs text-muted-foreground">Maddeyi yapan personel</Label>
            <Select value={employeeId} onValueChange={onEmployeeChange}>
              <SelectTrigger className="mt-1.5 h-11">
                <SelectValue placeholder="Personel seçin" />
              </SelectTrigger>
              <SelectContent>
                {employees.map((employee) => (
                  <SelectItem key={employee.id} value={employee.id}>
                    {employee.name}
                    {employee.position ? (
                      <span className="ml-2 text-xs text-muted-foreground">{employee.position}</span>
                    ) : null}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button disabled={!employeeId || busy} onClick={() => onConfirm(employeeId)}>
            {busy ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Check className="mr-1 h-4 w-4" />
            )}
            Onayla
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
