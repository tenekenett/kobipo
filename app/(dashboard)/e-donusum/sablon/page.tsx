"use client"

import { WriteAction } from "@/components/dashboard/write-guard"
import { useCallback, useEffect, useRef, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useToast } from "@/components/ui/use-toast"
import { useConfirm } from "@/components/ui/confirm-dialog-provider"
import { TemplateDesigner } from "@/components/e-donusum/template-designer"
import type { TemplateDesignOptions } from "@/lib/integrations/e-invoice/template-designer"
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  FileUp,
  Info,
  LayoutTemplate,
  Loader2,
  Palette,
  Pencil,
  RefreshCcw,
  Sparkles,
  Trash2,
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
  taxNumber?: string | null
  eDonusumTenantVkn?: string | null
  eFaturaPrefix?: string | null
  eArchivePrefix?: string | null
}

interface SeriesAssignment {
  eDocumentType: number
  prefix: string
  xsltName: string
}

interface Numerator {
  prefix: string
  edocumentType: string
  isDefault: boolean
  isPassive: boolean
}

// Mysoft edocumentType'ı numeric ("1","2") veya enum adı dönebiliyor.
const numeratorMatchesDocType = (n: Numerator, docType: number) => {
  const t = String(n.edocumentType || "").toUpperCase()
  if (docType === 1) return t === "1" || t === "EFATURA"
  if (docType === 2) return t === "2" || t === "10" || t === "EARSIVFATURA" || t === "GIBEARSIVFATURA"
  return false
}

const DOC_TYPE_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 1, label: "E-Fatura" },
  { value: 2, label: "E-Arşiv" },
]

type CreateTab = "design" | "sample" | "upload"

export default function FaturaSablonuPage() {
  const searchParams = useSearchParams()
  const companyId = searchParams.get("company")
  const { toast } = useToast()
  const { confirm } = useConfirm()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const designerRef = useRef<HTMLDivElement>(null)

  const [companyChecked, setCompanyChecked] = useState(false)
  const [tenantVkn, setTenantVkn] = useState<string | null>(null)
  // Firmanın aktif (kullanımdaki) prefix'leri ve seri no→şablon eşlemeleri —
  // "gönderimde kullanılan dizayn" özeti gerçekte hangi şablonun kesileceğini
  // (seri no'ya özel atama > firma geneli aktif şablon) göstersin diye.
  const [eFaturaPrefix, setEFaturaPrefix] = useState("")
  const [eArchivePrefix, setEArchivePrefix] = useState("")
  const [seriesAssignments, setSeriesAssignments] = useState<SeriesAssignment[]>([])
  const [numerators, setNumerators] = useState<Numerator[]>([])

  const [docType, setDocType] = useState<number>(1)
  const [templates, setTemplates] = useState<TenantXslt[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [listError, setListError] = useState<string | null>(null)

  // Kobipo tasarımları (xsltName → önizlenebilir mi) ve aktif şablon seçimi.
  const [designMap, setDesignMap] = useState<Record<string, { hasOptions: boolean }>>({})
  const [activeXsltName, setActiveXsltName] = useState<string | null>(null)
  // "Silinen" = gizlenen şablon adları (Mysoft'ta kalır ama listede gösterilmez).
  const [hiddenNames, setHiddenNames] = useState<string[]>([])
  const [rowBusy, setRowBusy] = useState<{ name: string; action: "activate" | "preview" | "edit" | "delete" | "restore" | "refresh" } | null>(null)

  // Düzenleme: tasarımcıyı kayıtlı tasarım seçenekleriyle açmak için hedef.
  const [editTarget, setEditTarget] = useState<{ xsltName: string; options: TemplateDesignOptions } | null>(null)
  const [editNonce, setEditNonce] = useState(0)

  const [samples, setSamples] = useState<SampleTemplate[]>([])
  const [sampleBusy, setSampleBusy] = useState<{ key: string; action: "preview" | "install" } | null>(null)

  const [xsltName, setXsltName] = useState("")
  const [fileName, setFileName] = useState("")
  const [fileContent, setFileContent] = useState("")
  const [isHasLogo, setIsHasLogo] = useState(false)
  const [isHasStamp, setIsHasStamp] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [isPreviewing, setIsPreviewing] = useState(false)

  // Oluşturma yöntemleri sekmesi (tasarla / hazır örnek / xslt yükle).
  const [createTab, setCreateTab] = useState<CreateTab>("design")

  const fetchCompany = useCallback(async () => {
    if (!companyId) return
    const res = await fetch(`/api/companies/${companyId}`)
    if (!res.ok) {
      setCompanyChecked(true)
      return
    }
    const data = (await res.json()) as Company
    // Mükellef VKN: eski kayıtlı değer varsa o, yoksa firmanın kendi VKN'si.
    const vkn = (data.eDonusumTenantVkn || data.taxNumber || "").replace(/\D/g, "")
    setTenantVkn(vkn.length === 10 || vkn.length === 11 ? vkn : null)
    setEFaturaPrefix((data.eFaturaPrefix || "").toUpperCase())
    setEArchivePrefix((data.eArchivePrefix || "").toUpperCase())
    setCompanyChecked(true)
  }, [companyId])

  const fetchSeriesAssignments = useCallback(async () => {
    if (!companyId) return
    try {
      const res = await fetch(`/api/e-donusum/series-templates?companyId=${companyId}`, { cache: "no-store" })
      const data = await res.json().catch(() => ({}))
      if (res.ok && Array.isArray(data?.data)) setSeriesAssignments(data.data)
    } catch {
      /* sessiz geç */
    }
  }, [companyId])

  const fetchNumerators = useCallback(async () => {
    if (!companyId) return
    try {
      const res = await fetch(`/api/e-donusum/numerators?companyId=${companyId}`, { cache: "no-store" })
      const data = await res.json().catch(() => ({}))
      if (res.ok && Array.isArray(data?.data)) setNumerators(data.data)
    } catch {
      /* sessiz geç — varsayılan prefix çözülemezse özet firma genelini gösterir */
    }
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
      setHiddenNames(Array.isArray(data?.hiddenXsltNames) ? data.hiddenXsltNames : [])
    } catch {
      /* sessiz geç */
    }
  }, [companyId, docType])

  const refreshTemplatesAndDesigns = useCallback(() => {
    fetchTemplates()
    fetchDesigns()
    fetchCompany()
    fetchSeriesAssignments()
    fetchNumerators()
  }, [fetchTemplates, fetchDesigns, fetchCompany, fetchSeriesAssignments, fetchNumerators])

  /**
   * Şablonu güncel taban tasarımdan YENİDEN ÜRETİP Mysoft'a aynı adla yükler.
   *
   * Kobipo tasarımları taban XSLT'nin üzerine tema uygulanarak üretilir; taban
   * iyileştirildiğinde (ör. kaleme açıklama satırı eklendiğinde) Mysoft'taki
   * kayıtlı kopya eski kalır. Aynı ad kullanıldığı için aktif seçim ve seri
   * eşlemeleri bozulmaz, görsel aynı kalır — tek fark tabana eklenenlerdir.
   */
  const refreshDesign = async (name: string) => {
    if (!companyId) return
    setRowBusy({ name, action: "refresh" })
    try {
      const res = await fetch("/api/e-donusum/templates/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, eDocumentType: docType, xsltName: name }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || "Şablon yenilenemedi")
      toast({
        title: "Şablon güncellendi",
        description: `“${name}” güncel tasarımla yüklendi. Görsel aynı; bu adım normalde ilk gönderimde kendiliğinden yapılır.`,
      })
      fetchDesigns()
    } catch (error) {
      toast({
        title: "Hata",
        description: error instanceof Error ? error.message : "Hata",
        variant: "destructive",
      })
    } finally {
      setRowBusy(null)
    }
  }

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

  // Kobipo tasarımını düzenle: kayıtlı seçenekleri çek, tasarımcıyı doldur ve oraya kaydır.
  const editDesign = async (name: string) => {
    if (!companyId) return
    setRowBusy({ name, action: "edit" })
    try {
      const res = await fetch(
        `/api/e-donusum/templates/designs?companyId=${companyId}&eDocumentType=${docType}&xsltName=${encodeURIComponent(name)}`,
        { cache: "no-store" },
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || "Tasarım yüklenemedi")
      setEditTarget({ xsltName: name, options: data.options as TemplateDesignOptions })
      setEditNonce((n) => n + 1)
      setCreateTab("design")
      // Tasarımcı görünür hale gelince oraya kaydır.
      setTimeout(() => designerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 60)
    } catch (error) {
      toast({ title: "Düzenleme açılamadı", description: error instanceof Error ? error.message : "Hata", variant: "destructive" })
    } finally {
      setRowBusy(null)
    }
  }

  // "Silme" = listeden gizleme (Mysoft XSLT silmeyi desteklemiyor; şablon hesapta kalır).
  const hideTemplate = async (name: string) => {
    if (!companyId) return
    const ok = await confirm({
      title: "Şablonu listeden kaldır",
      description: `“${name}” şablonu listeden kaldırılacak ve varsa aktif/seri atamasından çıkarılacak. (Mysoft hesabınızda fiziksel olarak kalır; aşağıdaki “Gizlenen şablonlar”dan geri getirebilirsiniz.)`,
      confirmLabel: "Listeden kaldır",
      variant: "destructive",
    })
    if (!ok) return
    setRowBusy({ name, action: "delete" })
    try {
      const res = await fetch("/api/e-donusum/templates/hidden", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, eDocumentType: docType, xsltName: name, hidden: true }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || "Şablon gizlenemedi")
      toast({ title: "Şablon listeden kaldırıldı", description: `“${name}” artık listede görünmüyor.` })
      if (activeXsltName === name) setActiveXsltName(null)
      if (editTarget?.xsltName === name) setEditTarget(null)
      refreshTemplatesAndDesigns()
    } catch (error) {
      toast({ title: "Hata", description: error instanceof Error ? error.message : "Hata", variant: "destructive" })
    } finally {
      setRowBusy(null)
    }
  }

  const restoreTemplate = async (name: string) => {
    if (!companyId) return
    setRowBusy({ name, action: "restore" })
    try {
      const res = await fetch("/api/e-donusum/templates/hidden", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, eDocumentType: docType, xsltName: name, hidden: false }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || "Şablon geri getirilemedi")
      toast({ title: "Şablon geri getirildi", description: `“${name}” yeniden listede.` })
      refreshTemplatesAndDesigns()
    } catch (error) {
      toast({ title: "Hata", description: error instanceof Error ? error.message : "Hata", variant: "destructive" })
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
    fetchSeriesAssignments()
    fetchNumerators()
  }, [companyId, tenantVkn, fetchTemplates, fetchDesigns, fetchSeriesAssignments, fetchNumerators])

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
    const settingsHref = `/ayarlar/firma?company=${companyId}`
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
                Önce firma VKN'nizi girin
              </p>
              <p className="text-sm text-amber-900/80 dark:text-amber-200/80">
                Şablon yönetimi firmanızın VKN'si üzerinden çalışır. Firma Ayarları'ndan VKN'nizi girin —
                ayrı bir doğrulama adımı gerekmez.
              </p>
            </div>
            <Button asChild>
              <a href={settingsHref}>Firma Ayarları</a>
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const docLabel = DOC_TYPE_OPTIONS.find((o) => o.value === docType)?.label || "Belge"
  const visibleSamples = samples.filter((s) => s.eDocumentType === docType)
  // Gizlenen ("silinen") şablonları listeden çıkar.
  const hiddenSet = new Set(hiddenNames)
  const visibleTemplates = templates.filter((t) => !hiddenSet.has(t.xsltName || ""))

  // Bu belge tipinde kullanımdaki prefix:
  //  1) firmanın açıkça seçtiği prefix (eFaturaPrefix/eArchivePrefix), yoksa
  //  2) "Mysoft otomatik" modunda Mysoft'un kullanacağı varsayılan numaratör prefix'i.
  const explicitPrefix = docType === 1 ? eFaturaPrefix : eArchivePrefix
  const typeNumerators = numerators.filter((n) => numeratorMatchesDocType(n, docType) && !n.isPassive)
  const defaultPrefix = (typeNumerators.find((n) => n.isDefault) || typeNumerators[0])?.prefix || ""
  const inUsePrefix = explicitPrefix || defaultPrefix
  const prefixDesign = inUsePrefix
    ? seriesAssignments.find((a) => a.eDocumentType === docType && a.prefix === inUsePrefix)?.xsltName || null
    : null
  // Gönderimde fiilen kullanılacak dizayn: seri no'ya özel atama > firma geneli aktif.
  const effectiveDesign = prefixDesign || activeXsltName

  return (
    <div className="space-y-5">
      {/* Başlık */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight text-kobipo-navy dark:text-foreground">
            Belge Şablonları
          </h1>
          <p className="text-sm text-muted-foreground">
            Faturalarınızın görünümünü seçin. Şablon zorunlu değildir — seçmezseniz Mysoft'un varsayılan dizaynı kullanılır.
          </p>
        </div>
        <Button variant="outline" size="icon" onClick={refreshTemplatesAndDesigns} disabled={isLoading} title="Yenile">
          <RefreshCcw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {/* Belge tipi seçici — büyük, etiketli ve belirgin (E-Fatura ↔ E-Arşiv) */}
      <div className="rounded-2xl border bg-card p-3 shadow-sm">
        <p className="mb-2 flex items-center gap-1.5 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <LayoutTemplate className="h-3.5 w-3.5" />
          Hangi belge tipinin şablonlarını yönetiyorsunuz?
        </p>
        <div className="grid grid-cols-2 gap-2">
          {DOC_TYPE_OPTIONS.map((opt) => {
            const active = docType === opt.value
            const hint = opt.value === 1 ? "Mükelleflere kesilen e-fatura" : "Nihai tüketici / e-arşiv"
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  setDocType(opt.value)
                  setEditTarget(null)
                }}
                aria-pressed={active}
                className={`flex flex-col items-start gap-0.5 rounded-xl border-2 px-4 py-3 text-left transition ${
                  active
                    ? "border-kobipo-blue bg-kobipo-blue/5 dark:border-primary dark:bg-primary/10"
                    : "border-transparent bg-muted/40 hover:border-border hover:bg-muted"
                }`}
              >
                <span className="flex items-center gap-2">
                  <span
                    className={`flex h-5 w-5 items-center justify-center rounded-full border-2 transition ${
                      active
                        ? "border-kobipo-blue bg-kobipo-blue text-white dark:border-primary dark:bg-primary"
                        : "border-muted-foreground/40"
                    }`}
                  >
                    {active && <CheckCircle2 className="h-3.5 w-3.5" />}
                  </span>
                  <span className={`text-sm font-semibold ${active ? "text-kobipo-navy dark:text-foreground" : "text-foreground"}`}>
                    {opt.label}
                  </span>
                </span>
                <span className="pl-7 text-xs text-muted-foreground">{hint}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Gönderimde kullanılan dizayn — her zaman görünür özet (seri no'ya özel atama dahil) */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-muted/30 px-4 py-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground">
            {docLabel}
            {inUsePrefix ? ` · ${inUsePrefix} serisi` : ""} gönderiminde kullanılan dizayn:
          </span>
          {effectiveDesign ? (
            <span className="inline-flex items-center gap-1.5 font-semibold text-kobipo-navy dark:text-foreground">
              <CheckCircle2 className="h-3.5 w-3.5 text-kobipo-blue dark:text-primary" />
              {effectiveDesign}
              {prefixDesign ? (
                <span className="rounded-full bg-kobipo-pale px-1.5 py-0.5 text-[10px] font-medium text-kobipo-blue dark:bg-primary/15 dark:text-primary">
                  seri no'ya özel
                </span>
              ) : (
                <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                  firma geneli
                </span>
              )}
            </span>
          ) : (
            <span className="font-medium text-muted-foreground">Mysoft varsayılanı (otomatik)</span>
          )}
        </div>
        {activeXsltName && !prefixDesign && (
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

      {/* Tanımlı şablonlar — birincil yönetim görünümü */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle>Şablonlarım</CardTitle>
              <CardDescription>
                {docLabel} için tanımlı dizaynlar — <b>Aktif yap</b> ile gönderimde kullanılacak olanı seçin.
              </CardDescription>
            </div>
            {!isLoading && visibleTemplates.length > 0 && (
              <span className="shrink-0 rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold text-muted-foreground">
                {visibleTemplates.length} şablon
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Çekiliyor…
            </div>
          ) : listError ? (
            <div className="mx-4 mb-4 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p className="break-words">{listError}</p>
            </div>
          ) : visibleTemplates.length === 0 ? (
            <div className="px-4 pb-8 pt-2 text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                <LayoutTemplate className="h-6 w-6 text-muted-foreground/60" />
              </div>
              <p className="text-sm font-medium">Henüz özel şablon yok</p>
              <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
                Mysoft'un varsayılan dizaynı kullanılıyor. Aşağıdan kendi tasarımınızı oluşturabilir, hazır örnek
                kullanabilir veya XSLT yükleyebilirsiniz.
              </p>
            </div>
          ) : (
            <div className="max-h-[560px] overflow-y-auto px-4 pb-4">
              <div className="grid gap-2">
                {visibleTemplates.map((t) => {
                  const name = t.xsltName || ""
                  const isActive = !!name && activeXsltName === name
                  const canPreview = !!name && designMap[name]?.hasOptions
                  const canEdit = !!name && designMap[name]?.hasOptions
                  const isKobipo = !!name && !!designMap[name]
                  const canRefresh = !!name && designMap[name]?.hasOptions
                  const refreshing = rowBusy?.name === name && rowBusy.action === "refresh"
                  const activating = rowBusy?.name === name && rowBusy.action === "activate"
                  const previewing = rowBusy?.name === name && rowBusy.action === "preview"
                  const editing = rowBusy?.name === name && rowBusy.action === "edit"
                  const deleting = rowBusy?.name === name && rowBusy.action === "delete"
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
                        {canRefresh && (
                          <WriteAction><Button
                            variant="outline"
                            size="sm"
                            onClick={() => refreshDesign(name)}
                            disabled={!!rowBusy}
                            title="Şablonu güncel tasarımla yeniden yükle — görsel aynı kalır. (Normalde ilk gönderimde kendiliğinden yapılır.)"
                          >
                            {refreshing ? (
                              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <RefreshCcw className="mr-1.5 h-3.5 w-3.5" />
                            )}
                            Yenile
                          </Button></WriteAction>
                        )}
                        {canPreview && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => previewDesign(name)}
                            disabled={!!rowBusy}
                            title="PDF önizle"
                          >
                            {previewing ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Eye className="mr-1.5 h-3.5 w-3.5" />}
                            Önizle
                          </Button>
                        )}
                        {canEdit && (
                          <WriteAction><Button
                            variant="outline"
                            size="sm"
                            onClick={() => editDesign(name)}
                            disabled={!!rowBusy}
                            title="Tasarımı düzenle"
                          >
                            {editing ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Pencil className="mr-1.5 h-3.5 w-3.5" />}
                            Düzenle
                          </Button></WriteAction>
                        )}
                        {isActive ? (
                          <span className="inline-flex items-center gap-1.5 rounded-md bg-kobipo-blue px-3 py-1.5 text-xs font-semibold text-white dark:bg-primary dark:text-primary-foreground">
                            <CheckCircle2 className="h-4 w-4" />
                            Aktif
                          </span>
                        ) : (
                          <Button size="sm" onClick={() => activateTemplate(name)} disabled={!name || !!rowBusy}>
                            {activating ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                            Aktif yap
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => hideTemplate(name)}
                          disabled={!name || !!rowBusy}
                          title="Şablonu listeden kaldır"
                          className="text-red-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30"
                        >
                          {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Gizlenen ("silinen") şablonlar — Mysoft'ta kalır; buradan geri getirilebilir */}
      {hiddenNames.length > 0 && (
        <Card className="border-dashed">
          <CardHeader className="pb-3">
            <CardTitle className="text-base text-muted-foreground">
              Gizlenen şablonlar ({hiddenNames.length})
            </CardTitle>
            <CardDescription>
              Bu {docLabel} şablonları listeden kaldırıldı. Mysoft hesabınızda duruyorlar — istediğinizde geri getirebilirsiniz.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {hiddenNames.map((name) => {
              const restoring = rowBusy?.name === name && rowBusy.action === "restore"
              return (
                <div
                  key={name}
                  className="flex items-center justify-between gap-3 rounded-lg border bg-muted/20 p-2.5"
                >
                  <span className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
                    <LayoutTemplate className="h-4 w-4 shrink-0" />
                    <span className="truncate line-through">{name}</span>
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => restoreTemplate(name)}
                    disabled={!!rowBusy}
                    className="shrink-0"
                  >
                    {restoring ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCcw className="mr-1.5 h-3.5 w-3.5" />}
                    Geri getir
                  </Button>
                </div>
              )
            })}
          </CardContent>
        </Card>
      )}

      {/* Yeni şablon oluşturma yöntemleri — sekmeli (tasarla / hazır örnek / yükle) */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Yeni şablon ekle</CardTitle>
          <CardDescription>Kendi tasarımınızı oluşturun, hazır bir örnekle başlayın ya da XSLT yükleyin.</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs value={createTab} onValueChange={(v) => setCreateTab(v as CreateTab)}>
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="design" className="gap-1.5">
                <Palette className="h-4 w-4" /> Tasarla
              </TabsTrigger>
              <TabsTrigger value="sample" className="gap-1.5">
                <Sparkles className="h-4 w-4" /> Hazır Örnek
              </TabsTrigger>
              <TabsTrigger value="upload" className="gap-1.5">
                <FileUp className="h-4 w-4" /> XSLT Yükle
              </TabsTrigger>
            </TabsList>

            {/* Tasarla */}
            <TabsContent value="design" className="pt-4">
              <div ref={designerRef}>
                <TemplateDesigner
                  companyId={companyId}
                  docType={docType}
                  docLabel={docLabel}
                  activePrefix={inUsePrefix}
                  onSaved={refreshTemplatesAndDesigns}
                  editName={editTarget?.xsltName ?? null}
                  editOptions={editTarget?.options ?? null}
                  editNonce={editNonce}
                  onEditDone={() => setEditTarget(null)}
                />
              </div>
            </TabsContent>

            {/* Hazır örnek */}
            <TabsContent value="sample" className="space-y-3 pt-4">
              {visibleSamples.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
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
                        <Button variant="outline" size="sm" onClick={() => previewSample(s.key)} disabled={!s.available || !!sampleBusy}>
                          {busy && sampleBusy?.action === "preview" ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <Eye className="mr-2 h-4 w-4" />
                          )}
                          Önizle
                        </Button>
                        <Button size="sm" onClick={() => installSample(s.key)} disabled={!s.available || !!sampleBusy}>
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
            </TabsContent>

            {/* XSLT yükle */}
            <TabsContent value="upload" className="space-y-4 pt-4">
              <input
                id="xsltFile"
                ref={fileInputRef}
                type="file"
                accept=".xslt,.xsl,.xml,application/xml,text/xml"
                onChange={onFileChange}
                disabled={isUploading || isPreviewing}
                className="hidden"
              />
              <p className="text-xs text-muted-foreground">
                Elinizde hazır bir XSLT varsa yükleyin. Yoksa <b>Tasarla</b> sekmesi çoğu kullanıcı için daha kolaydır.
              </p>
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
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <div className="space-y-1.5 px-1 text-xs">
        <p className="flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50 p-2.5 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            <b>Önizleme Mysoft örnek firma verisiyle</b> render edilir (Mysoft API'si önizlemede kendi firma
            datanızı parametre olarak almıyor). Canlı belge kesildiğinde kendi firma bilgileriniz (unvan, VKN,
            adres, vb.) görünecek — bu sayfadaki PDF yalnız <b>tasarımı/yerleşimi</b> kontrol etmek içindir.
          </span>
        </p>
        <p className="flex items-start gap-1.5 text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            <b>Önizle</b> yalnızca Kobipo tasarımcısıyla yapılan şablonlarda görünür (Mysoft, portalden/dışarıdan eklenen
            şablonun kaynağını geri vermediği için onlar önizlenemez). Bir seri no'ya özel şablon atamak için{" "}
            <b>Seri No Tanımları</b> sayfasını kullanın.
          </span>
        </p>
      </div>
    </div>
  )
}
