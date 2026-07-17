"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from "@/components/ui/use-toast"
import { useDashboardCompany } from "@/components/dashboard/dashboard-company-provider"
import { downscaleImageToDataUrl } from "@/lib/labels/raster"
import { buildReceiptHtml, type ReceiptCompanyInfo, type ReceiptData } from "@/lib/fis/receipt-html"
import {
  DEFAULT_RECEIPT_TEMPLATE,
  type ReceiptTemplate,
  type ReceiptWidth,
} from "@/lib/fis/receipt-template"
import { ImagePlus, Loader2, RotateCcw, Save, Trash2 } from "lucide-react"

/** Önizleme fişi — gerçek satışa benzer örnek veri. */
const SAMPLE: Omit<ReceiptData, "direction"> = {
  invoiceNo: "FS-SAT-2026-0001",
  date: new Date().toISOString(),
  companyName: "",
  counterpartyName: "Örnek Müşteri",
  items: [
    { description: "Örnek Ürün A", quantity: 2, unit: "ADET", unitPrice: 150, vatRate: 20, total: 360 },
    { description: "Örnek Ürün B", quantity: 1, unit: "KG", unitPrice: 89.9, vatRate: 10, total: 98.89 },
  ],
  net: 389.9,
  vat: 68.99,
  total: 458.89,
  paymentLabel: "Nakit",
  tendered: 500,
  change: 41.11,
  isCredit: false,
  notes: "Örnek fiş notu",
}

export default function FisTasarimPage() {
  const searchParams = useSearchParams()
  const { selectedCompanyId, selectedCompany } = useDashboardCompany()
  const companyId = searchParams.get("company") || selectedCompanyId
  const { toast } = useToast()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [tpl, setTpl] = useState<ReceiptTemplate>(DEFAULT_RECEIPT_TEMPLATE)
  // Önizleme künyeyi gerçek firma verisiyle gösterir (Firma Bilgileri'nden gelir).
  const [companyInfo, setCompanyInfo] = useState<ReceiptCompanyInfo>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    if (!companyId) return
    setLoading(true)
    try {
      const res = await fetch(`/api/fis-tasarim?companyId=${encodeURIComponent(companyId)}`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || "Şablon yüklenemedi")
      setTpl(data.template)
      if (data.company) setCompanyInfo(data.company)
    } catch (e: any) {
      toast({ title: "Hata", description: e?.message || "Şablon yüklenemedi", variant: "destructive" })
    } finally {
      setLoading(false)
    }
  }, [companyId, toast])

  useEffect(() => {
    load()
  }, [load])

  const set = <K extends keyof ReceiptTemplate>(key: K, value: ReceiptTemplate[K]) =>
    setTpl((p) => ({ ...p, [key]: value }))

  const save = async () => {
    if (!companyId) return
    setSaving(true)
    try {
      const res = await fetch("/api/fis-tasarim", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, template: tpl }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || "Kaydedilemedi")
      // Sunucu şablonu doğrular/kırpar — kaydedilen hâli geri yaz.
      setTpl(data.template)
      toast({
        title: "Fiş tasarımı kaydedildi",
        description: "Hızlı satış/alış ve fiş detayı bundan sonra bu tasarımı basar.",
      })
    } catch (e: any) {
      toast({ title: "Hata", description: e?.message || "Kaydedilemedi", variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  const pickLogo = async (file: File) => {
    // Etiket tasarımcısıyla aynı yükleyici: küçültür ve PNG data URL'e çevirir.
    const dataUrl = await downscaleImageToDataUrl(file, 300)
    if (!dataUrl) {
      toast({
        title: "Görsel yüklenemedi",
        description: "En fazla 2MB boyutunda bir görsel seçin.",
        variant: "destructive",
      })
      return
    }
    set("logoDataUrl", dataUrl)
  }

  // Önizleme: gerçek fiş üreticisiyle aynı fonksiyon — ekranda gördüğün = basılan.
  const previewHtml = useMemo(
    () =>
      buildReceiptHtml(
        {
          ...SAMPLE,
          direction: "outgoing",
          companyName: selectedCompany?.name ?? "Firma Ünvanı",
          company: companyInfo,
        },
        false,
        tpl,
      ),
    [tpl, selectedCompany?.name, companyInfo],
  )

  if (!companyId) {
    return (
      <div className="p-8 text-center text-muted-foreground">Firma seçili değil. Üstten şube seçin.</div>
    )
  }

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Fiş Tasarımı</h1>
          <p className="text-sm text-muted-foreground">
            Hızlı satış/alışta basılan termal fişin görünümü. Fişin kalem listesi ve toplamları
            sabittir; buradan sabit parçaları ve görünürlük tercihlerini ayarlarsınız.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setTpl(DEFAULT_RECEIPT_TEMPLATE)}
            disabled={loading || saving}
          >
            <RotateCcw className="mr-2 h-4 w-4" />
            Varsayılana Dön
          </Button>
          <Button size="sm" onClick={save} disabled={loading || saving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Kaydet
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center p-12 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          Yükleniyor...
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_auto]">
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Üst Bölüm</CardTitle>
                <CardDescription>Fişin tepesinde görünen logo ve başlık.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label className="mb-1.5 block">Logo</Label>
                  <div className="flex items-center gap-3">
                    {tpl.logoDataUrl ? (
                      <>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={tpl.logoDataUrl}
                          alt="Fiş logosu"
                          className="h-12 w-auto max-w-[120px] rounded border bg-white object-contain p-1"
                        />
                        <Button variant="outline" size="sm" onClick={() => set("logoDataUrl", null)}>
                          <Trash2 className="mr-2 h-4 w-4" />
                          Kaldır
                        </Button>
                      </>
                    ) : (
                      <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                        <ImagePlus className="mr-2 h-4 w-4" />
                        Logo Yükle
                      </Button>
                    )}
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0]
                        if (f) void pickLogo(f)
                        e.target.value = ""
                      }}
                    />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    PNG/JPEG, en fazla 2MB. Otomatik küçültülür; fişte ortalanır.
                  </p>
                </div>

                <div>
                  <Label htmlFor="headerText" className="mb-1.5 block">
                    Üst Başlık
                  </Label>
                  <Input
                    id="headerText"
                    value={tpl.headerText}
                    maxLength={120}
                    placeholder={selectedCompany?.name ?? "Firma adı"}
                    onChange={(e) => set("headerText", e.target.value)}
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Boş bırakırsanız firma adı yazılır.
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Görünecek Bölümler</CardTitle>
                <CardDescription>Kapatılan bölümler fişe hiç basılmaz.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {(
                  [
                    ["showAddress", "İşletme adresi", "Firma Bilgileri'ndeki adres, başlığın altında."],
                    [
                      "showContact",
                      "Telefon / vergi dairesi - VKN",
                      "Firma Bilgileri'ndeki telefon ve vergi bilgileri.",
                    ],
                    ["showVat", "KDV dökümü (Ara Toplam + KDV)", "Kapalıyken yalnız TOPLAM görünür."],
                    ["showCounterparty", "Müşteri / Tedarikçi satırı", "Cari seçilmemişse Perakende yazar."],
                    ["showNotes", "Fiş notu", "Hızlı satış/alışta girilen not fişe basılır."],
                  ] as const
                ).map(([key, label, hint]) => (
                  <label key={key} className="flex cursor-pointer items-start gap-3">
                    <input
                      type="checkbox"
                      className="mt-0.5 rounded"
                      checked={tpl[key]}
                      onChange={(e) => set(key, e.target.checked)}
                    />
                    <span>
                      <span className="text-sm font-medium">{label}</span>
                      <span className="block text-xs text-muted-foreground">{hint}</span>
                    </span>
                  </label>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Alt Bölüm ve Kağıt</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label htmlFor="footerText" className="mb-1.5 block">
                    Alt Not
                  </Label>
                  <Input
                    id="footerText"
                    value={tpl.footerText}
                    maxLength={120}
                    placeholder="Bizi tercih ettiğiniz için teşekkürler"
                    onChange={(e) => set("footerText", e.target.value)}
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Boş bırakılırsa satış fişinde varsayılan teşekkür notu basılır, alış fişinde alt not
                    çıkmaz.
                  </p>
                </div>

                <div>
                  <Label className="mb-1.5 block">Kağıt Genişliği</Label>
                  <div className="flex gap-2">
                    {([80, 58] as ReceiptWidth[]).map((w) => (
                      <Button
                        key={w}
                        type="button"
                        variant={tpl.widthMm === w ? "default" : "outline"}
                        size="sm"
                        onClick={() => set("widthMm", w)}
                      >
                        {w}mm
                      </Button>
                    ))}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Termal yazıcınızın rulo genişliği.
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card className="lg:w-[380px]">
            <CardHeader>
              <CardTitle className="text-base">Önizleme</CardTitle>
              <CardDescription>Örnek satış fişi — basılan fişle aynı şablon.</CardDescription>
            </CardHeader>
            <CardContent>
              <iframe
                title="Fiş önizleme"
                srcDoc={previewHtml}
                className="h-[560px] w-full rounded-md border bg-white"
              />
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
