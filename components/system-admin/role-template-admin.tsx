"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Loader2, Pencil, Plus, RefreshCw, Trash2, Users } from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from "@/components/ui/use-toast"
import { useConfirm } from "@/components/ui/confirm-dialog-provider"
import {
  PagePermissionPicker,
  accessFromPaths,
  pathsFromAccess,
  type Access,
} from "@/components/dashboard/page-permission-picker"
import { ACCOUNT_ADMIN_PAGES, assignablePages, navPage } from "@/lib/nav/pages"

/**
 * Hazır rol kalıbı kataloğu — Kobipo'nun tüm firmalara sunduğu başlangıç rolleri
 * (Kasiyer, Garson, Depo Sorumlusu…). Firma karta tıklayınca kalıp KOPYALANIR.
 *
 * Buradaki değişiklik ÜRETİLMİŞ ROLLERİ ETKİLEMEZ: "kaç rol üretilmiş" sayısı bugüne
 * kadar kaç firma rolünün bu kalıptan doğduğunu söyler, kaç rolün etkileneceğini değil.
 */

type RoleTemplateRow = {
  id: string
  key: string
  name: string
  description: string | null
  allowedPaths: string[]
  writablePaths: string[]
  sortOrder: number
  isActive: boolean
  usageCount: number
}

export function RoleTemplateAdmin() {
  const { toast } = useToast()
  const { confirm } = useConfirm()
  const [rows, setRows] = useState<RoleTemplateRow[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<RoleTemplateRow | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/system-admin/role-templates", { cache: "no-store" })
      const data = await res.json().catch(() => ({}))
      setRows(res.ok && Array.isArray(data?.data) ? data.data : [])
      if (!res.ok) {
        toast({
          title: "Kalıplar yüklenemedi",
          // Sebebi sunucu söyler. Burada tahmin yürütmek ("migrasyon uygulanmamış
          // olabilir") migrasyonu uygulamış yöneticiyi yanlış yere bakmaya gönderiyordu.
          description: data?.error ?? `Sunucu ${res.status} döndürdü.`,
          variant: "destructive",
        })
      }
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    load()
  }, [load])

  const openNew = () => {
    setEditing(null)
    setDialogOpen(true)
  }

  const openEdit = (row: RoleTemplateRow) => {
    setEditing(row)
    setDialogOpen(true)
  }

  /** Aktiflik satırın içinden çevrilir: kalıbı yayından kaldırmak tek tıklık iş olmalı. */
  const toggleActive = async (row: RoleTemplateRow) => {
    const res = await fetch(`/api/system-admin/role-templates/${row.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !row.isActive }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      toast({ title: "Güncellenemedi", description: data?.error, variant: "destructive" })
      return
    }
    toast({ title: row.isActive ? `"${row.name}" yayından kaldırıldı` : `"${row.name}" yayında` })
    load()
  }

  const remove = async (row: RoleTemplateRow) => {
    const ok = await confirm({
      title: "Kalıbı sil",
      description:
        row.usageCount > 0
          ? `"${row.name}" kalıbı silinsin mi? Bu kalıptan üretilmiş ${row.usageCount} firma rolü ÇALIŞMAYA DEVAM EDER (kalıp kopyalanır, bağlanmaz) — kalıp yalnız katalogdan kalkar.`
          : `"${row.name}" kalıbı silinsin mi?`,
      confirmLabel: "Sil",
      variant: "destructive",
    })
    if (!ok) return
    const res = await fetch(`/api/system-admin/role-templates/${row.id}`, { method: "DELETE" })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      toast({ title: "Silinemedi", description: data?.error, variant: "destructive" })
      return
    }
    toast({ title: "Kalıp silindi" })
    load()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end gap-2">
        <button
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg bg-slate-800 px-3 py-2 text-sm text-slate-200 hover:bg-slate-700 disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Yenile
        </button>
        <button
          onClick={openNew}
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500"
        >
          <Plus className="h-4 w-4" />
          Yeni kalıp
        </button>
      </div>

      <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-5">
        <h2 className="text-lg font-semibold text-white">Kalıplar</h2>
        <p className="text-sm text-slate-500">
          Firma, Ayarlar → Rol Yetkileri ekranında bu kartları görür. Karta tıklayınca kalıp
          firmanın rolüne KOPYALANIR; sonradan burada yapılan değişiklik o rolü değiştirmez.
        </p>

        <div className="mt-4 space-y-2">
          {loading && rows.length === 0 && <p className="text-sm text-slate-500">Yükleniyor…</p>}
          {!loading && rows.length === 0 && (
            <p className="text-sm text-slate-500">
              Katalog boş. “Yeni kalıp” ile ekleyin — katalog boşken firma ekranında “Hazır
              kalıplar” bölümü hiç görünmez.
            </p>
          )}
          {rows.map((row) => (
            <div
              key={row.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-900 p-3"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-white">{row.name}</span>
                  <code className="rounded bg-slate-800 px-1.5 py-0.5 text-[11px] text-slate-400">
                    {row.key}
                  </code>
                  {!row.isActive && (
                    <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] text-slate-400">
                      Yayında değil
                    </span>
                  )}
                </div>
                {row.description && (
                  <div className="mt-0.5 text-xs text-slate-400">{row.description}</div>
                )}
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                  <span>{row.allowedPaths.length} sayfa</span>
                  <span>{row.writablePaths.length} düzenleme</span>
                  <span className="inline-flex items-center gap-1">
                    <Users className="h-3 w-3" />
                    {row.usageCount} rol üretilmiş
                  </span>
                  <span>sıra {row.sortOrder}</span>
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  {row.allowedPaths
                    .slice(0, 6)
                    .map((href) => navPage(href)?.label ?? href)
                    .join(", ")}
                  {row.allowedPaths.length > 6 ? ` +${row.allowedPaths.length - 6}` : ""}
                </div>
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  onClick={() => toggleActive(row)}
                  className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-700"
                >
                  {row.isActive ? "Yayından kaldır" : "Yayına al"}
                </button>
                <button
                  onClick={() => openEdit(row)}
                  className="inline-flex items-center gap-1 rounded-lg bg-slate-800 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-700"
                >
                  <Pencil className="h-3.5 w-3.5" /> Düzenle
                </button>
                <button
                  onClick={() => remove(row)}
                  className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs text-red-300 hover:bg-red-950/60"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <RoleTemplateDialog
        open={dialogOpen}
        template={editing}
        onClose={() => {
          setDialogOpen(false)
          setEditing(null)
        }}
        onSaved={load}
      />
    </div>
  )
}

function RoleTemplateDialog({
  open,
  template,
  onClose,
  onSaved,
}: {
  open: boolean
  template: RoleTemplateRow | null
  onClose: () => void
  onSaved: () => void
}) {
  const { toast } = useToast()
  /**
   * Kalıp GENELDİR: seçilebilir liste firmaya göre süzülmez, panelin tüm sayfalarını
   * (hesap yönetimi ekranları hariç) içerir. Firmada kapalı olan modülün sayfası kalıptan
   * kendiliğinden düşer — o süzgeç firma ekranında uygulanıyor (`filterAvailablePages`).
   */
  const selectable = useMemo(() => assignablePages(), [])
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [sortOrder, setSortOrder] = useState("0")
  const [isActive, setIsActive] = useState(true)
  const [access, setAccess] = useState<Record<string, Access>>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setName(template?.name ?? "")
    setDescription(template?.description ?? "")
    setSortOrder(String(template?.sortOrder ?? 0))
    setIsActive(template?.isActive ?? true)
    setAccess(
      accessFromPaths(selectable, template?.allowedPaths ?? [], template?.writablePaths ?? [])
    )
  }, [open, template, selectable])

  const save = async () => {
    if (!name.trim()) {
      toast({ title: "Kalıp adı zorunlu", variant: "destructive" })
      return
    }
    const { allowedPaths, writablePaths } = pathsFromAccess(access)
    if (allowedPaths.length === 0) {
      toast({ title: "En az bir sayfa seçin", variant: "destructive" })
      return
    }
    setSaving(true)
    try {
      const res = await fetch(
        template
          ? `/api/system-admin/role-templates/${template.id}`
          : "/api/system-admin/role-templates",
        {
          method: template ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: name.trim(),
            description: description.trim() || null,
            allowedPaths,
            writablePaths,
            sortOrder: Number(sortOrder) || 0,
            isActive,
          }),
        }
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || "Kaydedilemedi")
      toast({ title: template ? "Kalıp güncellendi" : `"${name.trim()}" kalıbı eklendi` })
      onSaved()
      onClose()
    } catch (error) {
      toast({
        title: "Hata",
        description: error instanceof Error ? error.message : "Kaydedilemedi",
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  const adminLabels = ACCOUNT_ADMIN_PAGES.map((h) => navPage(h)?.label).filter(Boolean).join(", ")

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[88vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{template ? "Kalıbı düzenle" : "Yeni hazır kalıp"}</DialogTitle>
          <DialogDescription>
            Firmanın Rol Yetkileri ekranında kart olarak görünür. Hesap yönetimi ekranları
            ({adminLabels}) kalıba da yazılamaz: bunlar yetki dağıtan ekranlardır ve yalnız
            firma yöneticisinde kalır.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="tpl-name">Kalıp adı</Label>
            <Input
              id="tpl-name"
              value={name}
              placeholder="ör. Kurye"
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="tpl-desc">Açıklama</Label>
            <Input
              id="tpl-desc"
              value={description}
              placeholder="Bu rol ne yapar, nesi kapalı?"
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="tpl-order">Sıra</Label>
            <Input
              id="tpl-order"
              type="number"
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value)}
            />
            <p className="mt-1 text-xs text-muted-foreground">Küçük olan kartlarda önce çıkar.</p>
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
              />
              Yayında (firmalara gösterilsin)
            </label>
          </div>
        </div>

        {template && (
          <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-200">
            Bu kalıptan bugüne kadar {template.usageCount} firma rolü üretilmiş. Kalıp
            kopyalandığı için buradaki değişiklik onları ETKİLEMEZ; yalnız bundan sonra
            üretilecek roller değişir. Anahtar (<code>{template.key}</code>) sabittir, ad
            değişse bile korunur.
          </p>
        )}

        <PagePermissionPicker selectableHrefs={selectable} access={access} onChange={setAccess} />

        <div className="flex justify-end gap-2 border-t pt-3">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Vazgeç
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Kaydediliyor…" : template ? "Değişiklikleri kaydet" : "Kalıbı ekle"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
