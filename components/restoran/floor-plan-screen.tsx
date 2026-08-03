"use client"

// Salon planı — masaların yerleşimi, doluluğu ve DÜKKAN KROKİSİ.
// Kararlar: docs/restoran/ASAMA2.md (Faz B) · docs/restoran/KROKI-EDITORU.md
//
// Yerleşim koordinatı masanın/öğenin KENDİ satırındadır (ayrı bir plan JSON'u
// yok): jest bitince tek kayıt için `PATCH {x,y,width,height}` gider. Birim
// ızgara hücresidir — ekran ölçeği değişince yerleşim bozulmaz.
//
// İki kip bilinçli: KULLANIM kipinde masaya dokunmak adisyonu açar (garsonun
// tek işi bu), DÜZENLEME kipinde masa/kroki taşınır ve tutamaçtan boyutlandırılır.
// Tek kip olsaydı masayı taşımaya çalışan her dokunuş yanlışlıkla adisyon açardı.
//
// HER BÖLGE AYRI BİR KROKİDİR ve tuvali yataydır (sütun saklanır, satır
// türetilir — bkz. lib/restoran/floor-plan). "Tümü"de bölgeler kendi
// tuvallerinde çizilir; hepsini tek tuvale koymak yanlış olurdu: koordinat
// bölge içinde anlamlı, iki bölgenin (0,0)'ı aynı yer değil.
//
// Boş bölge KULLANIM kipinde tuval açmaz, altta tek satırlık bir şeride iner:
// dolu salonu ekranın altına itmeye değmiyordu. Düzenleme kipinde tuvali geri
// gelir — yeni açılan "Ön Bahçe" masası konana kadar çizilemez olmamalı.

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import {
  CalendarClock,
  Copy,
  LayoutGrid,
  Loader2,
  Move,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Sparkles,
  Square,
  Circle,
  Trash2,
  Users,
  X,
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
import { planItemDefaults } from "@/lib/restoran/ticket-constants"
import {
  PLAN_COLS_DEFAULT,
  PLAN_COLS_MIN,
  PLAN_COLS_STEPS,
  clampRect,
  contentRows,
  requiredCols,
  type PlanRect,
} from "@/lib/restoran/floor-plan"
import { currency } from "@/lib/fis/receipt-html"
import { cn } from "@/lib/utils"
import { FloorPlanCanvas, elapsedLabel, type PlanSelection } from "./floor-plan-canvas"
import { ReservationDialog } from "./reservation-dialog"
import {
  PLAN_KINDS,
  TABLE_STATE_STYLE,
  TABLE_TOOL,
  kindDef,
  tableState,
  type TableState,
} from "./plan-kinds"

const ALL_AREAS = "__ALL__"
const NO_AREA = "__NONE__"

/** Durum şeridinin sırası: garsonun ilgilendiği sıra. Hesap isteyen masa en
 *  acil, boş masa en sonda — ama boş sayısı da orada olmalı ("kaç kişi
 *  oturtabilirim" salonun en sık sorulan sorusu). */
const STATE_ORDER: TableState[] = ["OPEN", "BILL", "CLEANING", "RESERVED", "FREE"]

type TableForm = {
  id?: string
  name: string
  areaId: string
  capacity: string
  shape: string
  size: string
}

type ItemForm = { id: string; kind: string; label: string; size: string }

/** Bölge formu. `adopt` = "Bölgesiz" planı bu bölgeye dönüştür. */
type AreaForm = { id?: string; name: string; adopt?: boolean }

const emptyTableForm = (areaId: string | null): TableForm => ({
  name: "",
  areaId: areaId ?? NO_AREA,
  capacity: "",
  shape: "SQUARE",
  size: "2 × 2",
})

/**
 * Sıradaki masa adı: "M1", "M2"… Kalemle masa koyarken her seferinde ad sormak
 * 30 masalık bir salonu çizilemez hale getiriyordu; ad sonradan düzenlenir.
 * Ad firma genelinde benzersiz olduğu için TÜM masalara bakılır.
 */
function nextTableName(tables: PlanTable[]): string {
  let max = 0
  for (const t of tables) {
    const m = /^M\s*(\d+)$/i.exec(t.name.trim())
    if (m) max = Math.max(max, Number(m[1]))
  }
  return `M${max + 1}`
}

const sizeLabel = (r: { width: number; height: number }) => `${r.width} × ${r.height}`

export function FloorPlanScreen() {
  const { selectedCompanyId: companyId } = useDashboardCompany()
  const { toast } = useToast()
  const router = useRouter()

  const { areas, mutate: mutateAreas } = useAreas(companyId)
  const { tables, error, isLoading, mutate } = useTables(companyId)
  const { planItems, mutate: mutateItems } = usePlanItems(companyId)

  const [activeArea, setActiveArea] = useState<string>(ALL_AREAS)
  const [editMode, setEditMode] = useState(false)
  // Görüş yardımı: durum filtresi + masa arama. Yerleşim DEĞİŞMEZ, eşleşmeyen
  // masa yalnız soluklaşır — masaları listeye indirgemek salonun şeklini,
  // yani garsonun kafasındaki haritayı bozuyordu.
  const [focusState, setFocusState] = useState<TableState | null>(null)
  const [query, setQuery] = useState("")
  const [tool, setTool] = useState<string | null>(null)
  const [selection, setSelection] = useState<PlanSelection | null>(null)
  const [busyTableId, setBusyTableId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [tableDialog, setTableDialog] = useState<TableForm | null>(null)
  const [itemDialog, setItemDialog] = useState<ItemForm | null>(null)
  const [areaDialog, setAreaDialog] = useState<AreaForm | null>(null)
  const [reservationsOpen, setReservationsOpen] = useState(false)
  const [tableAction, setTableAction] = useState<PlanTable | null>(null)
  const [drop, setDrop] = useState<{ source: PlanTable; target: PlanTable } | null>(null)

  // Süre etiketleri dakikada bir tazelenir; saniyede bir render etmenin anlamı yok.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60000)
    return () => clearInterval(t)
  }, [])

  // Düzenlemeden çıkınca araç ve seçim düşer: kullanım kipinde ekranda
  // "Duvar çiziliyor" ipucunun asılı kalması kafa karıştırıyordu.
  useEffect(() => {
    if (!editMode) {
      setTool(null)
      setSelection(null)
    }
  }, [editMode])

  useEffect(() => {
    if (!tool) return
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setTool(null)
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [tool])

  // ---- Bölümleme ----------------------------------------------------------

  const sections = useMemo(() => {
    const build = (area: Area | null) => {
      const areaId = area?.id ?? null
      const sectionTables = tables.filter((t) => (areaId ? t.areaId === areaId : !t.areaId))
      const sectionItems = planItems.filter((i) => (areaId ? i.areaId === areaId : !i.areaId))
      // Kayıtlı genişlik içeriği kesiyorsa içerik kazanır: bir bölge daraltılıp
      // sonra başka yoldan masa eklenmişse masa tuvalin dışında kalmasın.
      const content = [...sectionTables, ...sectionItems]
      const stored = area?.gridSize ?? PLAN_COLS_DEFAULT
      const needed = requiredCols(content, PLAN_COLS_MIN)
      const cols = Math.max(stored, needed)
      // Satır SAKLANMAZ; kaç satır çizileceğine tuval karar verir (cevabı
      // piksel belirliyor). Buradan giden yalnız içeriğin dayattığı alt sınır.
      const minRows = contentRows(content)
      return {
        key: areaId ?? NO_AREA,
        areaId,
        area,
        name: area?.name ?? "Bölgesiz",
        tables: sectionTables,
        items: sectionItems,
        cols,
        minRows,
        minCols: needed,
      }
    }

    if (activeArea === ALL_AREAS) {
      const all = areas.map(build)
      const loose = build(null)
      // Bölgesiz tuvali yalnız içeriği varken (ya da hiç bölge yokken) gösterilir:
      // her planın altında boş bir "Bölgesiz" karesi gereksiz gürültü olurdu.
      if (loose.tables.length > 0 || loose.items.length > 0 || all.length === 0) all.push(loose)
      return all
    }
    if (activeArea === NO_AREA) return [build(null)]
    const area = areas.find((a) => a.id === activeArea)
    return [build(area ?? null)]
  }, [activeArea, areas, tables, planItems])

  const visibleTables = useMemo(() => sections.flatMap((s) => s.tables), [sections])
  const openCount = visibleTables.filter((t) => t.openTicket).length
  const openTotal = visibleTables.reduce((sum, t) => sum + (t.openTicket?.total ?? 0), 0)
  const stateCount = (state: TableState) =>
    visibleTables.filter((t) => tableState(t) === state).length

  const normalizedQuery = query.trim().toLocaleLowerCase("tr")
  const hasFocus = focusState !== null || normalizedQuery.length > 0
  const focusIds = useMemo(() => {
    if (!hasFocus) return null
    return new Set(
      visibleTables
        .filter(
          (t) =>
            (!focusState || tableState(t) === focusState) &&
            (!normalizedQuery || t.name.toLocaleLowerCase("tr").includes(normalizedQuery)),
        )
        .map((t) => t.id),
    )
  }, [focusState, hasFocus, normalizedQuery, visibleTables])

  /** Sekme rozetleri: hangi planda kaç masa var, kaçı dolu. Boş bir plana
   *  tıklayıp "burada bir şey yok" ile karşılaşmak gereksiz bir tur. */
  const areaStats = useMemo(() => {
    const map = new Map<string, { total: number; open: number }>()
    for (const t of tables) {
      const key = t.areaId ?? NO_AREA
      const cur = map.get(key) ?? { total: 0, open: 0 }
      cur.total += 1
      if (t.openTicket) cur.open += 1
      map.set(key, cur)
    }
    map.set(ALL_AREAS, {
      total: tables.length,
      open: tables.filter((t) => t.openTicket).length,
    })
    return map
  }, [tables])

  // Kullanım kipinde BOŞ plan tuval açmaz: iki boş kare, dolu salonu ekranın
  // altına itiyordu. Düzenlerken tam tersi — üzerine çizecek yüzey şart.
  const isFilled = (s: (typeof sections)[number]) => s.tables.length > 0 || s.items.length > 0
  const filledSections = editMode ? sections : sections.filter(isFilled)
  const emptySections = editMode ? [] : sections.filter((s) => !isFilled(s))

  /** "Şu plana masa koy" kısayolu: doğru sekmeye geç, düzenlemeyi aç, kalemi
   *  masaya al — üç ayrı tıklama tek düğmeye iner. */
  const startDrawing = (areaId: string | null) => {
    if (areaId) setActiveArea(areaId)
    setEditMode(true)
    setTool(TABLE_TOOL)
  }

  const selected = useMemo(() => {
    if (!selection) return null
    if (selection.type === "table") {
      const table = tables.find((t) => t.id === selection.id)
      return table ? { kind: "table" as const, table } : null
    }
    const item = planItems.find((i) => i.id === selection.id)
    return item ? { kind: "item" as const, item } : null
  }, [selection, tables, planItems])

  // ---- Yerleşim kaydı -----------------------------------------------------

  const commitGeometry = useCallback(
    async (sel: PlanSelection, rect: PlanRect) => {
      const isTable = sel.type === "table"
      // İyimser güncelleme: kayıt parmağın bıraktığı yerde kalsın, sunucu
      // yanıtını beklerken eski yerine geri zıplamasın.
      if (isTable) {
        await mutate((prev) => (prev ?? []).map((t) => (t.id === sel.id ? { ...t, ...rect } : t)), {
          revalidate: false,
        })
      } else {
        await mutateItems(
          (prev) => (prev ?? []).map((i) => (i.id === sel.id ? { ...i, ...rect } : i)),
          { revalidate: false },
        )
      }
      try {
        const res = await fetch(
          isTable ? `/api/restoran/masalar/${sel.id}` : `/api/restoran/plan/${sel.id}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ companyId, ...rect }),
          },
        )
        if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || "Kaydedilemedi")
      } catch (e: any) {
        toast({ title: "Yerleşim kaydedilemedi", description: e.message, variant: "destructive" })
      } finally {
        if (isTable) void mutate()
        else void mutateItems()
      }
    },
    [companyId, mutate, mutateItems, toast],
  )

  /** Kalemle çizim: `exact` false ise (tek tık) ölçü aracın varsayılanıdır. */
  const drawElement = useCallback(
    async (
      areaId: string | null,
      cols: number,
      rows: number,
      kind: string,
      rect: PlanRect,
      exact: boolean,
    ) => {
      try {
        if (kind === TABLE_TOOL) {
          const size = exact ? { width: rect.width, height: rect.height } : { width: 2, height: 2 }
          const placed = clampRect({ ...rect, ...size }, cols, rows)
          const res = await fetch("/api/restoran/masalar", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              companyId,
              name: nextTableName(tables),
              areaId,
              shape: "SQUARE",
              ...placed,
            }),
          })
          const body = await res.json().catch(() => ({}))
          if (!res.ok) throw new Error(body?.error || "Masa eklenemedi")
          void mutate()
          setSelection({ type: "table", id: body.id })
          return
        }

        const preset = planItemDefaults(kind)
        const size = exact ? { width: rect.width, height: rect.height } : preset
        const placed = clampRect({ ...rect, ...size }, cols, rows)
        const res = await fetch("/api/restoran/plan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ companyId, kind, areaId, ...placed }),
        })
        const body = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(body?.error || "Eklenemedi")
        void mutateItems()
        setSelection({ type: "item", id: body.id })
      } catch (e: any) {
        toast({ title: "Eklenemedi", description: e.message, variant: "destructive" })
      }
    },
    [companyId, mutate, mutateItems, tables, toast],
  )

  const duplicateSelection = useCallback(async () => {
    if (!selected) return
    try {
      if (selected.kind === "item") {
        const i = selected.item
        const res = await fetch("/api/restoran/plan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            companyId,
            kind: i.kind,
            areaId: i.areaId,
            label: i.label,
            x: i.x + 1,
            y: i.y + 1,
            width: i.width,
            height: i.height,
          }),
        })
        const body = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(body?.error || "Çoğaltılamadı")
        void mutateItems()
        setSelection({ type: "item", id: body.id })
        return
      }
      const t = selected.table
      const res = await fetch("/api/restoran/masalar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId,
          name: nextTableName(tables),
          areaId: t.areaId,
          capacity: t.capacity,
          shape: t.shape,
          x: t.x + 1,
          y: t.y + 1,
          width: t.width,
          height: t.height,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || "Çoğaltılamadı")
      void mutate()
      setSelection({ type: "table", id: body.id })
    } catch (e: any) {
      toast({ title: "Çoğaltılamadı", description: e.message, variant: "destructive" })
    }
  }, [companyId, mutate, mutateItems, selected, tables, toast])

  const deleteSelection = useCallback(async () => {
    if (!selected) return
    const isTable = selected.kind === "table"
    const id = isTable ? selected.table.id : selected.item.id
    try {
      const res = await fetch(
        isTable
          ? `/api/restoran/masalar/${id}?companyId=${companyId}`
          : `/api/restoran/plan/${id}?companyId=${companyId}`,
        { method: "DELETE" },
      )
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || "Silinemedi")
      setSelection(null)
      if (isTable) {
        void mutate()
        toast({
          title: body?.deactivated ? "Masa kullanım dışı bırakıldı" : "Masa silindi",
          description: body?.deactivated
            ? "Geçmiş adisyonları olduğu için kayıt korundu."
            : undefined,
        })
      } else {
        void mutateItems()
      }
    } catch (e: any) {
      toast({ title: "Silinemedi", description: e.message, variant: "destructive" })
    }
  }, [companyId, mutate, mutateItems, selected, toast])

  // ---- Kullanım kipi ------------------------------------------------------

  const openTicketFor = useCallback(
    async (table: PlanTable, reservationId?: string) => {
      setBusyTableId(table.id)
      try {
        const res = await fetch("/api/restoran/adisyonlar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ companyId, tableId: table.id, reservationId }),
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

  const onOpenTable = useCallback(
    (table: PlanTable) => {
      if (editMode) return
      if (table.openTicket) {
        router.push(withCompanyHref(`/restoran/adisyon/${table.openTicket.id}`, companyId))
        return
      }
      // Boş masa doğrudan açılır (garsonun en sık yaptığı iş bir dokunuşta
      // kalmalı). Belirsiz durumlar — toplanacak, rezerve — önce ne yapılacağını
      // sorar: rezerve masaya gelen geçen müşteriyi oturtmak rezervasyonu yakardı.
      if (table.cleaningSince || table.reservation) {
        setTableAction(table)
        return
      }
      void openTicketFor(table)
    },
    [companyId, editMode, openTicketFor, router],
  )

  const markCleaned = async (table: PlanTable) => {
    setTableAction(null)
    await mutate(
      (prev) => (prev ?? []).map((t) => (t.id === table.id ? { ...t, cleaningSince: null } : t)),
      { revalidate: false },
    )
    try {
      const res = await fetch(`/api/restoran/masalar/${table.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, cleaned: true }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || "Güncellenemedi")
    } catch (e: any) {
      toast({ title: "Güncellenemedi", description: e.message, variant: "destructive" })
    } finally {
      void mutate()
    }
  }

  const markNoShow = async (table: PlanTable) => {
    if (!table.reservation) return
    setTableAction(null)
    try {
      const res = await fetch(`/api/restoran/rezervasyonlar/${table.reservation.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, status: "NOSHOW" }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || "Güncellenemedi")
      toast({ title: "Rezervasyon 'gelmedi' işaretlendi" })
    } catch (e: any) {
      toast({ title: "Güncellenemedi", description: e.message, variant: "destructive" })
    } finally {
      void mutate()
    }
  }

  const confirmDrop = async () => {
    const source = drop?.source
    const target = drop?.target
    const sourceTicket = source?.openTicket
    if (!source || !target || !sourceTicket) return
    setSaving(true)
    try {
      if (target.openTicket) {
        const res = await fetch(`/api/restoran/adisyonlar/${target.openTicket.id}/birlestir`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ companyId, sourceTicketId: sourceTicket.id }),
        })
        const body = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(body?.error || "Birleştirilemedi")
        toast({
          title: "Adisyonlar birleştirildi",
          description: `${source.name} → ${target.name} · ${body.movedItems} kalem taşındı`,
        })
      } else {
        const res = await fetch(`/api/restoran/adisyonlar/${sourceTicket.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ companyId, tableId: target.id }),
        })
        const body = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(body?.error || "Taşınamadı")
        toast({ title: "Hesap taşındı", description: `${source.name} → ${target.name}` })
      }
      setDrop(null)
      void mutate()
    } catch (e: any) {
      toast({ title: "İşlem yapılamadı", description: e.message, variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

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
      if (!tableDialog.id) setSelection({ type: "table", id: body.id })
      toast({ title: tableDialog.id ? "Masa güncellendi" : "Masa eklendi", description: name })
    } catch (e: any) {
      toast({ title: "Kaydedilemedi", description: e.message, variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  const saveItem = async () => {
    if (!itemDialog) return
    setSaving(true)
    try {
      const res = await fetch(`/api/restoran/plan/${itemDialog.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, label: itemDialog.label }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || "Kaydedilemedi")
      setItemDialog(null)
      void mutateItems()
    } catch (e: any) {
      toast({ title: "Kaydedilemedi", description: e.message, variant: "destructive" })
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
      const res = await fetch(
        areaDialog.id ? `/api/restoran/bolgeler/${areaDialog.id}` : "/api/restoran/bolgeler",
        {
          method: areaDialog.id ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ companyId, name, adoptUnassigned: areaDialog.adopt }),
        },
      )
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || "Kaydedilemedi")
      setAreaDialog(null)
      void mutateAreas()
      if (areaDialog.adopt) {
        void mutate()
        void mutateItems()
      }
      if (!areaDialog.id) setActiveArea(body.id)
      toast({ title: areaDialog.id ? "Plan yeniden adlandırıldı" : "Plan eklendi", description: name })
    } catch (e: any) {
      toast({ title: "Kaydedilemedi", description: e.message, variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  const setAreaGrid = async (area: Area, gridSize: number) => {
    await mutateAreas(
      (prev) => (prev ?? []).map((a) => (a.id === area.id ? { ...a, gridSize } : a)),
      { revalidate: false },
    )
    try {
      const res = await fetch(`/api/restoran/bolgeler/${area.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, gridSize }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || "Değiştirilemedi")
    } catch (e: any) {
      toast({ title: "Plan boyutu değişmedi", description: e.message, variant: "destructive" })
    } finally {
      void mutateAreas()
    }
  }

  const deleteArea = async (area: Area) => {
    setSaving(true)
    try {
      const res = await fetch(`/api/restoran/bolgeler/${area.id}?companyId=${companyId}`, {
        method: "DELETE",
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || "Silinemedi")
      if (activeArea === area.id) setActiveArea(ALL_AREAS)
      void mutateAreas()
      void mutate()
      void mutateItems()
      toast({
        title: "Plan silindi",
        description: "Masalar silinmedi; 'Bölgesiz' planına taşındı.",
      })
    } catch (e: any) {
      toast({ title: "Silinemedi", description: e.message, variant: "destructive" })
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

  const areaTab = (key: string, label: string) => {
    const isActive = activeArea === key
    const stats = areaStats.get(key)
    return (
      <button
        key={key}
        type="button"
        title={stats ? `${stats.open} dolu / ${stats.total} masa` : undefined}
        onClick={() => setActiveArea(key)}
        className={cn(
          "inline-flex shrink-0 items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold transition-colors",
          isActive
            ? "bg-kobipo-blue text-white dark:bg-primary dark:text-primary-foreground"
            : "bg-muted text-muted-foreground hover:bg-muted/70",
        )}
      >
        {label}
        {stats && stats.total > 0 && (
          <span className={cn("text-xs font-normal tabular-nums", isActive ? "opacity-80" : "opacity-70")}>
            {stats.open > 0 ? `${stats.open}/${stats.total}` : stats.total}
          </span>
        )}
      </button>
    )
  }

  const activeToolLabel =
    tool === TABLE_TOOL ? "Masa" : tool ? kindDef(tool).label : null

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Masalar</h1>
          <p className="text-muted-foreground">
            {editMode
              ? "Araç seçip tuvale sürükleyin; öğeleri kenar ve köşelerinden çekerek boyutlandırın."
              : "Boş masaya dokunun, adisyon açılsın. Dolu masayı başka masaya sürüklerseniz hesap taşınır."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void mutate()} disabled={isLoading}>
            <RefreshCw className={cn("mr-1.5 h-4 w-4", isLoading && "animate-spin")} />
            Yenile
          </Button>
          <Button variant="outline" size="sm" onClick={() => setReservationsOpen(true)}>
            <CalendarClock className="mr-1.5 h-4 w-4" />
            Rezervasyon
          </Button>
          <Button
            variant={editMode ? "default" : "outline"}
            size="sm"
            onClick={() => setEditMode((v) => !v)}
          >
            <Move className="mr-1.5 h-4 w-4" />
            {editMode ? "Düzenlemeyi bitir" : "Planı düzenle"}
          </Button>
        </div>
      </div>

      {/* Plan sekmeleri */}
      {(areas.length > 0 || tables.some((t) => !t.areaId)) && (
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
          {areaTab(ALL_AREAS, "Tümü")}
          {areas.map((a: Area) => areaTab(a.id, a.name))}
          {tables.some((t) => !t.areaId) && areaTab(NO_AREA, "Bölgesiz")}
          {editMode && (
            <Button
              variant="outline"
              size="sm"
              className="ml-1 shrink-0 rounded-full"
              onClick={() => setAreaDialog({ name: "" })}
            >
              <Plus className="mr-1 h-4 w-4" />
              Plan ekle
            </Button>
          )}
        </div>
      )}

      {/* Düzenleme araç çubuğu — araç GLOBALDİR, hangi tuvale sürüklerseniz
          öğe oraya düşer. Bölüm başına ayrı çubuk ekranı doldururdu. */}
      {editMode && (
        <Card className="sticky top-2 z-30 shadow-sm">
          <CardContent className="space-y-2 p-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <Button
                size="sm"
                variant={tool === TABLE_TOOL ? "default" : "outline"}
                onClick={() => setTool(tool === TABLE_TOOL ? null : TABLE_TOOL)}
              >
                <Square className="mr-1 h-3.5 w-3.5" />
                Masa
              </Button>
              <span className="mx-1 hidden text-xs text-muted-foreground sm:inline">Kroki:</span>
              {PLAN_KINDS.map((k) => {
                const Icon = k.icon
                return (
                  <Button
                    key={k.kind}
                    size="sm"
                    variant={tool === k.kind ? "default" : "outline"}
                    title={k.label}
                    onClick={() => setTool(tool === k.kind ? null : k.kind)}
                  >
                    <Icon className="mr-1 h-3.5 w-3.5" />
                    <span className="text-xs">{k.label}</span>
                  </Button>
                )
              })}
            </div>

            <p className="text-xs text-muted-foreground">
              {activeToolLabel ? (
                <>
                  <strong className="text-foreground">{activeToolLabel}</strong> seçili — tuvale
                  sürükleyerek istediğiniz boyutta çizin, tek tıkla varsayılan boyutta ekleyin.
                  Bırakmak için <kbd className="rounded border px-1">Esc</kbd>.
                </>
              ) : (
                "Bir araç seçin ya da mevcut bir öğeye dokunup kenarlarından çekin. Ok tuşları taşır, Shift+ok boyutlandırır."
              )}
            </p>

            {/* Seçim müfettişi */}
            {selected && (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/40 px-2.5 py-2 text-sm">
                <span className="font-semibold">
                  {selected.kind === "table"
                    ? selected.table.name
                    : selected.item.label || kindDef(selected.item.kind).label}
                </span>
                <span className="rounded bg-background px-1.5 py-0.5 text-xs tabular-nums text-muted-foreground">
                  {sizeLabel(selected.kind === "table" ? selected.table : selected.item)} hücre
                </span>
                <div className="ml-auto flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7"
                    onClick={() =>
                      selected.kind === "table"
                        ? setTableDialog({
                            id: selected.table.id,
                            name: selected.table.name,
                            areaId: selected.table.areaId ?? NO_AREA,
                            capacity:
                              selected.table.capacity != null
                                ? String(selected.table.capacity)
                                : "",
                            shape: selected.table.shape,
                            size: sizeLabel(selected.table),
                          })
                        : setItemDialog({
                            id: selected.item.id,
                            kind: selected.item.kind,
                            label: selected.item.label ?? "",
                            size: sizeLabel(selected.item),
                          })
                    }
                  >
                    <Settings2 className="mr-1 h-3.5 w-3.5" />
                    Ayarlar
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7"
                    onClick={() => void duplicateSelection()}
                  >
                    <Copy className="mr-1 h-3.5 w-3.5" />
                    Çoğalt
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-red-600 dark:text-red-400"
                    onClick={() => void deleteSelection()}
                  >
                    <Trash2 className="mr-1 h-3.5 w-3.5" />
                    Sil
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Durum şeridi — aynı anda özet, LEJANT ve filtre. Renklerin anlamını
          ayrı bir kutuda anlatmak yerine sayacın kendisi örnek oluyor;
          tıklanınca o durumdaki masalar planda öne çıkar. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-border bg-card px-3 py-2">
        <span className="text-sm">
          <strong className="tabular-nums">{visibleTables.length}</strong> masa ·{" "}
          <strong className="tabular-nums">{openCount}</strong> dolu
        </span>

        {openTotal > 0 && (
          <span className="rounded-lg bg-kobipo-blue/10 px-2.5 py-1 text-sm font-semibold text-kobipo-blue dark:bg-primary/10 dark:text-primary">
            Açık hesap: {currency(openTotal)}
          </span>
        )}

        <div className="flex flex-wrap items-center gap-0.5">
          {STATE_ORDER.map((state) => {
            const count = stateCount(state)
            const active = focusState === state
            const label = TABLE_STATE_STYLE[state].label
            return (
              <button
                key={state}
                type="button"
                disabled={count === 0}
                aria-pressed={active}
                title={
                  count === 0
                    ? `${label} masa yok`
                    : `Yalnız ${label.toLowerCase()} masaları vurgula`
                }
                onClick={() => setFocusState(active ? null : state)}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs transition-colors",
                  count === 0 ? "opacity-40" : "hover:bg-muted",
                  active && "bg-muted ring-1 ring-border",
                )}
              >
                <span
                  className={cn(
                    "h-3 w-3 shrink-0 rounded-[3px] border-2",
                    TABLE_STATE_STYLE[state].className,
                  )}
                />
                <span className="font-semibold tabular-nums">{count}</span>
                <span className="text-muted-foreground">{label}</span>
              </button>
            )
          })}
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          {hasFocus && (
            <>
              <span className="text-xs text-muted-foreground">
                {focusIds?.size ?? 0} masa vurgulandı
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-8"
                onClick={() => {
                  setFocusState(null)
                  setQuery("")
                }}
              >
                <X className="mr-1 h-3.5 w-3.5" />
                Temizle
              </Button>
            </>
          )}
          {tables.length > 6 && (
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Masa ara"
                className="h-8 w-36 pl-8 text-sm"
              />
            </div>
          )}
        </div>
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
      ) : filledSections.length === 0 ? (
        // Hiçbir planda masa yok. Bu ekranın ilk açılışı: ne yapılacağını
        // söylemek, boş bir ızgara göstermekten çok daha yararlı.
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <div className="rounded-full bg-muted p-3">
              <LayoutGrid className="h-6 w-6 text-muted-foreground" />
            </div>
            <div>
              <h3 className="text-base font-semibold">
                {sections.length === 1 ? `"${sections[0].name}" planı boş` : "Salon planı boş"}
              </h3>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                Masaları krokiye yerleştirin; garson masaya dokunduğunda adisyon açılır. Duvar,
                bar, mutfak gibi öğelerle salonun şeklini de çizebilirsiniz.
              </p>
            </div>
            {sections.length > 1 ? (
              <div className="flex flex-wrap justify-center gap-1.5">
                {sections.map((s) => (
                  <Button
                    key={s.key}
                    variant="outline"
                    size="sm"
                    onClick={() => startDrawing(s.areaId)}
                  >
                    <Plus className="mr-1 h-3.5 w-3.5" />
                    {s.name}
                  </Button>
                ))}
              </div>
            ) : (
              <Button onClick={() => startDrawing(sections[0]?.areaId ?? null)}>
                <Plus className="mr-1.5 h-4 w-4" />
                Masaları yerleştir
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        // Her plan kendi satırını kaplar. Yan yana iki plan, tuvalin genişliğini
        // yarıya indirip masaları küçültüyordu; tuval ne kadar genişse hem masa
        // okunur hem tutamaç rahat.
        <div className="grid gap-4">
          {filledSections.map((section) => {
            const sectionOpen = section.tables.filter((t) => t.openTicket).length
            const sectionTotal = section.tables.reduce(
              (sum, t) => sum + (t.openTicket?.total ?? 0),
              0,
            )
            const empty = section.tables.length === 0 && section.items.length === 0

            return (
              <Card key={section.key}>
                <CardContent className="space-y-3 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-baseline gap-2">
                      <h2 className="text-lg font-semibold">{section.name}</h2>
                      <span className="text-xs text-muted-foreground">
                        {section.tables.length} masa · {sectionOpen} dolu
                        {sectionTotal > 0 && ` · ${currency(sectionTotal)}`}
                      </span>
                    </div>

                    {editMode && (
                      <div className="flex flex-wrap items-center gap-1.5">
                        {section.area ? (
                          <>
                            {/* Saklanan ölçü ALT SINIRDIR: tuval ekranda yer
                                varsa kendiliğinden genişler. Büyük bir değer
                                seçmek ızgarayı sıklaştırır (hücre küçülür),
                                dar ekranda da planın genişliğini korur. */}
                            <Select
                              value={String(section.area.gridSize)}
                              onValueChange={(v) => void setAreaGrid(section.area!, Number(v))}
                            >
                              <SelectTrigger
                                className="h-8 w-[152px] text-xs"
                                title="Planın en az kaç sütun olacağı — ekranda yer varsa tuval sağa doğru kendiliğinden genişler."
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {PLAN_COLS_STEPS.map((step) => (
                                  <SelectItem
                                    key={step}
                                    value={String(step)}
                                    disabled={step < section.minCols}
                                  >
                                    en az {step} sütun
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8"
                              onClick={() =>
                                setAreaDialog({ id: section.area!.id, name: section.area!.name })
                              }
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8 text-red-600 dark:text-red-400"
                              disabled={saving}
                              onClick={() => void deleteArea(section.area!)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </>
                        ) : (
                          // Bölgesiz planın saklayacak satırı yok → boyutu
                          // içerikten türetilir. Adlandırmak onu gerçek bir
                          // plana çevirir ve boyut ayarlanabilir hale gelir.
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 text-xs"
                            onClick={() => setAreaDialog({ name: "Salon", adopt: true })}
                          >
                            Bu planı adlandır
                          </Button>
                        )}
                      </div>
                    )}
                  </div>

                  {empty && (
                    <p className="text-xs text-muted-foreground">
                      Bu plan boş — yukarıdan bir araç seçip tuvale sürükleyin.
                    </p>
                  )}

                  <FloorPlanCanvas
                    minCols={section.cols}
                    minRows={section.minRows}
                    tables={section.tables}
                    items={section.items}
                    editMode={editMode}
                    tool={tool}
                    selection={selection}
                    busyTableId={busyTableId}
                    focusIds={focusIds}
                    now={now}
                    onSelect={setSelection}
                    onGeometry={commitGeometry}
                    onDraw={(kind, rect, exact, grid) =>
                      void drawElement(section.areaId, grid.cols, grid.rows, kind, rect, exact)
                    }
                    onOpenTable={onOpenTable}
                    onTableDrop={(source, target) => {
                      if (!source.openTicket) return
                      setDrop({ source, target })
                    }}
                    onDeleteSelection={() => void deleteSelection()}
                    onDuplicateSelection={() => void duplicateSelection()}
                  />
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Masası olmayan planlar tek satıra iner: boş bir tuval, dolu salonu
          ekranın altına itmeye değmez — ama plan var olduğu ve masa
          eklenebildiği görünmeli. */}
      {filledSections.length > 0 && emptySections.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-border px-3 py-2">
          <span className="text-xs font-medium text-muted-foreground">
            Masası olmayan planlar:
          </span>
          {emptySections.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => startDrawing(s.areaId)}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-1 text-xs font-medium transition-colors hover:border-kobipo-blue hover:text-kobipo-blue dark:hover:border-primary dark:hover:text-primary"
            >
              <Plus className="h-3 w-3" />
              {s.name}
            </button>
          ))}
        </div>
      )}

      {/* Masa ayarları — ölçü BURADA YOK: tutamaçtan çekilir. Sayı girmek
          krokiyi çizilemez hale getiriyordu (kullanıcı geri bildirimi). */}
      <Dialog open={tableDialog !== null} onOpenChange={(o) => !o && setTableDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tableDialog?.id ? "Masa ayarları" : "Yeni masa"}</DialogTitle>
            <DialogDescription>
              Masa adı salonda benzersiz olmalı. Ölçüyü planda kenarlarından çekerek verirsiniz.
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
                  <Label>Plan</Label>
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

              {tableDialog.id && (
                <p className="text-xs text-muted-foreground">
                  Ölçü: <strong>{tableDialog.size}</strong> hücre — planda kenar/köşe
                  tutamaçlarından değiştirin.
                </p>
              )}
            </div>
          )}
          <DialogFooter className="gap-2 sm:justify-between">
            {tableDialog?.id ? (
              <Button
                variant="outline"
                onClick={() => {
                  setTableDialog(null)
                  void deleteSelection()
                }}
                disabled={saving}
              >
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

      {/* Kroki öğesi */}
      <Dialog open={itemDialog !== null} onOpenChange={(o) => !o && setItemDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{itemDialog ? kindDef(itemDialog.kind).label : ""}</DialogTitle>
            <DialogDescription>
              Ölçü {itemDialog?.size} hücre — planda kenarlarından çekerek değiştirin.
            </DialogDescription>
          </DialogHeader>
          {itemDialog && (
            <div>
              <Label>Etiket (isteğe bağlı)</Label>
              <Input
                autoFocus
                value={itemDialog.label}
                onChange={(e) => setItemDialog({ ...itemDialog, label: e.target.value })}
                placeholder={kindDef(itemDialog.kind).label}
                className="mt-1.5"
                onKeyDown={(e) => e.key === "Enter" && void saveItem()}
              />
            </div>
          )}
          <DialogFooter className="gap-2 sm:justify-between">
            <Button
              variant="outline"
              onClick={() => {
                setItemDialog(null)
                void deleteSelection()
              }}
              disabled={saving}
            >
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

      {/* Plan ekle / yeniden adlandır */}
      <Dialog open={areaDialog !== null} onOpenChange={(o) => !o && setAreaDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {areaDialog?.id
                ? "Planı yeniden adlandır"
                : areaDialog?.adopt
                  ? "Planı adlandır"
                  : "Yeni plan"}
            </DialogTitle>
            <DialogDescription>
              {areaDialog?.adopt
                ? "Bölgesiz masalar ve kroki öğeleri bu plana taşınır; plan genişliği ayarlanabilir hale gelir."
                : "Ön Bahçe, Arka Bahçe, Üst Kat, Teras… Her plan kendi krokisidir."}
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={areaDialog?.name ?? ""}
            onChange={(e) => setAreaDialog({ ...areaDialog!, name: e.target.value })}
            placeholder="Ön Bahçe"
            onKeyDown={(e) => e.key === "Enter" && void saveArea()}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setAreaDialog(null)} disabled={saving}>
              Vazgeç
            </Button>
            <Button onClick={saveArea} disabled={saving}>
              {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              {areaDialog?.id ? "Kaydet" : "Ekle"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Kullanım kipi — belirsiz durumdaki masaya dokunuldu */}
      <Dialog open={tableAction !== null} onOpenChange={(o) => !o && setTableAction(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{tableAction?.name}</DialogTitle>
            <DialogDescription>
              {tableAction?.reservation
                ? `${tableAction.reservation.guestName} adına ${new Date(
                    tableAction.reservation.reservedAt,
                  ).toLocaleTimeString("tr-TR", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })} rezervasyonu var${
                    tableAction.reservation.guestCount
                      ? ` (${tableAction.reservation.guestCount} kişi)`
                      : ""
                  }.`
                : tableAction?.cleaningSince
                  ? `Hesap ${elapsedLabel(tableAction.cleaningSince, now)} önce kapandı, masa henüz toplanmadı.`
                  : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {tableAction?.reservation && (
              <Button
                className="w-full justify-start"
                onClick={() => {
                  const t = tableAction
                  setTableAction(null)
                  void openTicketFor(t, t.reservation!.id)
                }}
              >
                <Users className="mr-2 h-4 w-4" />
                Rezervasyonu oturt ve adisyon aç
              </Button>
            )}
            {tableAction?.cleaningSince && (
              <Button
                variant="outline"
                className="w-full justify-start"
                onClick={() => void markCleaned(tableAction)}
              >
                <Sparkles className="mr-2 h-4 w-4" />
                Masa toplandı
              </Button>
            )}
            <Button
              variant={tableAction?.reservation ? "outline" : "default"}
              className="w-full justify-start"
              onClick={() => {
                const t = tableAction
                setTableAction(null)
                if (t) void openTicketFor(t)
              }}
            >
              <Plus className="mr-2 h-4 w-4" />
              {tableAction?.reservation ? "Rezervasyonsuz adisyon aç" : "Yeni adisyon aç"}
            </Button>
            {tableAction?.reservation && (
              <Button
                variant="ghost"
                className="w-full justify-start text-muted-foreground"
                onClick={() => void markNoShow(tableAction)}
              >
                Misafir gelmedi
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Taşı / birleştir onayı */}
      <Dialog open={drop !== null} onOpenChange={(o) => !o && setDrop(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {drop?.target.openTicket ? "Adisyonları birleştir" : "Hesabı taşı"}
            </DialogTitle>
            <DialogDescription>
              {drop?.target.openTicket ? (
                <>
                  <strong>{drop.source.name}</strong> ({currency(drop.source.openTicket!.total)})
                  hesabı <strong>{drop.target.name}</strong> (
                  {currency(drop.target.openTicket.total)}) hesabına aktarılacak. Kaynak adisyon
                  kapanır, kalemleri hedefe geçer.
                </>
              ) : (
                <>
                  <strong>{drop?.source.name}</strong> masasının açık hesabı{" "}
                  <strong>{drop?.target.name}</strong> masasına taşınacak.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          {drop?.target.openTicket && drop.source.openTicket && (
            <p className="rounded-lg bg-muted px-3 py-2 text-sm">
              Birleşen hesap:{" "}
              <strong>
                {currency(drop.source.openTicket.total + drop.target.openTicket.total)}
              </strong>{" "}
              · Kaynak adisyondaki iskonto düşer, hedefte yeniden verebilirsiniz.
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDrop(null)} disabled={saving}>
              Vazgeç
            </Button>
            <Button onClick={confirmDrop} disabled={saving}>
              {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              {drop?.target.openTicket ? "Birleştir" : "Taşı"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ReservationDialog
        open={reservationsOpen}
        onOpenChange={setReservationsOpen}
        companyId={companyId}
        tables={tables}
        onChanged={() => void mutate()}
      />
    </div>
  )
}
