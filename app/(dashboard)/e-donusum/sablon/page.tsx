"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/components/ui/use-toast"
import { TemplateDesigner } from "@/components/e-donusum/template-designer"
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  FileUp,
  Info,
  LayoutTemplate,
  Loader2,
  RefreshCcw,
  Sparkles,
  Upload,
} from "lucide-react"

interface SampleTemplate {
  key: string
  label: string
  eDocumentType: number
  fileName: string
  available: boolean
}

interface TenantXslt {
  id: number
  eDocumentTypeEnumText: string | null
  xsltName: string | null
  isDefault: boolean
  isInternetSales: boolean
  isApproved: boolean | null
  approvedDate: string | null
}

interface Company {
  id: string
  eDonusumTenantVkn?: string | null
}

const DOC_TYPE_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 1, label: "E-Fatura" },
  { value: 2, label: "E-Arşiv" },
]

export default function FaturaSablonuPage() {
  const searchParams = useSearchParams()
  const companyId = searchParams.get("company")
  const { toast } = useToast()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [companyChecked, setCompanyChecked] = useState(false)
  const [tenantVkn, setTenantVkn] = useState<string | null>(null)

  const [docType, setDocType] = useState<number>(1)
  const [templates, setTemplates] = useState<TenantXslt[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [listError, setListError] = useState<string | null>(null)

  // Kobipo tasarımları (xsltName → önizlenebilir mi) ve aktif şablon seçimi.
  const [designMap, setDesignMap] = useState<Record<string, { hasOptions: boolean }>>({})
  const [activeXsltName, setActiveXsltName] = useState<string | null>(null)
  const [rowBusy, setRowBusy] = useState<{ name: string; action: "activate" | "preview" } | null>(null)

  const [samples, setSamples] = useState<SampleTemplate[]>([])
  const [sampleBusy, setSampleBusy] = useState<{ key: string; action: "preview" | "install" } | null>(null)

  const [xsltName, setXsltName] = useState("")
  const [fileName, setFileName] = useState("")
  const [fileContent, setFileContent] = useState("")
  const [isHasLogo, setIsHasLogo] = useState(false)
  const [isHasStamp, setIsHasStamp] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [isPreviewing, setIsPreviewing] = useState(false)

  const fetchCompany = useCallback(async () => {
    if (!companyId) return
    const res = await fetch(`/api/companies/${companyId}`)
    if (!res.ok) {
      setCompanyChecked(true)
      return
    }
    const data = (await res.json()) as Company
    const vkn = (data.eDonusumTenantVkn || "").replace(/\D/g, "")
    setTenantVkn(vkn.length === 10 || vkn.length === 11 ? vkn : null)
    setCompanyChecked(true)
  }, [companyId])

  const fetchTemplates = useCallback(async () => {
    if (!companyId) return
    setIsLoading(true)
    setListError(null)
    try {
      const res = await fetch(
        `/api/e-donusum/templates?companyId=${companyId}&eDocumentType=${docType}`,
        { cache: "no-store" },
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setListError(data?.error || "Şablon listesi alınamadı")
        setTemplates([])
        return
      }
      setTemplates(Array.isArray(data?.data) ? data.data : [])
    } catch (e) {
      setListError(e instanceof Error ? e.message : "Ağ hatası")
    } finally {
      setIsLoading(false)
    }
  }, [companyId, docType])

  const fetchSamples = useCallback(async () => {
    try {
      const res = await fetch("/api/e-donusum/templates/samples", { cache: "no-store" })
      const data = await res.json().catch(() => ({}))
      if (res.ok && Array.isArray(data?.data)) setSamples(data.data)
    } catch {
      /* sessiz geç — örnekler kritik değil */
    }
  }, [])

  // Kobipo tasarımlarını ve aktif şablon seçimini getir.
  const fetchDesigns = useCallback(async () => {
    if (!companyId) return
    try {
      const res = await fetch(
        `/api/e-donusum/templates/designs?companyId=${companyId}&eDocumentType=${docType}`,
        { cache: "no-store" },
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) return
      const map: Record<string, { hasOptions: boolean }> = {}
      for (const d of Array.isArray(data?.data) ? data.data : []) {
        if (typeof d?.xsltName === "string") map[d.xsltName] = { hasOptions: Boolean(d.hasOptions) }
      }
      setDesignMap(map)
      setActiveXsltName(typeof data?.activeXsltName === "string" ? data.activeXsltName : null)
    } catch {
      /* sessiz geç */
    }
  }, [companyId, docType])

  const refreshTemplatesAndDesigns = useCallback(() => {
    fetchTemplates()
    fetchDesigns()
  }, [fetchTemplates, fetchDesigns])

  const activateTemplate = async (name: string) => {
    if (!companyId) return
    setRowBusy({ name, action: "activate" })
    try {
      const res = await fetch("/api/e-donusum/templates/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, eDocumentType: docType, xsltName: name }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || "Şablon aktif yapılamadı")
      setActiveXsltName(name)
      toast({ title: "Aktif şablon güncellendi", description: `Faturalar artık “${name}” dizaynıyla gönderilecek.` })
    } catch (error) {
      toast({ title: "Hata", description: error instanceof Error ? error.message : "Hata", variant: "destructive" })
    } finally {
      setRowBusy(null)
    }
  }

  const deactivateActive = async () => {
    if (!companyId || !activeXsltName) return
    setRowBusy({ name: activeXsltName, action: "activate" })
    try {
      const res = await fetch("/api/e-donusum/templates/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, eDocumentType: docType, xsltName: "" }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || "İşlem başarısız")
      setActiveXsltName(null)
      toast({ title: "Aktif seçim kaldırıldı", description: "Faturalar Mysoft'un varsayılan dizaynıyla gönderilecek." })
    } catch (error) {
      toast({ title: "Hata", description: error instanceof Error ? error.message : "Hata", variant: "destructive" })
    } finally {
      setRowBusy(null)
    }
  }

  const previewDesign = async (name: string) => {
    if (!companyId) return
    // Sekmeyi tıklama jesti İÇİNDE (senkron) aç; aksi halde fetch'ten sonra
    // window.open popup engelleyiciye takılıp sessizce engellenir.
    const win = window.open("", "_blank")
    setRowBusy({ name, action: "preview" })
    try {
      const res = await fetch("/api/e-donusum/templates/designs/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, eDocumentType: docType, xsltName: name }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.error || "Önizleme alınamadı")
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      if (win && !win.closed) {
        win.location.href = url
      } else {
        // Sekme açılamadıysa (engellendi) aynı pencerede aç.
        window.open(url, "_blank")
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (error) {
      if (win && !win.closed) win.close()
      toast({ title: "Önizleme hatası", description: error instanceof Error ? error.message : "Hata", variant: "destructive" })
    } finally {
      setRowBusy(null)
    }
  }

  useEffect(() => {
    if (!companyId) return
    fetchCompany()
    fetchSamples()
  }, [companyId, fetchCompany, fetchSamples])

  useEffect(() => {
    if (!companyId || !tenantVkn) return
    fetchTemplates()
    fetchDesigns()
  }, [companyId, tenantVkn, fetchTemplates, fetchDesigns])

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    if (!xsltName) setXsltName(file.name.replace(/\.[^.]+$/, ""))
    const reader = new FileReader()
    reader.onload = () => setFileContent(typeof reader.result === "string" ? reader.result : "")
    reader.onerror = () =>
      toast({ title: "Dosya okunamadı", description: "XSLT dosyası okunamadı.", variant: "destructive" })
    reader.readAsText(file)
  }

  const upload = async () => {
    if (!companyId) return
    if (!fileContent.trim()) {
      toast({ title: "Dosya seçin", description: "Önce bir .xslt dosyası seçin.", variant: "destructive" })
      return
    }
    if (!xsltName.trim()) {
      toast({ title: "Şablon adı gerekli", description: "Bir şablon adı girin.", variant: "destructive" })
      return
    }
    setIsUploading(true)
    try {
      const res = await fetch("/api/e-donusum/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId,
          eDocumentType: docType,
          xsltName: xsltName.trim(),
          content: fileContent,
          fileName: fileName || undefined,
          isHasLogo,
          isHasStamp,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || "Şablon yüklenemedi")
      toast({ title: "Şablon yüklendi", description: data?.message || "Mysoft hesabınıza tanımlandı." })
      setXsltName("")
      setFileName("")
      setFileContent("")
      if (fileInputRef.current) fileInputRef.current.value = ""
      await fetchTemplates()
    } catch (error) {
      toast({
        title: "Hata",
        description: error instanceof Error ? error.message : "Hata",
        variant: "destructive",
      })
    } finally {
      setIsUploading(false)
    }
  }

  const preview = async () => {
    if (!companyId) return
    if (!fileContent.trim()) {
      toast({ title: "Dosya seçin", description: "Önizleme için önce bir .xslt dosyası seçin.", variant: "destructive" })
      return
    }
    setIsPreviewing(true)
    try {
      const res = await fetch("/api/e-donusum/templates/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId,
          eDocumentType: docType,
          content: fileContent,
          fileName: fileName || undefined,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.error || "Önizleme alınamadı")
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      window.open(url, "_blank")
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (error) {
      toast({
        title: "Önizleme hatası",
        description: error instanceof Error ? error.message : "Hata",
        variant: "destructive",
      })
    } finally {
      setIsPreviewing(false)
    }
  }

  const previewSample = async (key: string) => {
    if (!companyId) return
    setSampleBusy({ key, action: "preview" })
    try {
      const res = await fetch("/api/e-donusum/templates/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, sampleKey: key }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.error || "Önizleme alınamadı")
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      window.open(url, "_blank")
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (error) {
      toast({
        title: "Önizleme hatası",
        description: error instanceof Error ? error.message : "Hata",
        variant: "destructive",
      })
    } finally {
      setSampleBusy(null)
    }
  }

  const installSample = async (key: string) => {
    if (!companyId) return
    setSampleBusy({ key, action: "install" })
    try {
      const res = await fetch("/api/e-donusum/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, sampleKey: key }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || "Şablon tanımlanamadı")
      toast({ title: "Örnek şablon tanımlandı", description: data?.message || "Mysoft hesabınıza eklendi." })
      await fetchTemplates()
    } catch (error) {
      toast({
        title: "Hata",
        description: error instanceof Error ? error.message : "Hata",
        variant: "destructive",
      })
    } finally {
      setSampleBusy(null)
    }
  }

  if (!companyId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Belge Şablonları</CardTitle>
          <CardDescription>Firma seçiniz</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  if (companyChecked && !tenantVkn) {
    const settingsHref = `/ayarlar/e-donusum?company=${companyId}`
    return (
      <div className="space-y-5">
        <div>
          <h1 className="text-2xl font-bold text-kobipo-navy dark:text-foreground">Belge Şablonları</h1>
          <p className="text-sm text-muted-foreground">E-Fatura / e-Arşiv görünüm şablonlarını yönetin</p>
        </div>
        <Card className="border-amber-300 bg-amber-50/60 dark:border-amber-900/60 dark:bg-amber-950/30">
          <CardContent className="flex flex-col items-start gap-4 p-6 sm:flex-row sm:items-center">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200">
              <AlertTriangle className="h-6 w-6" />
            </span>
            <div className="flex-1 space-y-1">
              <p className="text-base font-semibold text-amber-900 dark:text-amber-100">
                Önce Mysoft Mükellef VKN'nizi doğrulayın
              </p>
              <p className="text-sm text-amber-900/80 dark:text-amber-200/80">
                Şablon yönetimi için Mysoft hesabınıza bağlı mükellefin VKN'sini E-Dönüşüm Ayarları'ndan
                girip "Doğrula"ya basmanız gerekiyor.
              </p>
            </div>
            <Button asChild>
              <a href={settingsHref}>E-Dönüşüm Ayarları</a>
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const docLabel = DOC_TYPE_OPTIONS.find((o) => o.value === docType)?.label || "Belge"
  const visibleSamples = samples.filter((s) => s.eDocumentType === docType)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight text-kobipo-navy dark:text-foreground">
            Belge Şablonları
          </h1>
          <p className="text-sm text-muted-foreground">
            E-Fatura / e-Arşiv görünümünü özelleştirin — hazır örnekleri kullanın ya da kendi XSLT'nizi yükleyin
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Belge tipi segment switch */}
          <div className="inline-flex rounded-xl border bg-muted/40 p-1">
            {DOC_TYPE_OPTIONS.map((opt) => {
              const active = docType === opt.value
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setDocType(opt.value)}
                  className={`rounded-lg px-4 py-1.5 text-sm font-medium transition ${
                    active
                      ? "bg-kobipo-blue text-white shadow-sm dark:bg-primary dark:text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {opt.label}
                </button>
              )
            })}
          </div>
          <Button variant="outline" size="icon" onClick={fetchTemplates} disabled={isLoading} title="Yenile">
            <RefreshCcw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {/* Bilgi: şablon zorunlu değil */}
      <div className="flex items-start gap-3 rounded-xl border border-blue-200/60 bg-blue-50/50 p-4 text-sm dark:border-blue-900/40 dark:bg-blue-950/20">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-300">
          <Info className="h-4 w-4" />
        </span>
        <div className="space-y-0.5 text-muted-foreground">
          <p>
            <span className="font-medium text-foreground">Şablon yüklemek zorunlu değildir.</span> Kendi dizaynınızı
            yüklemezseniz Mysoft'un genel/varsayılan dizaynı kullanılır ve faturalarınız sorunsuz gönderilir.
          </p>
          <p className="text-xs">Bu ekran yalnızca kurumsal görünüm (logo, renk, düzen) isteyenler içindir.</p>
        </div>
      </div>

      {/* Örnek şablon (seçili belge tipi) */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-kobipo-blue/10 text-kobipo-blue dark:bg-primary/15 dark:text-primary">
              <Sparkles className="h-4 w-4" />
            </span>
            <div>
              <CardTitle>{docLabel} — Örnek Şablon</CardTitle>
              <CardDescription>
                {docLabel} için hazır örnek görünüm. Önizleyip beğenirseniz tek tıkla Mysoft hesabınıza tanımlayın.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {visibleSamples.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              {docLabel} için örnek şablon bulunamadı.
            </p>
          ) : (
            visibleSamples.map((s) => {
              const busy = sampleBusy?.key === s.key
              return (
                <div
                  key={s.key}
                  className="flex flex-col gap-4 rounded-xl border bg-gradient-to-br from-kobipo-pale/50 to-transparent p-4 dark:from-primary/10 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex items-center gap-3">
                    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-kobipo-blue text-white shadow-sm dark:bg-primary dark:text-primary-foreground">
                      <LayoutTemplate className="h-6 w-6" />
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold leading-tight">{docLabel} — Örnek Şablon</p>
                        {s.available ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                            <CheckCircle2 className="h-3 w-3" />
                            Hazır
                          </span>
                        ) : (
                          <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                            Yakında
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">Mysoft uyumlu hazır görünüm</p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => previewSample(s.key)}
                      disabled={!s.available || !!sampleBusy}
                    >
                      {busy && sampleBusy?.action === "preview" ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Eye className="mr-2 h-4 w-4" />
                      )}
                      Önizle
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => installSample(s.key)}
                      disabled={!s.available || !!sampleBusy}
                    >
                      {busy && sampleBusy?.action === "install" ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <CheckCircle2 className="mr-2 h-4 w-4" />
                      )}
                      Tanımla
                    </Button>
                  </div>
                </div>
              )
            })
          )}
        </CardContent>
      </Card>

      {/* Mevcut şablonlar */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle>Tanımlı Şablonlar</CardTitle>
              <CardDescription>
                {DOC_TYPE_OPTIONS.find((o) => o.value === docType)?.label} için Mysoft hesabınızdaki dizaynlar
              </CardDescription>
            </div>
            {!isLoading && templates.length > 0 && (
              <Badge variant="secondary">{templates.length} kayıt</Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Çekiliyor…
            </div>
          ) : listError ? (
            <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p className="break-words">{listError}</p>
            </div>
          ) : templates.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-sm font-medium">Özel şablon tanımlı değil</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Mysoft genel dizaynı kullanılıyor. İsterseniz aşağıdan kendi XSLT'nizi yükleyin.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Gönderimde kullanılan dizayn özeti */}
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-sm">
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">Gönderimde kullanılan dizayn:</span>
                  {activeXsltName ? (
                    <span className="inline-flex items-center gap-1 font-semibold text-kobipo-navy dark:text-foreground">
                      <CheckCircle2 className="h-3.5 w-3.5 text-kobipo-blue dark:text-primary" />
                      {activeXsltName}
                    </span>
                  ) : (
                    <span className="font-medium text-muted-foreground">Mysoft varsayılanı</span>
                  )}
                </div>
                {activeXsltName && (
                  <button
                    type="button"
                    onClick={deactivateActive}
                    disabled={!!rowBusy}
                    className="text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:opacity-60"
                  >
                    Seçimi kaldır
                  </button>
                )}
              </div>

              {/* Şablon kartları */}
              <div className="grid gap-2">
                {templates.map((t) => {
                  const name = t.xsltName || ""
                  const isActive = !!name && activeXsltName === name
                  const canPreview = !!name && designMap[name]?.hasOptions
                  const isKobipo = !!name && !!designMap[name]
                  const activating = rowBusy?.name === name && rowBusy.action === "activate"
                  const previewing = rowBusy?.name === name && rowBusy.action === "preview"
                  return (
                    <div
                      key={t.id}
                      className={`flex flex-col gap-3 rounded-xl border p-3 transition sm:flex-row sm:items-center sm:justify-between ${
                        isActive
                          ? "border-kobipo-blue/40 bg-kobipo-blue/5 ring-1 ring-kobipo-blue/20 dark:border-primary/40 dark:bg-primary/10 dark:ring-primary/20"
                          : "border-border hover:bg-muted/30"
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span
                          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
                            isActive
                              ? "bg-kobipo-blue text-white dark:bg-primary dark:text-primary-foreground"
                              : "bg-muted text-muted-foreground"
                          }`}
                        >
                          <LayoutTemplate className="h-5 w-5" />
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">{name || "(isimsiz)"}</p>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            {t.isApproved ? (
                              <span className="inline-flex rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                                Onaylı
                              </span>
                            ) : (
                              <span className="inline-flex rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700 dark:bg-slate-700 dark:text-slate-300">
                                Onay bekliyor
                              </span>
                            )}
                            {t.isDefault && (
                              <span className="inline-flex rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                                Mysoft varsayılan
                              </span>
                            )}
                            {t.isInternetSales && (
                              <span className="inline-flex rounded-full bg-purple-100 px-1.5 py-0.5 text-[10px] font-semibold text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
                                İnternet Satış
                              </span>
                            )}
                            <span
                              className={`inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                                isKobipo
                                  ? "bg-kobipo-pale text-kobipo-blue dark:bg-primary/15 dark:text-primary"
                                  : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                              }`}
                            >
                              {isKobipo ? "Kobipo tasarımı" : "Kobipo dışı"}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="flex shrink-0 items-center gap-2 self-end sm:self-auto">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => previewDesign(name)}
                          disabled={!canPreview || !!rowBusy}
                          title={
                            canPreview
                              ? "PDF önizle"
                              : "Mysoft, portalden/dışarıdan eklenen şablonun kaynağını geri vermediği için önizlenemez. Yalnızca Kobipo tasarımcısıyla yapılanlar önizlenebilir."
                          }
                        >
                          {previewing ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Eye className="mr-1.5 h-3.5 w-3.5" />}
                          Önizle
                        </Button>
                        {isActive ? (
                          <span className="inline-flex items-center gap-1.5 rounded-md bg-kobipo-blue px-3 py-1.5 text-xs font-semibold text-white dark:bg-primary dark:text-primary-foreground">
                            <CheckCircle2 className="h-4 w-4" />
                            Aktif
                          </span>
                        ) : (
                          <Button
                            size="sm"
                            onClick={() => activateTemplate(name)}
                            disabled={!name || !!rowBusy}
                          >
                            {activating ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                            Aktif yap
                          </Button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
          {!isLoading && !listError && templates.length > 0 && (
            <p className="mt-3 flex items-start gap-1.5 text-xs text-muted-foreground">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                <b>Aktif yap</b> ile faturalarınızın hangi dizaynla gönderileceğini seçersiniz. <b>Önizle</b> yalnızca
                Kobipo tasarımcısıyla yapılan şablonlarda görünür (Mysoft, kayıtlı şablonun kaynağını geri vermediği için
                portalden/dışarıdan eklenenler önizlenemez).
              </span>
            </p>
          )}
        </CardContent>
      </Card>

      {/* Yükleme */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-kobipo-blue/10 text-kobipo-blue dark:bg-primary/15 dark:text-primary">
              <FileUp className="h-4 w-4" />
            </span>
            <div>
              <CardTitle>Kendi Şablonunu Yükle</CardTitle>
              <CardDescription>
                <span className="font-medium text-foreground">{docLabel}</span> için XSLT (.xslt) dosyanızı seçin.
                Yüklemeden önce PDF önizlemesiyle test edebilirsiniz.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Gizli native input + tıklanabilir alan */}
          <input
            id="xsltFile"
            ref={fileInputRef}
            type="file"
            accept=".xslt,.xsl,.xml,application/xml,text/xml"
            onChange={onFileChange}
            disabled={isUploading || isPreviewing}
            className="hidden"
          />
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>XSLT Dosyası</Label>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading || isPreviewing}
                className="flex w-full items-center gap-3 rounded-lg border border-dashed bg-muted/20 px-4 py-3 text-left transition hover:border-kobipo-blue hover:bg-muted/40 disabled:opacity-60 dark:hover:border-primary"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-background text-muted-foreground">
                  <FileUp className="h-4 w-4" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">
                    {fileName || "Dosya seçmek için tıklayın"}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {fileName ? "Değiştirmek için tekrar tıklayın" : ".xslt / .xsl / .xml"}
                  </span>
                </span>
              </button>
            </div>
            <div className="space-y-2">
              <Label htmlFor="xsltName">Şablon Adı</Label>
              <Input
                id="xsltName"
                value={xsltName}
                onChange={(e) => setXsltName(e.target.value)}
                placeholder="ör. Kurumsal Mavi"
                disabled={isUploading || isPreviewing}
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-6">
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={isHasLogo}
                onChange={(e) => setIsHasLogo(e.target.checked)}
                className="h-4 w-4 rounded border accent-kobipo-blue dark:accent-primary"
                disabled={isUploading || isPreviewing}
              />
              Firma logosu eklensin
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={isHasStamp}
                onChange={(e) => setIsHasStamp(e.target.checked)}
                className="h-4 w-4 rounded border accent-kobipo-blue dark:accent-primary"
                disabled={isUploading || isPreviewing}
              />
              Firma kaşesi eklensin
            </label>
          </div>

          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={preview} disabled={isPreviewing || isUploading || !fileContent}>
              {isPreviewing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Önizleniyor…
                </>
              ) : (
                <>
                  <Eye className="mr-2 h-4 w-4" />
                  PDF Önizle
                </>
              )}
            </Button>
            <Button onClick={upload} disabled={isUploading || isPreviewing || !fileContent}>
              {isUploading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Yükleniyor…
                </>
              ) : (
                <>
                  <Upload className="mr-2 h-4 w-4" />
                  Mysoft'a Yükle
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Kendi tasarımını oluştur (Şablon Tasarımcısı) — sayfanın en altında */}
      <TemplateDesigner
        companyId={companyId}
        docType={docType}
        docLabel={docLabel}
        onSaved={refreshTemplatesAndDesigns}
      />
    </div>
  )
}
