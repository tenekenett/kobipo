"use client"

// Yazarkasa (ÖKC) tanımları — şube bazlı. Plan: docs/okc/ASAMA1-KOBIPO.md A2.
//
// Aşama 1'de cihaza bağlantı yok: tanım Z raporunun ve fişin mali kimliğinin
// sahibidir. Z kaydı olan cihaz silinmez, pasife alınır (uç 409 döner).

import { WriteAction } from "@/components/dashboard/write-guard"
import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { TextCombobox } from "@/components/ui/text-combobox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useToast } from "@/components/ui/use-toast"
import { useConfirm } from "@/components/ui/confirm-dialog-provider"
import { CompanyLink } from "@/components/dashboard/company-link"
import { Pencil, Plus, Power, Store, Trash2 } from "lucide-react"
import { OKC_BRANDS, OKC_PROVIDER_LABELS, type OkcDeviceView, type OkcProvider } from "@/lib/okc/devices"

type FormState = { name: string; brand: string; model: string; serialNo: string; ekuNo: string }

const EMPTY_FORM: FormState = { name: "", brand: "", model: "", serialNo: "", ekuNo: "" }

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short" })
}

export default function YazarkasaPage() {
  const searchParams = useSearchParams()
  const companyId = searchParams.get("company")
  const { toast } = useToast()
  const { confirm } = useConfirm()

  const [devices, setDevices] = useState<OkcDeviceView[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [editing, setEditing] = useState<OkcDeviceView | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [isSaving, setIsSaving] = useState(false)

  const fetchDevices = async () => {
    if (!companyId) return
    setIsLoading(true)
    try {
      const res = await fetch(`/api/okc/devices?companyId=${encodeURIComponent(companyId)}`, { cache: "no-store" })
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || "Yazarkasalar alınamadı")
      setDevices(await res.json())
    } catch (e) {
      toast({ title: "Hata", description: e instanceof Error ? e.message : "Bilinmeyen hata", variant: "destructive" })
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchDevices()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId])

  const openCreate = () => {
    setEditing(null)
    setForm({ ...EMPTY_FORM, name: `Kasa ${devices.length + 1}` })
    setShowForm(true)
  }

  const openEdit = (device: OkcDeviceView) => {
    setEditing(device)
    setForm({
      name: device.name,
      brand: device.brand ?? "",
      model: device.model ?? "",
      serialNo: device.serialNo,
      ekuNo: device.ekuNo ?? "",
    })
    setShowForm(true)
  }

  const handleSave = async () => {
    if (!companyId) return
    setIsSaving(true)
    try {
      const res = await fetch(editing ? `/api/okc/devices/${editing.id}` : "/api/okc/devices", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, ...form }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || "Kaydedilemedi")
      toast({ title: "Kaydedildi", description: editing ? "Yazarkasa güncellendi" : "Yazarkasa eklendi" })
      setShowForm(false)
      fetchDevices()
    } catch (e) {
      toast({ title: "Hata", description: e instanceof Error ? e.message : "Bilinmeyen hata", variant: "destructive" })
    } finally {
      setIsSaving(false)
    }
  }

  const toggleActive = async (device: OkcDeviceView) => {
    if (!companyId) return
    if (
      device.isActive &&
      !(await confirm({
        title: `${device.name} pasife alınsın mı?`,
        description: "Pasif yazarkasaya yeni Z raporu girilemez. Geçmiş Z raporları ve fişler yerinde kalır.",
        confirmLabel: "Pasife al",
      }))
    ) {
      return
    }
    const res = await fetch(`/api/okc/devices/${device.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyId, isActive: !device.isActive }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      toast({ title: "Hata", description: data?.error || "Güncellenemedi", variant: "destructive" })
      return
    }
    fetchDevices()
  }

  const handleDelete = async (device: OkcDeviceView) => {
    if (!companyId) return
    if (
      !(await confirm({
        title: `${device.name} silinsin mi?`,
        description: "Yazarkasa tanımı kalıcı olarak silinir.",
        confirmLabel: "Sil",
        variant: "destructive",
      }))
    ) {
      return
    }
    const res = await fetch(`/api/okc/devices/${device.id}?companyId=${encodeURIComponent(companyId)}`, {
      method: "DELETE",
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      toast({ title: "Silinemedi", description: data?.error || "Bilinmeyen hata", variant: "destructive" })
      return
    }
    toast({ title: "Silindi", description: `${device.name} silindi` })
    fetchDevices()
  }

  if (!companyId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Yazarkasa</CardTitle>
          <CardDescription>Lütfen bir firma seçin</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-kobipo-navy dark:text-foreground">Yazarkasa</h1>
          <p className="text-sm text-muted-foreground">
            Bu şubede kullanılan yazarkasa POS cihazları. Z raporları ve fişlerin mali numaraları bu tanımlara bağlanır.
          </p>
        </div>
        <WriteAction>
          <Button onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" />
            Yazarkasa ekle
          </Button>
        </WriteAction>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Cihazlar</CardTitle>
          <CardDescription>
            Gün sonunda aldığınız Z raporunu{" "}
            <CompanyLink href="/satis/z-raporlari" className="font-medium text-primary underline-offset-4 hover:underline">
              Z Raporları
            </CompanyLink>{" "}
            ekranına girin; Kobipo kendi fişleriyle karşılaştırır.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Yükleniyor…</p>
          ) : devices.length === 0 ? (
            <div className="py-10 text-center">
              <p className="text-sm font-medium">Henüz yazarkasa tanımlanmamış</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Cihazın arkasındaki ya da Z fişindeki seri (mali sicil) numarasıyla ekleyin.
              </p>
              <WriteAction>
                <Button className="mt-4" onClick={openCreate}>
                  <Plus className="mr-2 h-4 w-4" />
                  Yazarkasa ekle
                </Button>
              </WriteAction>
            </div>
          ) : (
            <div className="divide-y rounded-lg border">
              {devices.map((device) => (
                <div
                  key={device.id}
                  className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-kobipo-blue/10 text-kobipo-blue dark:bg-primary/15 dark:text-primary">
                      <Store className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">{device.name}</p>
                        {!device.isActive && <Badge variant="secondary">Pasif</Badge>}
                        <Badge variant="outline">
                          {OKC_PROVIDER_LABELS[device.provider as OkcProvider] ?? device.provider}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {[device.brand, device.model].filter(Boolean).join(" ") || "Marka girilmemiş"} · Seri{" "}
                        <span className="font-mono">{device.serialNo}</span>
                        {device.ekuNo ? (
                          <>
                            {" "}
                            · EKÜ <span className="font-mono">{device.ekuNo}</span>
                          </>
                        ) : null}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {device.lastZ
                          ? `Son Z: ${device.lastZ.zNo} · ${formatDateTime(device.lastZ.takenAt)} · toplam ${device.zReportCount} Z raporu`
                          : "Henüz Z raporu girilmedi"}
                      </p>
                    </div>
                  </div>
                  <WriteAction>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <Button variant="outline" size="sm" onClick={() => openEdit(device)}>
                        <Pencil className="mr-1.5 h-3.5 w-3.5" />
                        Düzenle
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => toggleActive(device)}>
                        <Power className="mr-1.5 h-3.5 w-3.5" />
                        {device.isActive ? "Pasife al" : "Aktifleştir"}
                      </Button>
                      {device.zReportCount === 0 && (
                        <Button variant="outline" size="sm" onClick={() => handleDelete(device)}>
                          <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                          Sil
                        </Button>
                      )}
                    </div>
                  </WriteAction>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? `${editing.name} — düzenle` : "Yazarkasa ekle"}</DialogTitle>
            <DialogDescription>
              Seri ve EKÜ numarası Z fişinin üst kısmında yazar. EKÜ değiştiğinde buradan güncelleyin; geçmiş Z
              raporları kendi EKÜ numarasını korur.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid gap-2">
              <Label htmlFor="okc-name">Ad *</Label>
              <Input
                id="okc-name"
                placeholder="Kasa 1"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="okc-brand">Marka</Label>
                <TextCombobox
                  id="okc-brand"
                  value={form.brand}
                  onChange={(brand) => setForm({ ...form, brand })}
                  options={[...OKC_BRANDS]}
                  placeholder="Beko, Pavo…"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="okc-model">Model</Label>
                <Input
                  id="okc-model"
                  placeholder="X30TR"
                  value={form.model}
                  onChange={(e) => setForm({ ...form, model: e.target.value })}
                />
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="okc-serial">Seri (mali sicil) no *</Label>
                <Input
                  id="okc-serial"
                  className="font-mono"
                  value={form.serialNo}
                  onChange={(e) => setForm({ ...form, serialNo: e.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="okc-eku">EKÜ no</Label>
                <Input
                  id="okc-eku"
                  className="font-mono"
                  value={form.ekuNo}
                  onChange={(e) => setForm({ ...form, ekuNo: e.target.value })}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)} disabled={isSaving}>
              Vazgeç
            </Button>
            <WriteAction>
              <Button onClick={handleSave} disabled={isSaving}>
                {isSaving ? "Kaydediliyor…" : "Kaydet"}
              </Button>
            </WriteAction>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
