"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useToast } from "@/components/ui/use-toast"
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  FileText,
  Info,
  Loader2,
  Plus,
  RefreshCcw,
} from "lucide-react"

interface MysoftNumerator {
  prefix: string
  edocumentType: string
  edocumentTypeDescription: string
  isDefault: boolean
  isInternetSales: boolean
  isPassive: boolean
}

interface Company {
  id: string
  taxNumber?: string | null
  eFaturaPrefix?: string | null
  eArchivePrefix?: string | null
  eFaturaBackdatePrefix?: string | null
  eArchiveBackdatePrefix?: string | null
  eDonusumTenantVkn?: string | null
}

const DOC_TYPE_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 1, label: "E-Fatura" },
  { value: 2, label: "E-Arşiv" },
  { value: 5, label: "E-SMM" },
  { value: 6, label: "E-MM" },
]

// Mysoft API'si edocumentType'ı sürüme göre numeric kod ("1","2") veya
// enum adı ("EFATURA","EARSIVFATURA","GIBEARSIVFATURA") dönebiliyor.
const isEFaturaType = (n: MysoftNumerator) => {
  const t = String(n.edocumentType || "").toUpperCase()
  return t === "1" || t === "EFATURA"
}
const isEArsivType = (n: MysoftNumerator) => {
  const t = String(n.edocumentType || "").toUpperCase()
  return t === "2" || t === "10" || t === "EARSIVFATURA" || t === "GIBEARSIVFATURA"
}

// Numaratörün Kobipo belge tipi karşılığı (şablon eşlemesi yalnız E-Fatura/E-Arşiv için).
const numeratorDocType = (n: MysoftNumerator): 1 | 2 | null =>
  isEFaturaType(n) ? 1 : isEArsivType(n) ? 2 : null

const docTypeLabel = (docType: 1 | 2) => (docType === 1 ? "E-Fatura" : "E-Arşiv")

interface DesignRow {
  xsltName: string
  eDocumentType: number
}

const NO_TEMPLATE = "__none__"

const sanitizePrefix = (raw: string) =>
  raw
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase()
    .slice(0, 3)

function previewInvoiceNo(prefix: string) {
  const year = new Date().getFullYear()
  return `${prefix || "—"}${year}000001`
}

export default function SeriNoTanimlariPage() {
  const searchParams = useSearchParams()
  const companyId = searchParams.get("company")
  const { toast } = useToast()

  const [isLoading, setIsLoading] = useState(false)
  const [isAdding, setIsAdding] = useState(false)
  const [numerators, setNumerators] = useState<MysoftNumerator[]>([])
  const [mysoftError, setMysoftError] = useState<string | null>(null)
  // Kayıtlı tasarımlar (şablon eşlemesi için) ve prefix→şablon eşlemeleri.
  const [designs, setDesigns] = useState<DesignRow[]>([])
  // Anahtar: `${docType}|${prefix}` → atanmış xsltName
  const [assignments, setAssignments] = useState<Record<string, string>>({})
  const [savingAssignKey, setSavingAssignKey] = useState<string | null>(null)
  const [tenantVkn, setTenantVkn] = useState<string | null>(null)
  const [companyChecked, setCompanyChecked] = useState(false)

  // Firmanın gönderimde kullanacağı aktif prefix'ler (anında kaydedilir).
  const [eFaturaPrefix, setEFaturaPrefix] = useState("")
  const [eArchivePrefix, setEArchivePrefix] = useState("")
  const [savingActiveType, setSavingActiveType] = useState<1 | 2 | null>(null)
  // Geçmiş tarihli belgeler için ayrılmış yedek seriler (normal gönderimde kullanılmaz).
  const [eFaturaBackdatePrefix, setEFaturaBackdatePrefix] = useState("")
  const [eArchiveBackdatePrefix, setEArchiveBackdatePrefix] = useState("")
  const [savingBackdateType, setSavingBackdateType] = useState<1 | 2 | null>(null)
  const [backdateForm, setBackdateForm] = useState<{
    docType: 1 | 2
    mode: "EXISTING" | "NEW"
    prefix: string
  } | null>(null)
  // Tablo varsayılan olarak yalnız E-Fatura/E-Arşiv (aktif) numaratörleri gösterir.
  const [showAll, setShowAll] = useState(false)

  const [addOpen, setAddOpen] = useState(false)
  const [addForm, setAddForm] = useState({
    prefix: "",
    eDocumentType: 1,
    isDefault: true,
  })

  const fetchCompany = useCallback(async () => {
    if (!companyId) return
    const res = await fetch(`/api/companies/${companyId}`)
    if (!res.ok) {
      setCompanyChecked(true)
      return
    }
    const data = (await res.json()) as Company
    setEFaturaPrefix((data.eFaturaPrefix || "").toUpperCase())
    setEArchivePrefix((data.eArchivePrefix || "").toUpperCase())
    setEFaturaBackdatePrefix((data.eFaturaBackdatePrefix || "").toUpperCase())
    setEArchiveBackdatePrefix((data.eArchiveBackdatePrefix || "").toUpperCase())
    // Mükellef VKN: eski kayıtlı değer varsa o, yoksa firmanın kendi VKN'si.
    const vkn = (data.eDonusumTenantVkn || data.taxNumber || "").replace(/\D/g, "")
    setTenantVkn(vkn.length === 10 || vkn.length === 11 ? vkn : null)
    setCompanyChecked(true)
  }, [companyId])

  const fetchNumerators = useCallback(async () => {
    if (!companyId) return
    setIsLoading(true)
    setMysoftError(null)
    try {
      const res = await fetch(`/api/e-donusum/numerators?companyId=${companyId}`, {
        cache: "no-store",
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setMysoftError(data?.error || "Mysoft'tan liste alınamadı")
        setNumerators([])
        return
      }
      setNumerators(Array.isArray(data?.data) ? data.data : [])
    } catch (e) {
      setMysoftError(e instanceof Error ? e.message : "Ağ hatası")
    } finally {
      setIsLoading(false)
    }
  }, [companyId])

  // Kayıtlı tasarımları (tüm belge tipleri) ve mevcut prefix→şablon eşlemelerini çek.
  const fetchDesignsAndAssignments = useCallback(async () => {
    if (!companyId) return
    try {
      const [designsRes, assignRes] = await Promise.all([
        fetch(`/api/e-donusum/templates/designs?companyId=${companyId}`, { cache: "no-store" }),
        fetch(`/api/e-donusum/series-templates?companyId=${companyId}`, { cache: "no-store" }),
      ])
      if (designsRes.ok) {
        const d = await designsRes.json().catch(() => ({}))
        setDesigns(Array.isArray(d?.data) ? d.data : [])
      }
      if (assignRes.ok) {
        const a = await assignRes.json().catch(() => ({}))
        const map: Record<string, string> = {}
        for (const row of Array.isArray(a?.data) ? a.data : []) {
          map[`${row.eDocumentType}|${row.prefix}`] = row.xsltName
        }
        setAssignments(map)
      }
    } catch {
      // eşleme/tasarım çekilemediyse sessiz geç — sayfa yine kullanılabilir
    }
  }, [companyId])

  useEffect(() => {
    if (!companyId) return
    fetchCompany()
    fetchDesignsAndAssignments()
  }, [companyId, fetchCompany, fetchDesignsAndAssignments])

  // VKN doğrulandıktan SONRA numaratör listesini çek — VKN yoksa istek zaten 412 döner.
  useEffect(() => {
    if (!companyId || !tenantVkn) return
    fetchNumerators()
  }, [companyId, tenantVkn, fetchNumerators])

  const efaturaPrefixes = useMemo(
    () => numerators.filter((n) => isEFaturaType(n) && !n.isPassive),
    [numerators]
  )
  const earsivPrefixes = useMemo(
    () => numerators.filter((n) => isEArsivType(n) && !n.isPassive),
    [numerators]
  )
  const efaturaDefaultPrefix = useMemo(
    () => (efaturaPrefixes.find((n) => n.isDefault) || efaturaPrefixes[0])?.prefix || "",
    [efaturaPrefixes]
  )
  const earsivDefaultPrefix = useMemo(
    () => (earsivPrefixes.find((n) => n.isDefault) || earsivPrefixes[0])?.prefix || "",
    [earsivPrefixes]
  )

  // Tablo satırları: varsayılanda yalnız E-Fatura/E-Arşiv (pasif olmayan); "Tümü"
  // açıkken diğer tipler/pasifler de eklenir. E-Fatura→E-Arşiv→diğer, sonra prefix sırası.
  const tableRows = useMemo(() => {
    const rows = showAll ? numerators : numerators.filter((n) => numeratorDocType(n) && !n.isPassive)
    const rank = (n: MysoftNumerator) => numeratorDocType(n) ?? 9
    return [...rows].sort((a, b) => rank(a) - rank(b) || a.prefix.localeCompare(b.prefix, "tr"))
  }, [numerators, showAll])

  const hiddenCount = useMemo(
    () => numerators.filter((n) => !(numeratorDocType(n) && !n.isPassive)).length,
    [numerators]
  )

  const assignTemplate = async (docType: 1 | 2, prefix: string, xsltName: string) => {
    if (!companyId) return
    const key = `${docType}|${prefix}`
    const value = xsltName === NO_TEMPLATE ? "" : xsltName
    const prev = assignments[key]
    setAssignments((m) => {
      const next = { ...m }
      if (value) next[key] = value
      else delete next[key]
      return next
    })
    setSavingAssignKey(key)
    try {
      const res = await fetch("/api/e-donusum/series-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, eDocumentType: docType, prefix, xsltName: value }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.error || "Şablon atanamadı")
      }
      toast({
        title: value ? "Şablon atandı" : "Şablon kaldırıldı",
        description: value
          ? `"${prefix}" seri no'suna "${value}" şablonu tanımlandı.`
          : `"${prefix}" artık firma genel aktif şablonunu kullanacak.`,
      })
    } catch (error) {
      setAssignments((m) => {
        const next = { ...m }
        if (prev) next[key] = prev
        else delete next[key]
        return next
      })
      toast({
        title: "Hata",
        description: error instanceof Error ? error.message : "Hata",
        variant: "destructive",
      })
    } finally {
      setSavingAssignKey(null)
    }
  }

  // Bir prefix'i firmanın o belge tipi için "kullanılacak" seri no'su yapar (anında kaydeder).
  // Boş prefix = Mysoft varsayılanına (otomatik) dön.
  const setActivePrefix = async (docType: 1 | 2, prefix: string) => {
    if (!companyId) return
    const field = docType === 1 ? "eFaturaPrefix" : "eArchivePrefix"
    const prevEf = eFaturaPrefix
    const prevEa = eArchivePrefix
    if (docType === 1) setEFaturaPrefix(prefix)
    else setEArchivePrefix(prefix)
    setSavingActiveType(docType)
    try {
      const res = await fetch(`/api/companies/${companyId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: prefix || null }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.error || "Kaydedilemedi")
      }
      toast({
        title: prefix ? "Kullanılacak seri güncellendi" : "Otomatiğe alındı",
        description: prefix
          ? `${docTypeLabel(docType)}: ${prefix}`
          : `${docTypeLabel(docType)}: Mysoft varsayılanı (otomatik)`,
      })
    } catch (error) {
      setEFaturaPrefix(prevEf)
      setEArchivePrefix(prevEa)
      toast({
        title: "Hata",
        description: error instanceof Error ? error.message : "Hata",
        variant: "destructive",
      })
    } finally {
      setSavingActiveType(null)
    }
  }

  // Bir belge tipinde fiilen kullanılan seri: kullanıcı seçtiyse o, yoksa Mysoft varsayılanı.
  const effectiveActivePrefix = (docType: 1 | 2) =>
    docType === 1 ? eFaturaPrefix || efaturaDefaultPrefix : eArchivePrefix || earsivDefaultPrefix

  const backdatePrefixOf = (docType: 1 | 2) =>
    docType === 1 ? eFaturaBackdatePrefix : eArchiveBackdatePrefix

  // Geçmiş tarih serisi olarak seçilebilecek mevcut seriler: aynı belge tipi, pasif
  // değil ve fiilen kullanılan seri değil (aynı seri yedek olamaz).
  const backdateCandidates = (docType: 1 | 2) =>
    (docType === 1 ? efaturaPrefixes : earsivPrefixes).filter(
      (n) => n.prefix !== effectiveActivePrefix(docType)
    )

  // Geçmiş tarih serisini kaydeder/kaldırır. Aktif seriye DOKUNMAZ; bu seri yalnız
  // Mysoft geçmiş tarihli belgeyi reddettiğinde yedek olarak devreye girer.
  const saveBackdatePrefix = async (docType: 1 | 2, prefix: string) => {
    if (!companyId) return false
    const field = docType === 1 ? "eFaturaBackdatePrefix" : "eArchiveBackdatePrefix"
    const prevEf = eFaturaBackdatePrefix
    const prevEa = eArchiveBackdatePrefix
    if (docType === 1) setEFaturaBackdatePrefix(prefix)
    else setEArchiveBackdatePrefix(prefix)
    setSavingBackdateType(docType)
    try {
      const res = await fetch(`/api/companies/${companyId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: prefix || null }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.error || "Kaydedilemedi")
      }
      toast({
        title: prefix ? "Geçmiş tarih serisi tanımlandı" : "Geçmiş tarih serisi kaldırıldı",
        description: prefix
          ? `${docTypeLabel(docType)}: geçmiş tarihli faturalar artık ${prefix} serisinden numaralanacak.`
          : `${docTypeLabel(docType)}: geçmiş tarihli faturalar yeniden ana seriden denenecek.`,
      })
      return true
    } catch (error) {
      setEFaturaBackdatePrefix(prevEf)
      setEArchiveBackdatePrefix(prevEa)
      toast({
        title: "Hata",
        description: error instanceof Error ? error.message : "Hata",
        variant: "destructive",
      })
      return false
    } finally {
      setSavingBackdateType(null)
    }
  }

  const submitBackdateForm = async () => {
    if (!backdateForm || !companyId) return
    const { docType, mode } = backdateForm
    const clean = sanitizePrefix(backdateForm.prefix)
    if (clean.length !== 3) {
      toast({
        title: "Seri seçilmedi",
        description: "3 karakterlik bir seri (prefix) girin veya listeden seçin.",
        variant: "destructive",
      })
      return
    }
    if (clean === effectiveActivePrefix(docType)) {
      toast({
        title: "Aynı seri kullanılamaz",
        description: "Geçmiş tarih serisi, günlük faturaların gittiği seriden farklı olmalı.",
        variant: "destructive",
      })
      return
    }

    if (mode === "EXISTING") {
      const ok = await saveBackdatePrefix(docType, clean)
      if (ok) setBackdateForm(null)
      return
    }

    // Yeni seri: Mysoft'a ekle (varsayılan YAPILMAZ) ve geçmiş tarih serisi olarak kaydet.
    setSavingBackdateType(docType)
    try {
      const res = await fetch("/api/e-donusum/numerators", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId,
          prefix: clean,
          eDocumentType: docType,
          usage: "BACKDATE",
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || "Mysoft'a kaydedilemedi")
      if (docType === 1) setEFaturaBackdatePrefix(clean)
      else setEArchiveBackdatePrefix(clean)
      toast({
        title: "Geçmiş tarih serisi oluşturuldu",
        description: `${docTypeLabel(docType)}: "${clean}" Mysoft'a eklendi ve yedek seri olarak atandı.`,
      })
      setBackdateForm(null)
      await fetchNumerators()
    } catch (error) {
      toast({
        title: "Hata",
        description: error instanceof Error ? error.message : "Hata",
        variant: "destructive",
      })
    } finally {
      setSavingBackdateType(null)
    }
  }

  const addNumerator = async () => {
    if (!companyId) return
    const clean = sanitizePrefix(addForm.prefix)
    if (clean.length !== 3) {
      toast({
        title: "Geçersiz prefix",
        description: "Prefix tam olarak 3 karakter olmalı",
        variant: "destructive",
      })
      return
    }
    setIsAdding(true)
    try {
      const res = await fetch("/api/e-donusum/numerators", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId,
          prefix: clean,
          eDocumentType: addForm.eDocumentType,
          isDefault: addForm.isDefault,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || "Mysoft'a kaydedilemedi")
      toast({
        title: "Numaratör eklendi",
        description: `"${clean}" prefix'i Mysoft hesabınıza tanımlandı.`,
      })
      setAddOpen(false)
      setAddForm({ prefix: "", eDocumentType: 1, isDefault: true })
      await Promise.all([fetchNumerators(), fetchCompany()])
    } catch (error) {
      toast({
        title: "Hata",
        description: error instanceof Error ? error.message : "Hata",
        variant: "destructive",
      })
    } finally {
      setIsAdding(false)
    }
  }

  if (!companyId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Seri No Tanımları</CardTitle>
          <CardDescription>Firma seçiniz</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  // Firmanın VKN'si yoksa → Firma Ayarları'na yönlendir (artık ayrı doğrulama yok)
  if (companyChecked && !tenantVkn) {
    const settingsHref = `/ayarlar/firma?company=${companyId}`
    return (
      <div className="space-y-5">
        <div>
          <h1 className="text-2xl font-bold text-kobipo-navy dark:text-foreground">Seri No Tanımları</h1>
          <p className="text-sm text-muted-foreground">Mysoft hesabınızdaki numaratörleri yönetin</p>
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
                Numaratör (prefix) yönetimi firmanızın VKN'si üzerinden çalışır. Firma Ayarları'ndan VKN'nizi girin —
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

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-kobipo-navy dark:text-foreground">Seri No Tanımları</h1>
          <p className="text-sm text-muted-foreground">
            Hangi seri no'nun kullanılacağını seçin ve her seriye belge şablonu atayın
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={fetchNumerators} disabled={isLoading}>
            <RefreshCcw className={`mr-2 h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
            Yenile
          </Button>
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Yeni Numaratör
          </Button>
        </div>
      </div>

      {mysoftError && (
        <Card className="border-amber-300 bg-amber-50/60 dark:border-amber-900/60 dark:bg-amber-950/30">
          <CardContent className="flex items-start gap-3 p-4 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-300" />
            <div>
              <p className="font-semibold text-amber-900 dark:text-amber-200">Numaratör listesi alınamadı</p>
              <p className="break-words text-amber-900/80 dark:text-amber-200/80">{mysoftError}</p>
              <p className="mt-2 text-xs text-amber-900/70 dark:text-amber-200/70">
                Yeni numaratör eklemeyi yine deneyebilirsiniz — listeleme yetkisi olmasa bile ekleme çalışabilir.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Aktif seri no özeti (kullanımdaki) */}
      <div className="grid gap-3 sm:grid-cols-2">
        <ActiveSeriesSummary
          docType={1}
          label="E-Fatura"
          activePrefix={eFaturaPrefix}
          defaultPrefix={efaturaDefaultPrefix}
          saving={savingActiveType === 1}
          onClear={() => setActivePrefix(1, "")}
        />
        <ActiveSeriesSummary
          docType={2}
          label="E-Arşiv"
          activePrefix={eArchivePrefix}
          defaultPrefix={earsivDefaultPrefix}
          saving={savingActiveType === 2}
          onClear={() => setActivePrefix(2, "")}
        />
      </div>

      {/* Geçmiş tarihli belgeler için yedek seri */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarClock className="h-5 w-5 text-amber-600 dark:text-amber-400" />
            Geçmiş Tarihli Belgeler
          </CardTitle>
          <CardDescription>
            Bir seride belge numaraları tarih sırasını bozamaz: seride daha yeni tarihli bir fatura
            varsa, geçmiş tarihli fatura o seriden numara alamaz ve GİB&apos;e gönderilemez. Buraya ayrı
            bir seri tanımlarsanız geçmiş tarihli faturalar otomatik olarak bu seriden numaralanır —
            bugünkü faturalar yine ana seriden gider.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          {([1, 2] as const).map((docType) => {
            const prefix = backdatePrefixOf(docType)
            return (
              <div key={docType} className="rounded-xl border bg-muted/20 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold">{docTypeLabel(docType)}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {prefix ? (
                        <>
                          Geçmiş tarihli faturalar{" "}
                          <span className="font-mono font-bold tracking-widest text-foreground">
                            {prefix}
                          </span>{" "}
                          serisinden numaralanır.
                        </>
                      ) : (
                        "Tanımlı değil — geçmiş tarihli faturalar ana seriden denenir."
                      )}
                    </p>
                  </div>
                  {savingBackdateType === docType && (
                    <Loader2 className="mt-1 h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
                  )}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={savingBackdateType === docType}
                    onClick={() =>
                      setBackdateForm({
                        docType,
                        mode: backdateCandidates(docType).length > 0 ? "EXISTING" : "NEW",
                        prefix: "",
                      })
                    }
                  >
                    {prefix ? "Değiştir" : "Seri tanımla"}
                  </Button>
                  {prefix && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={savingBackdateType === docType}
                      onClick={() => saveBackdatePrefix(docType, "")}
                    >
                      Kaldır
                    </Button>
                  )}
                </div>
              </div>
            )
          })}
        </CardContent>
      </Card>

      {/* Seri no'lar & şablonlar tablosu */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>Seri No'lar &amp; Şablonlar</CardTitle>
              <CardDescription>
                "Kullan" ile aktif seri no'yu seçin, sağdan her seriye belge şablonu atayın.
              </CardDescription>
            </div>
            {hiddenCount > 0 && (
              <Button variant="ghost" size="sm" onClick={() => setShowAll((s) => !s)}>
                {showAll ? "Sadece E-Fatura/E-Arşiv" : `Tümünü göster (+${hiddenCount})`}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0 sm:p-0">
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Çekiliyor…
            </div>
          ) : tableRows.length === 0 ? (
            <div className="py-10 text-center">
              <p className="text-sm font-medium">
                {numerators.length === 0 ? "Henüz tanımlı numaratör yok" : "Gösterilecek seri no yok"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                "Yeni Numaratör" butonuyla bir prefix ekleyin.
              </p>
            </div>
          ) : (
            // ~10 satır görünür; kalanı tablo içinde kayar (yapışkan başlık).
            <div className="max-h-[600px] overflow-auto">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-background shadow-[inset_0_-1px_0_hsl(var(--border))]">
                  <TableRow>
                    <TableHead className="w-[120px]">Seri No</TableHead>
                    <TableHead>Belge Tipi</TableHead>
                    <TableHead className="w-[150px]">Kullanılacak</TableHead>
                    <TableHead className="w-[260px]">Şablon</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tableRows.map((n) => {
                    const docType = numeratorDocType(n)
                    const assignKey = docType ? `${docType}|${n.prefix}` : ""
                    const docDesigns = docType ? designs.filter((d) => d.eDocumentType === docType) : []
                    const assignedXslt = assignKey ? assignments[assignKey] : undefined
                    const activePrefix = docType === 1 ? eFaturaPrefix : docType === 2 ? eArchivePrefix : ""
                    const isActive = !!docType && activePrefix === n.prefix
                    return (
                      <TableRow key={`${n.edocumentType}-${n.prefix}`} className={isActive ? "bg-kobipo-blue/5 dark:bg-primary/5" : undefined}>
                        <TableCell>
                          <span className="inline-flex h-7 items-center rounded-md bg-muted px-2 font-mono text-sm font-bold tracking-widest">
                            {n.prefix}
                          </span>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-sm">
                              {n.edocumentTypeDescription || (docType ? docTypeLabel(docType) : n.edocumentType)}
                            </span>
                            {n.isDefault && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                                <CheckCircle2 className="h-2.5 w-2.5" />
                                Mysoft varsayılan
                              </span>
                            )}
                            {docType && backdatePrefixOf(docType) === n.prefix && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                                <CalendarClock className="h-2.5 w-2.5" />
                                Geçmiş tarih
                              </span>
                            )}
                            {n.isInternetSales && (
                              <span className="inline-flex rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                                İnternet
                              </span>
                            )}
                            {n.isPassive && (
                              <span className="inline-flex rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700 dark:bg-slate-700 dark:text-slate-300">
                                Pasif
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          {docType ? (
                            isActive ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-kobipo-blue px-2.5 py-0.5 text-[11px] font-semibold text-white dark:bg-primary dark:text-primary-foreground">
                                <CheckCircle2 className="h-3 w-3" />
                                Kullanılıyor
                              </span>
                            ) : (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setActivePrefix(docType, n.prefix)}
                                disabled={savingActiveType === docType || n.isPassive}
                              >
                                {savingActiveType === docType ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  "Kullan"
                                )}
                              </Button>
                            )
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {docType ? (
                            <div className="flex items-center gap-2">
                              <Select
                                value={assignedXslt || NO_TEMPLATE}
                                onValueChange={(v) => assignTemplate(docType, n.prefix, v)}
                                disabled={savingAssignKey === assignKey}
                              >
                                <SelectTrigger className="h-9 w-[220px]">
                                  <SelectValue placeholder="Şablon seçin" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value={NO_TEMPLATE}>Firma geneli (aktif şablon)</SelectItem>
                                  {docDesigns.map((d) => (
                                    <SelectItem key={d.xsltName} value={d.xsltName}>
                                      {d.xsltName}
                                    </SelectItem>
                                  ))}
                                  {assignedXslt && !docDesigns.some((d) => d.xsltName === assignedXslt) && (
                                    <SelectItem value={assignedXslt}>{assignedXslt} (kayıtlı)</SelectItem>
                                  )}
                                </SelectContent>
                              </Select>
                              {savingAssignKey === assignKey && (
                                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                              )}
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-dashed">
        <CardContent className="flex items-start gap-3 p-4 text-sm text-muted-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="space-y-1">
            <p>
              <span className="font-medium text-foreground">Belge no formatı:</span>{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">PREFIX + YIL + 9 haneli sıra</code>{" "}
              (ör. <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">MYF2026000001</code>). Sıra Mysoft
              tarafında otomatik artar.
            </p>
            <p className="flex items-start gap-1.5">
              <FileText className="mt-0.5 h-3 w-3 shrink-0" />
              <span>
                Bir seri no'ya şablon atarsanız, o seri ile kesilen faturalarda bu şablon{" "}
                <span className="font-medium text-foreground">Belge Şablonları'ndaki varsayılan şablonun önüne geçer</span>.
                Atama yapmazsanız firma geneli aktif şablon kullanılır.
              </span>
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Geçmiş tarih serisi dialog'u */}
      <Dialog
        open={backdateForm !== null}
        onOpenChange={(o) => !savingBackdateType && !o && setBackdateForm(null)}
      >
        <DialogContent>
          {backdateForm && (() => {
            const { docType, mode } = backdateForm
            const candidates = backdateCandidates(docType)
            const busy = savingBackdateType === docType
            return (
              <>
                <DialogHeader>
                  <DialogTitle>
                    Geçmiş tarih serisi — {docTypeLabel(docType)}
                  </DialogTitle>
                  <DialogDescription>
                    Bugünkü faturalar ana seriden gitmeye devam eder; yalnızca geçmiş tarihli
                    faturalar bu seriden numaralanır.
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-2">
                  {candidates.length > 0 && (
                    <div className="grid gap-2">
                      <Label>Nasıl tanımlansın?</Label>
                      <Select
                        value={mode}
                        onValueChange={(v) =>
                          setBackdateForm((f) =>
                            f ? { ...f, mode: v as "EXISTING" | "NEW", prefix: "" } : f
                          )
                        }
                        disabled={busy}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="EXISTING">Mevcut serilerden seç</SelectItem>
                          <SelectItem value="NEW">Mysoft&apos;ta yeni seri oluştur</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {mode === "EXISTING" && candidates.length > 0 ? (
                    <div className="grid gap-2">
                      <Label>Seri</Label>
                      <Select
                        value={backdateForm.prefix}
                        onValueChange={(v) => setBackdateForm((f) => (f ? { ...f, prefix: v } : f))}
                        disabled={busy}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Seri seçin" />
                        </SelectTrigger>
                        <SelectContent>
                          {candidates.map((n) => (
                            <SelectItem key={n.prefix} value={n.prefix}>
                              {n.prefix}
                              {n.isDefault ? " · Mysoft varsayılan" : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        Hiç kullanılmamış (ya da eski tarihte kalmış) bir seri seçin — bu seride de
                        faturanızdan yeni tarihli belge varsa gönderim yine reddedilir.
                      </p>
                    </div>
                  ) : (
                    <div className="grid gap-2">
                      <Label>Prefix (3 karakter)</Label>
                      <Input
                        value={backdateForm.prefix}
                        onChange={(e) =>
                          setBackdateForm((f) =>
                            f ? { ...f, prefix: sanitizePrefix(e.target.value) } : f
                          )
                        }
                        placeholder="GEC"
                        maxLength={3}
                        className="font-mono text-base font-semibold uppercase tracking-widest"
                        disabled={busy}
                      />
                      <p className="text-xs text-muted-foreground">
                        Örnek belge no:{" "}
                        <span className="font-mono">
                          {previewInvoiceNo(sanitizePrefix(backdateForm.prefix))}
                        </span>
                        . Mysoft'a eklenir ama varsayılan yapılmaz.
                      </p>
                    </div>
                  )}
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setBackdateForm(null)} disabled={busy}>
                    Vazgeç
                  </Button>
                  <Button onClick={submitBackdateForm} disabled={busy}>
                    {busy ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Kaydediliyor…
                      </>
                    ) : (
                      "Kaydet"
                    )}
                  </Button>
                </DialogFooter>
              </>
            )
          })()}
        </DialogContent>
      </Dialog>

      {/* Add numerator dialog */}
      <Dialog open={addOpen} onOpenChange={(o) => !isAdding && setAddOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Yeni Numaratör</DialogTitle>
            <DialogDescription>
              Bu prefix Mysoft hesabınıza tanımlanır. Hemen ardından fatura kesebilirsiniz.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label>Prefix (3 karakter)</Label>
              <Input
                value={addForm.prefix}
                onChange={(e) => setAddForm((f) => ({ ...f, prefix: sanitizePrefix(e.target.value) }))}
                placeholder="MYF"
                maxLength={3}
                className="font-mono text-base font-semibold uppercase tracking-widest"
                disabled={isAdding}
              />
            </div>
            <div className="grid gap-2">
              <Label>Belge Tipi</Label>
              <Select
                value={String(addForm.eDocumentType)}
                onValueChange={(v) => setAddForm((f) => ({ ...f, eDocumentType: Number(v) }))}
                disabled={isAdding}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DOC_TYPE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={String(opt.value)}>
                      {opt.value} · {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={addForm.isDefault}
                onChange={(e) => setAddForm((f) => ({ ...f, isDefault: e.target.checked }))}
                className="h-4 w-4 rounded border"
                disabled={isAdding}
              />
              Bu belge tipi için varsayılan yap
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)} disabled={isAdding}>
              Vazgeç
            </Button>
            <Button onClick={addNumerator} disabled={isAdding}>
              {isAdding ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Ekleniyor…
                </>
              ) : (
                <>
                  <Plus className="mr-2 h-4 w-4" />
                  Mysoft'a ekle
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/** Bir belge tipi için kullanımdaki (aktif) seri no özet kutusu. */
function ActiveSeriesSummary({
  docType,
  label,
  activePrefix,
  defaultPrefix,
  saving,
  onClear,
}: {
  docType: 1 | 2
  label: string
  activePrefix: string
  defaultPrefix: string
  saving: boolean
  onClear: () => void
}) {
  const isAuto = !activePrefix
  const effective = activePrefix || defaultPrefix
  return (
    <div className="rounded-xl border bg-muted/20 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
              docType === 1
                ? "bg-kobipo-blue/10 text-kobipo-blue dark:bg-primary/15 dark:text-primary"
                : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
            }`}
          >
            <FileText className="h-4 w-4" />
          </span>
          <div>
            <p className="text-sm font-semibold">{label}</p>
            <p className="text-xs text-muted-foreground">
              {isAuto ? "Mysoft varsayılanı (otomatik)" : `Kullanılan seri: ${activePrefix}`}
            </p>
          </div>
        </div>
        {!isAuto && (
          <Button variant="ghost" size="sm" onClick={onClear} disabled={saving}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Otomatiğe al"}
          </Button>
        )}
      </div>
      <div className="mt-3 rounded-lg border bg-background p-2.5">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Örnek belge no</p>
        <p className="mt-0.5 font-mono text-base font-bold tracking-wide text-kobipo-navy dark:text-foreground">
          {previewInvoiceNo(effective)}
        </p>
      </div>
    </div>
  )
}
