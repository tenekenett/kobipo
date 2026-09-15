"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import {
  Copy,
  FileSignature,
  FileText,
  Loader2,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react"
import { WriteAction } from "@/components/dashboard/write-guard"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useToast } from "@/components/ui/use-toast"
import { useConfirm } from "@/components/ui/confirm-dialog-provider"
import { BelgeSablonEditoru, type SablonFormDegeri } from "@/components/personel/belge-sablon-editoru"
import { BelgeOlusturDialog } from "@/components/personel/belge-olustur-dialog"
import { govdeDuzMetin } from "@/lib/personel/belge-govde"

/**
 * Firmanın İK belge şablonları.
 *
 * Listede iki kaynak birlikte durur:
 *   • KOBİPO ŞABLONU — katalogdan gelir, doğrudan düzenlenemez. "Kopyala ve düzenle"
 *     firmanın kendi kopyasını üretir; o andan sonra metin firmanındır ve Kobipo'nun
 *     katalogda yaptığı değişiklik ona YANSIMAZ.
 *   • KENDİ ŞABLONUNUZ — firma yazmış ya da kopyalamış. Serbestçe düzenlenir, silinir.
 *
 * Kopya kataloğu GİZLER: bir kalıbı kopyaladıysanız listede iki kez görünmez. Kopyayı
 * silmek Kobipo şablonunu geri getirir — "özelleştirmemi geri al" budur.
 */

type SablonSatiri = {
  id: string
  key: string
  sourceKey: string | null
  title: string
  category: string | null
  description: string | null
  body: string
  sortOrder: number
  isActive: boolean
  kapsam: "KATALOG" | "FIRMA"
}

const bosForm = (): SablonFormDegeri => ({
  title: "",
  category: null,
  description: null,
  body: "",
  sortOrder: 0,
  isActive: true,
})

export default function BelgeSablonlariPage() {
  const searchParams = useSearchParams()
  const companyId = searchParams.get("company")
  const { toast } = useToast()
  const { confirm } = useConfirm()

  const [rows, setRows] = useState<SablonSatiri[]>([])
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState<SablonSatiri | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const [basilacak, setBasilacak] = useState<SablonSatiri | null>(null)

  const load = useCallback(async () => {
    if (!companyId) return
    setLoading(true)
    try {
      const res = await fetch(
        `/api/personel/belge-sablonlari?companyId=${companyId}&includeInactive=1`,
        { cache: "no-store" },
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast({
          title: "Şablonlar yüklenemedi",
          description: data?.error ?? `Sunucu ${res.status} döndürdü.`,
          variant: "destructive",
        })
        setRows([])
        return
      }
      setRows(Array.isArray(data?.data) ? data.data : [])
    } finally {
      setLoading(false)
    }
  }, [companyId, toast])

  useEffect(() => {
    load()
  }, [load])

  const gruplu = useMemo(() => {
    const harita = new Map<string, SablonSatiri[]>()
    for (const row of rows) {
      const anahtar = row.category ?? "Diğer"
      if (!harita.has(anahtar)) harita.set(anahtar, [])
      harita.get(anahtar)!.push(row)
    }
    return [...harita.entries()].sort((a, b) => a[0].localeCompare(b[0], "tr"))
  }, [rows])

  const kopyala = async (row: SablonSatiri) => {
    const res = await fetch("/api/personel/belge-sablonlari", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyId, kaynakId: row.id }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      toast({ title: "Kopyalanamadı", description: data?.error, variant: "destructive" })
      return
    }
    toast({
      title: "Kendi kopyanız oluşturuldu",
      description: "Bu metin artık size ait. Kobipo'nun hazır şablonundaki değişiklikler buraya yansımaz.",
    })
    await load()
    // Kopyayı hemen düzenlemeye aç: kullanıcı zaten değiştirmek için kopyaladı.
    if (data?.data) {
      setEditing({ ...data.data, kapsam: "FIRMA" })
      setEditorOpen(true)
    }
  }

  const sil = async (row: SablonSatiri) => {
    const katalogaDoner = Boolean(row.sourceKey)
    const onay = await confirm({
      title: `"${row.title}" silinsin mi?`,
      description: katalogaDoner
        ? "Bu, Kobipo şablonundan aldığınız bir kopya. Silerseniz özelleştirmeniz kaybolur ve Kobipo'nun hazır şablonu listede yeniden görünür."
        : "Şablon kalıcı olarak silinir. Daha önce bu şablonla bastığınız belgeler etkilenmez.",
      confirmLabel: "Sil",
      variant: "destructive",
    })
    if (!onay) return

    const res = await fetch(`/api/personel/belge-sablonlari/${row.id}?companyId=${companyId}`, {
      method: "DELETE",
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      toast({ title: "Silinemedi", description: data?.error, variant: "destructive" })
      return
    }
    toast({
      title: "Şablon silindi",
      description: data?.katalogGeriGeldi ? "Kobipo'nun hazır şablonu listeye geri döndü." : undefined,
    })
    load()
  }

  if (!companyId) {
    return <p className="text-muted-foreground">Firma seçili değil.</p>
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <FileSignature className="h-6 w-6 text-primary" />
            Belge Şablonları
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            İzin talebi, çalışma belgesi, fesih bildirimi… Hazır şablonları kullanın ya da
            kendi metninizi yazın. Belgeyi personel seçerek basarsanız ad, T.C. no ve tarih
            gibi alanlar kayıttan otomatik dolar.
          </p>
        </div>
        <WriteAction>
          <Button
            onClick={() => {
              setEditing(null)
              setEditorOpen(true)
            }}
          >
            <Plus className="mr-2 h-4 w-4" />
            Yeni şablon
          </Button>
        </WriteAction>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Yükleniyor…
        </div>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            Henüz şablon yok.
          </CardContent>
        </Card>
      ) : (
        gruplu.map(([kategori, satirlar]) => (
          <Card key={kategori}>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{kategori}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {satirlar.map((row) => (
                <div
                  key={row.id}
                  className="flex flex-wrap items-start justify-between gap-3 rounded-lg border p-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="font-medium">{row.title}</span>
                      {row.kapsam === "KATALOG" ? (
                        <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                          Kobipo şablonu
                        </span>
                      ) : (
                        <span className="rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary">
                          {row.sourceKey ? "Özelleştirdiniz" : "Kendi şablonunuz"}
                        </span>
                      )}
                      {!row.isActive && (
                        <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-xs text-amber-600 dark:text-amber-400">
                          Pasif
                        </span>
                      )}
                    </div>
                    {row.description && (
                      <p className="mt-1 text-sm text-muted-foreground">{row.description}</p>
                    )}
                    <p className="mt-1 line-clamp-1 text-xs text-muted-foreground/70">
                      {govdeDuzMetin(row.body).slice(0, 120)}…
                    </p>
                  </div>

                  <div className="flex shrink-0 flex-wrap gap-1">
                    <Button size="sm" variant="outline" onClick={() => setBasilacak(row)}>
                      Belge oluştur
                    </Button>
                    {row.kapsam === "KATALOG" ? (
                      <WriteAction>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => kopyala(row)}
                          title="Kendi kopyanızı oluşturup düzenleyin"
                        >
                          <Copy className="mr-1 h-4 w-4" />
                          Kopyala ve düzenle
                        </Button>
                      </WriteAction>
                    ) : (
                      <>
                        <WriteAction>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setEditing(row)
                              setEditorOpen(true)
                            }}
                            title="Düzenle"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                        </WriteAction>
                        <WriteAction>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => sil(row)}
                            title={row.sourceKey ? "Özelleştirmeyi geri al" : "Sil"}
                          >
                            {row.sourceKey ? (
                              <RotateCcw className="h-4 w-4 text-amber-600" />
                            ) : (
                              <Trash2 className="h-4 w-4 text-destructive" />
                            )}
                          </Button>
                        </WriteAction>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        ))
      )}

      <SablonEditorDialogu
        open={editorOpen}
        companyId={companyId}
        sablon={editing}
        onClose={() => setEditorOpen(false)}
        onSaved={load}
      />

      <BelgeOlusturDialog
        open={Boolean(basilacak)}
        companyId={companyId}
        sablon={basilacak}
        onClose={() => setBasilacak(null)}
      />
    </div>
  )
}

function SablonEditorDialogu({
  open,
  companyId,
  sablon,
  onClose,
  onSaved,
}: {
  open: boolean
  companyId: string
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
        sablon ? `/api/personel/belge-sablonlari/${sablon.id}` : "/api/personel/belge-sablonlari",
        {
          method: sablon ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...form, companyId }),
        },
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || "Kaydedilemedi")
      toast({ title: sablon ? "Şablon güncellendi" : "Şablon eklendi" })
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
          <DialogTitle>{sablon ? "Şablonu düzenle" : "Yeni şablon"}</DialogTitle>
          <DialogDescription>
            Metni istediğiniz gibi değiştirin. Doldurulacak yerleri süslü parantez içine yazın;
            sağdaki hazır alanlar firma ve personel kartından otomatik dolar.
          </DialogDescription>
        </DialogHeader>

        <BelgeSablonEditoru deger={form} onChange={setForm} sirayiGoster={false} />

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Vazgeç
          </Button>
          <WriteAction>
            <Button onClick={kaydet} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Kaydet
            </Button>
          </WriteAction>
        </div>
      </DialogContent>
    </Dialog>
  )
}
