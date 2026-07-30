"use client"

// Salon planı — masaların yerleşimi, doluluğu ve DÜKKAN KROKİSİ.
// Kararlar: docs/restoran/ASAMA2.md (Faz B)
//
// Yerleşim koordinatı masanın/öğenin KENDİ satırındadır (ayrı bir plan JSON'u
// yok): sürükleme bittiğinde tek kayıt için `PATCH {x,y}` gider. Koordinat birimi
// ızgara hücresidir — ekran ölçeği değişince yerleşim bozulmaz.
//
// İki kip bilinçli: KULLANIM kipinde masaya dokunmak adisyonu açar (garsonun tek
// işi bu), DÜZENLEME kipinde masa/kroki sürüklenir. Tek kip olsaydı masayı
// taşımaya çalışan her dokunuş yanlışlıkla adisyon açardı.
//
// "Tümü" sekmesinde bölgeler ALT ALTA ayrı tuvaller olarak çizilir. Hepsini tek
// tuvale koymak yanlış olurdu: koordinatlar bölge içinde anlamlı, iki bölgenin
// (0,0)'ı aynı yer değil — üst üste binerlerdi.

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import {
  ChefHat,
  Circle,
  DoorOpen,
  Coffee,
  Leaf,
  Loader2,
  Move,
  Plus,
  RefreshCw,
  Square,
  StretchHorizontal,
  Trash2,
  Type,
  Users,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { FetchErrorText } from "@/components/ui/fetch-error"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useToast } from "@/components/ui/use-toast"
import { useDashboardCompany } from "@/components/dashboard/dashboard-company-provider"
import { withCompanyHref } from "@/lib/company/href"
import {
  useAreas,
  usePlanItems,
  useTables,
  type Area,
  type PlanItem,
  type PlanTable,
} from "@/lib/swr/use-restoran"
import { currency } from "@/lib/fis/receipt-html"
import { cn } from "@/lib/utils"

/** Izgara hücresinin piksel boyu. Masa ve kroki ölçüleri bunun katıdır. */
const CELL = 48
const MIN_COLS = 12
const MIN_ROWS = 7

const ALL_AREAS = "__ALL__"
const NO_AREA = "__NONE__"

// ---- Kroki öğesi görünümleri ------------------------------------------------
// Her öğe kendi rengini ve varsayılan adını burada tanımlar; ekranın başka
// yerinde tür ismi geçmez.
const PLAN_KINDS: Array<{
  kind: string
  label: string
  icon: typeof Square
  className: string
  showLabel: boolean
}> = [
  {
    kind: "WALL",
    label: "Duvar",
    icon: StretchHorizontal,
    className: "bg-foreground/75 border-foreground/75 text-background",
    showLabel: false,
  },
  {
    kind: "DOOR",
    label: "Kapı",
    icon: DoorOpen,
    className: "border-dashed border-foreground/50 bg-background text-foreground/70",
    showLabel: true,
  },
  {
    kind: "BAR",
    label: "Bar",
    icon: Coffee,
    className: "border-amber-500/70 bg-amber-200/50 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200",
    showLabel: true,
  },
  {
    kind: "KITCHEN",
    label: "Mutfak",
    icon: ChefHat,
    className: "border-muted-foreground/30 bg-muted text-muted-foreground",
    showLabel: true,
  },
  {
    kind: "WC",
    label: "WC",
    icon: Square,
    className: "border-sky-500/50 bg-sky-100/60 text-sky-900 dark:bg-sky-900/30 dark:text-sky-200",
    showLabel: true,
  },
  {
    kind: "STAIRS",
    label: "Merdiven",
    icon: StretchHorizontal,
    className: "border-muted-foreground/40 bg-[repeating-linear-gradient(45deg,hsl(var(--muted))_0_8px,transparent_8px_16px)] text-muted-foreground",
    showLabel: true,
  },
  {
    kind: "PLANT",
    label: "Bitki",
    icon: Leaf,
    className: "rounded-full border-emerald-500/60 bg-emerald-100/70 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200",
    showLabel: false,
  },
  {
    kind: "TEXT",
    label: "Yazı",
    icon: Type,
    className: "border-transparent bg-transparent text-muted-foreground",
    showLabel: true,
  },
]

const kindDef = (kind: string) => PLAN_KINDS.find((k) => k.kind === kind) ?? PLAN_KINDS[0]

/** "2s 15d" — masanın ne kadardır dolu olduğu. */
function elapsedLabel(fromIso: string, now: number): string {
  const mins = Math.max(0, Math.floor((now - new Date(fromIso).getTime()) / 60000))
  if (mins < 60) return `${mins}d`
  return `${Math.floor(mins / 60)}s ${mins % 60}d`
}

type TableForm = {
  id?: string
  name: string
  areaId: string
  capacity: string
  shape: string
  width: number
  height: number
}

type ItemForm = { id: string; kind: string; label: string; width: number; height: number }

const emptyTableForm = (areaId: string | null): TableForm => ({
  name: "",
  areaId: areaId ?? NO_AREA,
  capacity: "",
  shape: "SQUARE",
  width: 2,
  height: 2,
})

type DragTarget = { type: "table" | "item"; id: string; startX: number; startY: number; x: number; y: number }

export function FloorPlanScreen() {
  const { selectedCompanyId: companyId } = useDashboardCompany()
  const { toast } = useToast()
  const router = useRouter()

  const { areas, mutate: mutateAreas } = useAreas(companyId)
  const { tables, error, isLoading, mutate } = useTables(companyId)
  const { planItems, mutate: mutateItems } = usePlanItems(companyId)

  const [activeArea, setActiveArea] = useState<string>(ALL_AREAS)
  const [editMode, setEditMode] = useState(false)
  const [busyTableId, setBusyTableId] = useState<string | null>(null)
  const [tableDialog, setTableDialog] = useState<TableForm | null>(null)
  const [itemDialog, setItemDialog] = useState<ItemForm | null>(null)
  const [areaDialog, setAreaDialog] = useState<{ name: string } | null>(null)
  const [saving, setSaving] = useState(false)

  // Süre etiketleri dakikada bir tazelenir; saniyede bir render etmenin anlamı yok.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60000)
    return () => clearInterval(t)
  }, [])

  // ---- Bölümleme ----------------------------------------------------------
  // "Tümü"de her bölge kendi tuvalinde, alt alta. Tek bölge seçiliyse tek bölüm.
  const sections = useMemo(() => {
    const build = (areaId: string | null, name: string) => ({
      key: areaId ?? NO_AREA,
      areaId,
      name,
      tables: tables.filter((t) => (areaId ? t.areaId === areaId : !t.areaId)),
      items: planItems.filter((i) => (areaId ? i.areaId === areaId : !i.areaId)),
    })

    if (activeArea === ALL_AREAS) {
      const all = [
        ...areas.map((a: Area) => build(a.id, a.name)),
        build(null, "Bölgesiz"),
      ]
      // Boş bölümler gizlenir; ama hiç bölge yoksa "Bölgesiz" tuvali kalsın ki
      // ilk masa eklenecek bir yer görünsün.
      const nonEmpty = all.filter((s) => s.tables.length > 0 || s.items.length > 0)
      return nonEmpty.length > 0 ? nonEmpty : [build(null, "Bölgesiz")]
    }
    if (activeArea === NO_AREA) return [build(null, "Bölgesiz")]
    const area = areas.find((a) => a.id === activeArea)
    return [build(activeArea, area?.name ?? "Bölge")]
  }, [activeArea, areas, tables, planItems])

  const visibleTables = useMemo(() => sections.flatMap((s) => s.tables), [sections])
  const openCount = visibleTables.filter((t) => t.openTicket).length
  const openTotal = visibleTables.reduce((sum, t) => sum + (t.openTicket?.total ?? 0), 0)

  // ---- Sürükleme ----------------------------------------------------------
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number } | null>(null)
  const dragRef = useRef<DragTarget | null>(null)
  /**
   * Sürükleme bittiğinde tarayıcı `click`'i de tetikler. Bu bayrak olmadan
   * taşınan her masa, bırakılınca düzenleme diyaloğunu da açardı.
   */
  const movedRef = useRef(false)

  const commitMove = useCallback(
    async (target: DragTarget, x: number, y: number) => {
      if (x === target.x && y === target.y) return
      const isTable = target.type === "table"
      // İyimser güncelleme: kayıt parmağın bıraktığı yerde kalsın, sunucu
      // yanıtını beklerken eski yerine geri zıplamasın.
      if (isTable) {
        await mutate((prev) => (prev ?? []).map((t) => (t.id === target.id ? { ...t, x, y } : t)), {
          revalidate: false,
        })
      } else {
        await mutateItems(
          (prev) => (prev ?? []).map((i) => (i.id === target.id ? { ...i, x, y } : i)),
          { revalidate: false },
        )
      }
      try {
        const res = await fetch(
          isTable ? `/api/restoran/masalar/${target.id}` : `/api/restoran/plan/${target.id}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ companyId, x, y }),
          },
        )
        if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || "Taşınamadı")
      } catch (e: any) {
        toast({ title: "Taşınamadı", description: e.message, variant: "destructive" })
      } finally {
        if (isTable) void mutate()
        else void mutateItems()
      }
    },
    [companyId, mutate, mutateItems, toast],
  )

  const onPointerDown = (
    e: React.PointerEvent,
    type: "table" | "item",
    id: string,
    x: number,
    y: number,
  ) => {
    if (!editMode) return
    e.preventDefault()
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
    dragRef.current = { type, id, startX: e.clientX, startY: e.clientY, x, y }
    movedRef.current = false
    setDrag({ id, dx: 0, dy: 0 })
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current
    if (!d) return
    const dx = e.clientX - d.startX
    const dy = e.clientY - d.startY
    // 4 piksellik eşik: dokunmatikte parmak hiç kıpırdamadan basmak imkânsız,
    // her dokunuş "sürükleme" sayılsaydı diyalog hiç açılmazdı.
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) movedRef.current = true
    setDrag({ id: d.id, dx, dy })
  }

  const onPointerUp = (e: React.PointerEvent) => {
    const d = dragRef.current
    dragRef.current = null
    setDrag(null)
    if (!d) return
    const nx = Math.max(0, d.x + Math.round((e.clientX - d.startX) / CELL))
    const ny = Math.max(0, d.y + Math.round((e.clientY - d.startY) / CELL))
    void commitMove(d, nx, ny)
  }

  // ---- Masaya dokunma (kullanım kipi) -------------------------------------

  const openTable = useCallback(
    async (table: PlanTable) => {
      if (table.openTicket) {
        router.push(withCompanyHref(`/restoran/adisyon/${table.openTicket.id}`, companyId))
        return
      }
      setBusyTableId(table.id)
      try {
        const res = await fetch("/api/restoran/adisyonlar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ companyId, tableId: table.id }),
        })
        const body = await res.json().catch(() => ({}))
        // 409 = bu masaya başka biri adisyon açmış; sunucu mevcut adisyonu
        // döndürüyor, kullanıcıyı hata ekranına düşürmeden oraya götürüyoruz.
        if (res.status === 409 && body?.ticket?.id) {
          void mutate()
          router.push(withCompanyHref(`/restoran/adisyon/${body.ticket.id}`, companyId))
          return
        }
        if (!res.ok) throw new Error(body?.error || "Adisyon açılamadı")
        void mutate()
        router.push(withCompanyHref(`/restoran/adisyon/${body.id}`, companyId))
      } catch (e: any) {
        toast({ title: "Adisyon açılamadı", description: e.message, variant: "destructive" })
      } finally {
        setBusyTableId(null)
      }
    },
    [companyId, mutate, router, toast],
  )

  // ---- Kaydetme -----------------------------------------------------------

  const saveTable = async () => {
    if (!tableDialog) return
    const name = tableDialog.name.trim()
    if (!name) {
      toast({ title: "Masa adı zorunlu", variant: "destructive" })
      return
    }
    setSaving(true)
    try {
      const payload = {
        companyId,
        name,
        areaId: tableDialog.areaId === NO_AREA ? null : tableDialog.areaId,
        capacity: tableDialog.capacity ? Number(tableDialog.capacity) : null,
        shape: tableDialog.shape,
        width: tableDialog.width,
        height: tableDialog.height,
      }
      const res = await fetch(
        tableDialog.id ? `/api/restoran/masalar/${tableDialog.id}` : "/api/restoran/masalar",
        {
          method: tableDialog.id ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      )
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || "Kaydedilemedi")
      setTableDialog(null)
      void mutate()
      toast({ title: tableDialog.id ? "Masa güncellendi" : "Masa eklendi", description: name })
    } catch (e: any) {
      toast({ title: "Kaydedilemedi", description: e.message, variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  const deleteTable = async () => {
    if (!tableDialog?.id) return
    setSaving(true)
    try {
      const res = await fetch(`/api/restoran/masalar/${tableDialog.id}?companyId=${companyId}`, {
        method: "DELETE",
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || "Silinemedi")
      setTableDialog(null)
      void mutate()
      toast({
        title: body?.deactivated ? "Masa kullanım dışı bırakıldı" : "Masa silindi",
        description: body?.deactivated
          ? "Geçmiş adisyonları olduğu için kayıt korundu."
          : undefined,
      })
    } catch (e: any) {
      toast({ title: "Silinemedi", description: e.message, variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  const addPlanItem = async (kind: string, areaId: string | null) => {
    try {
      const res = await fetch("/api/restoran/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, kind, areaId }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || "Eklenemedi")
      void mutateItems()
    } catch (e: any) {
      toast({ title: "Eklenemedi", description: e.message, variant: "destructive" })
    }
  }

  const saveItem = async () => {
    if (!itemDialog) return
    setSaving(true)
    try {
      const res = await fetch(`/api/restoran/plan/${itemDialog.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId,
          label: itemDialog.label,
          width: itemDialog.width,
          height: itemDialog.height,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || "Kaydedilemedi")
      setItemDialog(null)
      void mutateItems()
    } catch (e: any) {
      toast({ title: "Kaydedilemedi", description: e.message, variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  const deleteItem = async () => {
    if (!itemDialog) return
    setSaving(true)
    try {
      const res = await fetch(`/api/restoran/plan/${itemDialog.id}?companyId=${companyId}`, {
        method: "DELETE",
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || "Silinemedi")
      setItemDialog(null)
      void mutateItems()
    } catch (e: any) {
      toast({ title: "Silinemedi", description: e.message, variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  const saveArea = async () => {
    if (!areaDialog) return
    const name = areaDialog.name.trim()
    if (!name) return
    setSaving(true)
    try {
      const res = await fetch("/api/restoran/bolgeler", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, name }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || "Kaydedilemedi")
      setAreaDialog(null)
      void mutateAreas()
      setActiveArea(body.id)
      toast({ title: "Bölge eklendi", description: name })
    } catch (e: any) {
      toast({ title: "Kaydedilemedi", description: e.message, variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  if (!companyId) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <p className="text-muted-foreground">Lütfen bir firma seçin</p>
      </div>
    )
  }

  const areaTab = (isActive: boolean) =>
    cn(
      "shrink-0 rounded-full px-4 py-2 text-sm font-semibold transition-colors",
      isActive
        ? "bg-kobipo-blue text-white dark:bg-primary dark:text-primary-foreground"
        : "bg-muted text-muted-foreground hover:bg-muted/70",
    )

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Masalar</h1>
          <p className="text-muted-foreground">
            {editMode
              ? "Masaları ve kroki öğelerini sürükleyerek yerleştirin; dokununca ayarları açılır."
              : "Boş masaya dokunun, adisyon açılsın. Dolu masa hesabını gösterir."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void mutate()} disabled={isLoading}>
            <RefreshCw className={cn("mr-1.5 h-4 w-4", isLoading && "animate-spin")} />
            Yenile
          </Button>
          <Button
            variant={editMode ? "default" : "outline"}
            size="sm"
            onClick={() => setEditMode((v) => !v)}
          >
            <Move className="mr-1.5 h-4 w-4" />
            {editMode ? "Düzenlemeyi bitir" : "Düzenle"}
          </Button>
          {editMode && (
            <Button variant="outline" size="sm" onClick={() => setAreaDialog({ name: "" })}>
              <Plus className="mr-1.5 h-4 w-4" />
              Bölge
            </Button>
          )}
        </div>
      </div>

      {/* Bölge sekmeleri */}
      {(areas.length > 0 || tables.some((t) => !t.areaId)) && (
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
          <button type="button" className={areaTab(activeArea === ALL_AREAS)} onClick={() => setActiveArea(ALL_AREAS)}>
            Tümü
          </button>
          {areas.map((a: Area) => (
            <button key={a.id} type="button" className={areaTab(activeArea === a.id)} onClick={() => setActiveArea(a.id)}>
              {a.name}
            </button>
          ))}
          {tables.some((t) => !t.areaId) && (
            <button type="button" className={areaTab(activeArea === NO_AREA)} onClick={() => setActiveArea(NO_AREA)}>
              Bölgesiz
            </button>
          )}
        </div>
      )}

      {/* Özet şerit */}
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="rounded-lg bg-muted px-3 py-1.5">
          {visibleTables.length} masa · <strong>{openCount} dolu</strong>
        </span>
        {openTotal > 0 && (
          <span className="rounded-lg bg-kobipo-blue/10 px-3 py-1.5 font-semibold text-kobipo-blue dark:bg-primary/10 dark:text-primary">
            Açık hesap: {currency(openTotal)}
          </span>
        )}
      </div>

      {error ? (
        <Card>
          <CardContent className="py-16 text-center text-sm text-red-600 dark:text-red-400">
            <FetchErrorText error={error} subject="Masalar" />
          </CardContent>
        </Card>
      ) : isLoading && tables.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-sm text-muted-foreground">
            Salon planı yükleniyor…
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {sections.map((section) => {
            const cols = Math.max(
              MIN_COLS,
              ...section.tables.map((t) => t.x + t.width + 1),
              ...section.items.map((i) => i.x + i.width + 1),
            )
            const rows = Math.max(
              MIN_ROWS,
              ...section.tables.map((t) => t.y + t.height + 1),
              ...section.items.map((i) => i.y + i.height + 1),
            )
            const sectionOpen = section.tables.filter((t) => t.openTicket).length

            return (
              <Card key={section.key}>
                <CardContent className="space-y-3 p-3">
                  {/* Bölüm başlığı: "Tümü"de bölge adı, tek bölgede de aynı satır
                      düzenleme araçlarını taşıyor. */}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-baseline gap-2">
                      <h2 className="text-lg font-semibold">{section.name}</h2>
                      <span className="text-xs text-muted-foreground">
                        {section.tables.length} masa · {sectionOpen} dolu
                      </span>
                    </div>
                    {editMode && (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Button size="sm" onClick={() => setTableDialog(emptyTableForm(section.areaId))}>
                          <Plus className="mr-1.5 h-4 w-4" />
                          Masa
                        </Button>
                        <span className="mx-1 hidden text-xs text-muted-foreground sm:inline">Kroki:</span>
                        {PLAN_KINDS.map((k) => {
                          const Icon = k.icon
                          return (
                            <Button
                              key={k.kind}
                              variant="outline"
                              size="sm"
                              title={k.label}
                              onClick={() => void addPlanItem(k.kind, section.areaId)}
                            >
                              <Icon className="mr-1 h-3.5 w-3.5" />
                              <span className="text-xs">{k.label}</span>
                            </Button>
                          )
                        })}
                      </div>
                    )}
                  </div>

                  {section.tables.length === 0 && section.items.length === 0 ? (
                    <div className="space-y-3 py-12 text-center">
                      <p className="text-sm text-muted-foreground">
                        Bu bölümde henüz bir şey yok.
                      </p>
                      <Button
                        size="sm"
                        onClick={() => {
                          setEditMode(true)
                          setTableDialog(emptyTableForm(section.areaId))
                        }}
                      >
                        <Plus className="mr-1.5 h-4 w-4" />
                        Masa ekle
                      </Button>
                    </div>
                  ) : (
                    <div className="overflow-auto">
                      <div
                        className="relative rounded-xl bg-[linear-gradient(to_right,hsl(var(--border))_1px,transparent_1px),linear-gradient(to_bottom,hsl(var(--border))_1px,transparent_1px)] bg-[size:48px_48px]"
                        style={{ width: cols * CELL, height: rows * CELL, minWidth: "100%" }}
                        onPointerMove={onPointerMove}
                      >
                        {/* Kroki masaların ALTINDA çizilir ve kullanım kipinde
                            tıklanamaz — garson duvara basıp adisyon açmasın. */}
                        {section.items.map((item) => {
                          const def = kindDef(item.kind)
                          const Icon = def.icon
                          const dragging = drag?.id === item.id
                          const text = item.label || (def.showLabel ? def.label : "")
                          return (
                            <button
                              key={item.id}
                              type="button"
                              tabIndex={editMode ? 0 : -1}
                              onPointerDown={(e) => onPointerDown(e, "item", item.id, item.x, item.y)}
                              onPointerUp={onPointerUp}
                              onClick={() => {
                                if (movedRef.current) {
                                  movedRef.current = false
                                  return
                                }
                                if (!editMode) return
                                setItemDialog({
                                  id: item.id,
                                  kind: item.kind,
                                  label: item.label ?? "",
                                  width: item.width,
                                  height: item.height,
                                })
                              }}
                              className={cn(
                                "absolute flex items-center justify-center gap-1 rounded-md border-2 p-1 text-[10px] font-semibold",
                                def.className,
                                editMode ? "cursor-move touch-none" : "pointer-events-none",
                                dragging && "z-20 opacity-80 shadow-lg",
                              )}
                              style={{
                                left: item.x * CELL,
                                top: item.y * CELL,
                                width: item.width * CELL,
                                height: item.height * CELL,
                                transform: dragging ? `translate(${drag.dx}px, ${drag.dy}px)` : undefined,
                              }}
                            >
                              {item.kind !== "TEXT" && <Icon className="h-3.5 w-3.5 shrink-0" />}
                              {text && <span className="line-clamp-2 leading-tight">{text}</span>}
                            </button>
                          )
                        })}

                        {section.tables.map((table) => {
                          const busy = !!table.openTicket
                          const dragging = drag?.id === table.id
                          return (
                            <button
                              key={table.id}
                              type="button"
                              onPointerDown={(e) => onPointerDown(e, "table", table.id, table.x, table.y)}
                              onPointerUp={onPointerUp}
                              onClick={() => {
                                // Taşıma yapıldıysa bu click sürüklemenin artığıdır.
                                if (movedRef.current) {
                                  movedRef.current = false
                                  return
                                }
                                if (editMode) {
                                  setTableDialog({
                                    id: table.id,
                                    name: table.name,
                                    areaId: table.areaId ?? NO_AREA,
                                    capacity: table.capacity != null ? String(table.capacity) : "",
                                    shape: table.shape,
                                    width: table.width,
                                    height: table.height,
                                  })
                                } else {
                                  void openTable(table)
                                }
                              }}
                              disabled={busyTableId === table.id}
                              className={cn(
                                "absolute z-10 flex flex-col items-center justify-center gap-0.5 border-2 p-1.5 text-center transition-colors",
                                table.shape === "CIRCLE" ? "rounded-full" : "rounded-xl",
                                busy
                                  ? "border-kobipo-blue bg-kobipo-blue/10 dark:border-primary dark:bg-primary/15"
                                  : "border-dashed border-border bg-card hover:border-kobipo-blue hover:bg-kobipo-blue/5 dark:hover:border-primary",
                                editMode && "cursor-move touch-none",
                                dragging && "z-20 opacity-80 shadow-lg",
                              )}
                              style={{
                                left: table.x * CELL,
                                top: table.y * CELL,
                                width: table.width * CELL - 6,
                                height: table.height * CELL - 6,
                                transform: dragging ? `translate(${drag.dx}px, ${drag.dy}px)` : undefined,
                              }}
                            >
                              {busyTableId === table.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <>
                                  <span className="line-clamp-1 text-sm font-bold">{table.name}</span>
                                  {busy ? (
                                    <>
                                      <span className="text-xs font-semibold text-kobipo-blue dark:text-primary">
                                        {currency(table.openTicket!.total)}
                                      </span>
                                      <span className="text-[10px] text-muted-foreground">
                                        {elapsedLabel(table.openTicket!.openedAt, now)} ·{" "}
                                        {table.openTicket!.itemCount} kalem
                                      </span>
                                    </>
                                  ) : (
                                    <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                                      {table.capacity ? (
                                        <>
                                          <Users className="h-3 w-3" />
                                          {table.capacity}
                                        </>
                                      ) : (
                                        "Boş"
                                      )}
                                    </span>
                                  )}
                                </>
                              )}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Masa ekle/düzenle */}
      <Dialog open={tableDialog !== null} onOpenChange={(o) => !o && setTableDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tableDialog?.id ? "Masayı düzenle" : "Yeni masa"}</DialogTitle>
            <DialogDescription>
              Masa adı salonda benzersiz olmalı. Ölçüler ızgara hücresi cinsindendir.
            </DialogDescription>
          </DialogHeader>
          {tableDialog && (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label>Masa adı</Label>
                  <Input
                    autoFocus
                    value={tableDialog.name}
                    onChange={(e) => setTableDialog({ ...tableDialog, name: e.target.value })}
                    placeholder="M1"
                    className="mt-1.5"
                  />
                </div>
                <div>
                  <Label>Kişi kapasitesi</Label>
                  <Input
                    type="number"
                    min={0}
                    value={tableDialog.capacity}
                    onChange={(e) => setTableDialog({ ...tableDialog, capacity: e.target.value })}
                    placeholder="4"
                    className="mt-1.5"
                  />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label>Bölge</Label>
                  <Select
                    value={tableDialog.areaId}
                    onValueChange={(v) => setTableDialog({ ...tableDialog, areaId: v })}
                  >
                    <SelectTrigger className="mt-1.5">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_AREA}>Bölgesiz</SelectItem>
                      {areas.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Şekil</Label>
                  <div className="mt-1.5 flex gap-2">
                    <Button
                      type="button"
                      variant={tableDialog.shape === "SQUARE" ? "default" : "outline"}
                      size="sm"
                      className="flex-1"
                      onClick={() => setTableDialog({ ...tableDialog, shape: "SQUARE" })}
                    >
                      <Square className="mr-1.5 h-4 w-4" />
                      Kare
                    </Button>
                    <Button
                      type="button"
                      variant={tableDialog.shape === "CIRCLE" ? "default" : "outline"}
                      size="sm"
                      className="flex-1"
                      onClick={() => setTableDialog({ ...tableDialog, shape: "CIRCLE" })}
                    >
                      <Circle className="mr-1.5 h-4 w-4" />
                      Yuvarlak
                    </Button>
                  </div>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label>Genişlik (hücre)</Label>
                  <Input
                    type="number"
                    min={1}
                    max={12}
                    value={tableDialog.width}
                    onChange={(e) =>
                      setTableDialog({ ...tableDialog, width: Number(e.target.value) || 1 })
                    }
                    className="mt-1.5"
                  />
                </div>
                <div>
                  <Label>Yükseklik (hücre)</Label>
                  <Input
                    type="number"
                    min={1}
                    max={12}
                    value={tableDialog.height}
                    onChange={(e) =>
                      setTableDialog({ ...tableDialog, height: Number(e.target.value) || 1 })
                    }
                    className="mt-1.5"
                  />
                </div>
              </div>
            </div>
          )}
          <DialogFooter className="gap-2 sm:justify-between">
            {tableDialog?.id ? (
              <Button variant="outline" onClick={deleteTable} disabled={saving}>
                <Trash2 className="mr-1.5 h-4 w-4" />
                Kaldır
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setTableDialog(null)} disabled={saving}>
                Vazgeç
              </Button>
              <Button onClick={saveTable} disabled={saving}>
                {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                Kaydet
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Kroki öğesi düzenle */}
      <Dialog open={itemDialog !== null} onOpenChange={(o) => !o && setItemDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{itemDialog ? kindDef(itemDialog.kind).label : ""}</DialogTitle>
            <DialogDescription>
              Ölçüler ızgara hücresi cinsindendir. Duvarı uzatmak için genişliği artırın.
            </DialogDescription>
          </DialogHeader>
          {itemDialog && (
            <div className="space-y-3">
              <div>
                <Label>Etiket (isteğe bağlı)</Label>
                <Input
                  value={itemDialog.label}
                  onChange={(e) => setItemDialog({ ...itemDialog, label: e.target.value })}
                  placeholder={kindDef(itemDialog.kind).label}
                  className="mt-1.5"
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label>Genişlik</Label>
                  <Input
                    type="number"
                    min={1}
                    max={40}
                    value={itemDialog.width}
                    onChange={(e) =>
                      setItemDialog({ ...itemDialog, width: Number(e.target.value) || 1 })
                    }
                    className="mt-1.5"
                  />
                </div>
                <div>
                  <Label>Yükseklik</Label>
                  <Input
                    type="number"
                    min={1}
                    max={40}
                    value={itemDialog.height}
                    onChange={(e) =>
                      setItemDialog({ ...itemDialog, height: Number(e.target.value) || 1 })
                    }
                    className="mt-1.5"
                  />
                </div>
              </div>
            </div>
          )}
          <DialogFooter className="gap-2 sm:justify-between">
            <Button variant="outline" onClick={deleteItem} disabled={saving}>
              <Trash2 className="mr-1.5 h-4 w-4" />
              Sil
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setItemDialog(null)} disabled={saving}>
                Vazgeç
              </Button>
              <Button onClick={saveItem} disabled={saving}>
                {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                Kaydet
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bölge ekle */}
      <Dialog open={areaDialog !== null} onOpenChange={(o) => !o && setAreaDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Yeni bölge</DialogTitle>
            <DialogDescription>Bahçe, Üst Kat, Teras… Planda kendi bölümü olur.</DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={areaDialog?.name ?? ""}
            onChange={(e) => setAreaDialog({ name: e.target.value })}
            placeholder="Bahçe"
            onKeyDown={(e) => e.key === "Enter" && void saveArea()}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setAreaDialog(null)} disabled={saving}>
              Vazgeç
            </Button>
            <Button onClick={saveArea} disabled={saving}>
              Ekle
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
