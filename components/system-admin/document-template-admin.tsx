"use client"

import { useCallback, useEffect, useState } from "react"
import { Copy, FileText, Loader2, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/use-toast"
import { useConfirm } from "@/components/ui/confirm-dialog-provider"
import { BelgeSablonEditoru, type SablonFormDegeri } from "@/components/personel/belge-sablon-editoru"
import { govdeDuzMetin } from "@/lib/personel/belge-govde"

/**
 * İK belge şablonu KATALOĞU — Kobipo'nun tüm firmalara sunduğu hazır belgeler.
 *
 * Buradaki değişiklik FİRMA KOPYALARINI ETKİLEMEZ: "kopyalanmış" sayısı bugüne kadar
 * kaç firmanın bu kalıbı kendine alıp özelleştirdiğini söyler. O firmalar artık kendi
 * metinlerini kullanıyor; katalogdaki düzeltme onlara GİTMEZ. Ters kurgu, müşterinin
 * elleyip onayladığı belge metnini sessizce değiştirirdi.
 */

type SablonSatiri = {
  id: string
  key: string
  title: string
  category: string | null
  description: string | null
  body: string
  sortOrder: number
  isActive: boolean
  kopyaSayisi: number
}

const bosForm = (): SablonFormDegeri => ({
  title: "",
  category: null,
  description: null,
  body: "",
  sortOrder: 0,
  isActive: true,
})

export function DocumentTemplateAdmin() {
  const { toast } = useToast()
  const { confirm } = useConfirm()
  const [rows, setRows] = useState<SablonSatiri[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<SablonSatiri | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/system-admin/document-templates", { cache: "no-store" })
      const data = await res.json().catch(() => ({}))
      setRows(res.ok && Array.isArray(data?.data) ? data.data : [])
      if (!res.ok) {
        toast({
          title: "Şablonlar yüklenemedi",
          // Sebebi SUNUCU söyler; burada tahmin yürütmek yöneticiyi yanlış yere
          // bakmaya gönderir (bkz. role-template-admin).
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

  const sil = async (row: SablonSatiri) => {
    const onay = await confirm({
      title: `"${row.title}" şablonu silinsin mi?`,
      description:
        row.kopyaSayisi > 0
          ? `${row.kopyaSayisi} firma bu şablonu kopyalayıp özelleştirmiş. Onların kendi metinleri SİLİNMEZ, çalışmaya devam eder; yalnız katalogdaki bu kalıp kalkar.`
          : "Katalogdan kaldırılır; yeni firmalar bu şablonu görmez.",
      confirmLabel: "Sil",
      variant: "destructive",
    })
    if (!onay) return

    const res = await fetch(`/api/system-admin/document-templates/${row.id}`, { method: "DELETE" })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      toast({ title: "Silinemedi", description: data?.error, variant: "destructive" })
      return
    }
    toast({ title: "Şablon silindi" })
    load()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Yenile
        </Button>
        <Button
          size="sm"
          onClick={() => {
            setEditing(null)
            setDialogOpen(true)
          }}
        >
          <Plus className="mr-2 h-4 w-4" />
          Yeni şablon
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Yükleniyor…
        </div>
      ) : rows.length === 0 ? (
        <p className="rounded-lg border border-slate-700 bg-slate-800/40 p-6 text-center text-slate-400">
          Katalogda şablon yok.
        </p>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => (
            <div
              key={row.id}
              className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-slate-700 bg-slate-800/40 p-4"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <FileText className="h-4 w-4 shrink-0 text-indigo-400" />
                  <span className="font-medium text-white">{row.title}</span>
                  {row.category && (
                    <span className="rounded bg-slate-700 px-1.5 py-0.5 text-xs text-slate-300">
                      {row.category}
                    </span>
                  )}
                  {!row.isActive && (
                    <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-xs text-amber-300">
                      Pasif
                    </span>
                  )}
                  {row.kopyaSayisi > 0 && (
                    <span
                      className="flex items-center gap-1 rounded bg-slate-700 px-1.5 py-0.5 text-xs text-slate-300"
                      title="Bu kalıbı kopyalayıp özelleştirmiş firma sayısı. Buradaki düzenleme onlara gitmez."
                    >
                      <Copy className="h-3 w-3" />
                      {row.kopyaSayisi} firma özelleştirmiş
                    </span>
                  )}
                </div>
                {row.description && <p className="mt-1 text-sm text-slate-400">{row.description}</p>}
                <p className="mt-1 truncate text-xs text-slate-500">
                  <code>{row.key}</code> · {govdeDuzMetin(row.body).slice(0, 110)}…
                </p>
              </div>
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setEditing(row)
                    setDialogOpen(true)
                  }}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="sm" onClick={() => sil(row)}>
                  <Trash2 className="h-4 w-4 text-red-400" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <SablonDialogu
        open={dialogOpen}
        sablon={editing}
        onClose={() => setDialogOpen(false)}
        onSaved={load}
      />
    </div>
  )
}

function SablonDialogu({
  open,
  sablon,
  onClose,
  onSaved,
}: {
  open: boolean
  sablon: SablonSatiri | null
  onClose: () => void
  onSaved: () => void
}) {
  const { toast } = useToast()
  const [form, setForm] = useState<SablonFormDegeri>(bosForm())
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setForm(
      sablon
        ? {
            title: sablon.title,
            category: sablon.category,
            description: sablon.description,
            body: sablon.body,
            sortOrder: sablon.sortOrder,
            isActive: sablon.isActive,
          }
        : bosForm(),
    )
  }, [open, sablon])

  const kaydet = async () => {
    if (!form.title.trim()) {
      toast({ title: "Şablon adı zorunlu", variant: "destructive" })
      return
    }
    if (!govdeDuzMetin(form.body)) {
      toast({ title: "Şablon metni boş olamaz", variant: "destructive" })
      return
    }
    setSaving(true)
    try {
      const res = await fetch(
        sablon ? `/api/system-admin/document-templates/${sablon.id}` : "/api/system-admin/document-templates",
        {
          method: sablon ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        },
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || "Kaydedilemedi")
      toast({ title: sablon ? "Şablon güncellendi" : `"${form.title.trim()}" eklendi` })
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

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{sablon ? "Şablonu düzenle" : "Yeni katalog şablonu"}</DialogTitle>
          <DialogDescription>
            {sablon && sablon.kopyaSayisi > 0
              ? `Bu kalıbı ${sablon.kopyaSayisi} firma kopyalamış. Buradaki değişiklik onların metnini DEĞİŞTİRMEZ; yalnız kalıbı henüz kopyalamamış firmaları etkiler.`
              : "Bu metin tüm firmalara hazır şablon olarak sunulur. Firma düzenlemek isterse kendi kopyasını alır."}
          </DialogDescription>
        </DialogHeader>

        <BelgeSablonEditoru deger={form} onChange={setForm} />

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Vazgeç
          </Button>
          <Button onClick={kaydet} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Kaydet
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
