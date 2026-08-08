"use client"

// Kontrol listesi yönetimi — patron maddeleri burada yazar, uyumu burada ölçer.
//
// Personel bu sayfayı GÖRMEZ (nav-config: SALES yok); tikleri satış ekranındaki
// uyarı şeridinden atar. Buradaki üçüncü sekme özelliğin tek yaptırım gücü:
// liste bloklamadığı ve tik doğrulanmadığı için eksikler ancak burada görünür.

import { useMemo, useState } from "react"
import { ArrowDown, ArrowUp, Check, ListChecks, Loader2, Plus, RotateCcw, Trash2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { FetchErrorText } from "@/components/ui/fetch-error"
import { useToast } from "@/components/ui/use-toast"
import { useConfirm } from "@/components/ui/confirm-dialog-provider"
import { useDashboardCompany } from "@/components/dashboard/dashboard-company-provider"
import { useChecklistItems, type ChecklistItemRow } from "@/lib/swr/use-restoran"
import {
  CHECKLIST_TITLE_MAX,
  CHECKLIST_TYPES,
  CHECKLIST_TYPE_HINTS,
  CHECKLIST_TYPE_LABELS,
  type ChecklistType,
} from "@/lib/restoran/checklist"
import { cn } from "@/lib/utils"
import { ChecklistComplianceReport } from "./checklist-report"
import { ChecklistTodayPanel } from "./checklist-today"

type TabKey = ChecklistType | "TODAY" | "REPORT"

// "Günün listesi" ÖNDE: sayfaya en sık bakma sebebi "liste doldu mu, kim
// onayladı" sorusu; madde yazmak kurulumda bir kez yapılıyor.
const TABS: { key: TabKey; label: string }[] = [
  { key: "TODAY", label: "Günün listesi" },
  ...CHECKLIST_TYPES.map((type) => ({ key: type as TabKey, label: `${CHECKLIST_TYPE_LABELS[type]} listesi` })),
  { key: "REPORT", label: "Uyum raporu" },
]

export function ChecklistScreen() {
  const { selectedCompanyId: companyId } = useDashboardCompany()
  const [active, setActive] = useState<TabKey>("TODAY")

  // Pasif maddeler de gelir (`all`): düzenleme ekranı onları ayrı blokta gösterir
  // ve geri açılabilmelerini sağlar.
  const { items, error, isLoading, mutate } = useChecklistItems(companyId, { all: true })

  if (!companyId) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <p className="text-muted-foreground">Lütfen bir firma seçin</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-3xl font-bold">Kontrol Listesi</h1>
        <p className="text-muted-foreground">
          Gün başında ve gün sonunda yapılacakları siz belirlersiniz; personel satış
          ekranından onaylar. Eksik madde satışı engellemez, uyarı olarak görünür.
        </p>
      </div>

      <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActive(tab.key)}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold transition-colors",
              tab.key === active
                ? "bg-kobipo-blue text-white dark:bg-primary dark:text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/70",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {active === "TODAY" ? (
        <ChecklistTodayPanel companyId={companyId} />
      ) : active === "REPORT" ? (
        <ChecklistComplianceReport companyId={companyId} />
      ) : (
        <ChecklistEditor
          companyId={companyId}
          type={active}
          items={items.filter((item) => item.type === active)}
          isLoading={isLoading}
          error={error}
          onChanged={mutate}
        />
      )}
    </div>
  )
}

function ChecklistEditor({
  companyId,
  type,
  items,
  isLoading,
  error,
  onChanged,
}: {
  companyId: string
  type: ChecklistType
  items: ChecklistItemRow[]
  isLoading: boolean
  error: unknown
  onChanged: () => void
}) {
  const { toast } = useToast()
  const { confirm } = useConfirm()
  const [title, setTitle] = useState("")
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<{ id: string; title: string } | null>(null)

  const active = useMemo(() => items.filter((item) => item.isActive), [items])
  const inactive = useMemo(() => items.filter((item) => !item.isActive), [items])

  async function send(
    input: RequestInfo,
    init: RequestInit,
    fallbackMessage: string,
  ): Promise<boolean> {
    setBusy(true)
    try {
      const response = await fetch(input, init)
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body.error || fallbackMessage)
      }
      onChanged()
      return true
    } catch (err: any) {
      toast({ title: "Hata", description: err.message ?? fallbackMessage, variant: "destructive" })
      return false
    } finally {
      setBusy(false)
    }
  }

  async function addItem() {
    const value = title.trim()
    if (!value) return
    const ok = await send(
      "/api/restoran/kontrol-listesi",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, type, title: value }),
      },
      "Madde eklenemedi",
    )
    if (ok) setTitle("")
  }

  const patch = (id: string, data: Record<string, unknown>, message: string) =>
    send(
      `/api/restoran/kontrol-listesi/${id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, ...data }),
      },
      message,
    )

  /** Komşu maddeyle sıra değiştir — iki PATCH, listenin görünen sırası bozulmadan. */
  async function move(index: number, direction: -1 | 1) {
    const current = active[index]
    const neighbour = active[index + direction]
    if (!current || !neighbour) return
    await patch(current.id, { sortOrder: neighbour.sortOrder }, "Sıra değiştirilemedi")
    await patch(neighbour.id, { sortOrder: current.sortOrder }, "Sıra değiştirilemedi")
  }

  async function remove(item: ChecklistItemRow) {
    const ok = await confirm({
      title: "Madde kaldırılsın mı?",
      // Sunucu karar veriyor: onay görmüş madde pasifleşir, hiç onay almamış
      // madde silinir (bkz. kontrol-listesi/[id] DELETE).
      description: `"${item.title}" listeden çıkarılacak. Daha önce onaylanmışsa geçmiş kayıtlar korunur, madde yalnızca listeden gizlenir.`,
      confirmLabel: "Kaldır",
      variant: "destructive",
    })
    if (!ok) return
    await send(
      `/api/restoran/kontrol-listesi/${item.id}?companyId=${companyId}`,
      { method: "DELETE" },
      "Madde kaldırılamadı",
    )
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <ListChecks className="h-5 w-5" />
            {CHECKLIST_TYPE_LABELS[type]} listesi
          </CardTitle>
          <CardDescription>{CHECKLIST_TYPE_HINTS[type]}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input
              value={title}
              maxLength={CHECKLIST_TITLE_MAX}
              placeholder="Örn. Buzdolabı ısısını kontrol et"
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  void addItem()
                }
              }}
            />
            <Button onClick={() => void addItem()} disabled={busy || !title.trim()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              <span className="ml-1 hidden sm:inline">Ekle</span>
            </Button>
          </div>

          {error ? (
            <FetchErrorText error={error} subject="kontrol listesi" />
          ) : isLoading ? (
            <p className="py-4 text-center text-sm text-muted-foreground">Yükleniyor…</p>
          ) : active.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Henüz madde yok. Liste boşken personele hiçbir uyarı gösterilmez.
            </p>
          ) : (
            <div className="space-y-2">
              {active.map((item, index) => (
                <div
                  key={item.id}
                  className="flex items-center gap-2 rounded-md border p-2 pl-3"
                >
                  <span className="w-6 shrink-0 text-xs tabular-nums text-muted-foreground">
                    {index + 1}.
                  </span>

                  {editing?.id === item.id ? (
                    <>
                      <Input
                        autoFocus
                        value={editing.title}
                        maxLength={CHECKLIST_TITLE_MAX}
                        onChange={(e) => setEditing({ id: item.id, title: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") setEditing(null)
                          if (e.key === "Enter") {
                            e.preventDefault()
                            void patch(item.id, { title: editing.title }, "Madde güncellenemedi").then(
                              (ok) => ok && setEditing(null),
                            )
                          }
                        }}
                        className="h-8"
                      />
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 shrink-0"
                        disabled={busy || !editing.title.trim()}
                        onClick={() =>
                          void patch(item.id, { title: editing.title }, "Madde güncellenemedi").then(
                            (ok) => ok && setEditing(null),
                          )
                        }
                        aria-label="Kaydet"
                      >
                        <Check className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 shrink-0"
                        onClick={() => setEditing(null)}
                        aria-label="Vazgeç"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="min-w-0 flex-1 truncate text-left text-sm hover:underline"
                        onClick={() => setEditing({ id: item.id, title: item.title })}
                        title="Düzenlemek için tıklayın"
                      >
                        {item.title}
                      </button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 shrink-0"
                        disabled={busy || index === 0}
                        onClick={() => void move(index, -1)}
                        aria-label="Yukarı taşı"
                      >
                        <ArrowUp className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 shrink-0"
                        disabled={busy || index === active.length - 1}
                        onClick={() => void move(index, 1)}
                        aria-label="Aşağı taşı"
                      >
                        <ArrowDown className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 shrink-0 text-destructive"
                        disabled={busy}
                        onClick={() => void remove(item)}
                        aria-label="Kaldır"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}

          {active.length > 10 && (
            // Uzun liste özelliği kendi kendine sabote eder: 15 maddeyi her sabah
            // tek tek onaylamak yerine personel hepsini saniyeler içinde tıklar.
            <p className="text-xs text-amber-700 dark:text-amber-400">
              Liste {active.length} maddeye çıktı. Uzun listeler baştan savma
              onaylanma eğiliminde — gerçekten her gün kontrol edilenleri bırakmayı düşünün.
            </p>
          )}
        </CardContent>
      </Card>

      {inactive.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Kaldırılan maddeler</CardTitle>
            <CardDescription>
              Onay görmüş maddeler silinmez, gizlenir — geçmiş günlerin kaydı okunabilir kalsın.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {inactive.map((item) => (
              <div key={item.id} className="flex items-center gap-2 rounded-md border border-dashed p-2 pl-3">
                <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                  {item.title}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void patch(item.id, { isActive: true }, "Madde geri açılamadı")}
                >
                  <RotateCcw className="mr-1 h-4 w-4" />
                  Geri aç
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
