"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
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
  CheckCircle2,
  FileText,
  Hash,
  Info,
  Loader2,
  Plus,
  RefreshCcw,
  Save,
  ShieldCheck,
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
  eFaturaPrefix?: string | null
  eArchivePrefix?: string | null
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
  const [isSavingLocal, setIsSavingLocal] = useState(false)
  const [isAdding, setIsAdding] = useState(false)
  const [numerators, setNumerators] = useState<MysoftNumerator[]>([])
  const [mysoftError, setMysoftError] = useState<string | null>(null)
  const [tenantVkn, setTenantVkn] = useState<string | null>(null)
  const [companyChecked, setCompanyChecked] = useState(false)

  const [eFaturaPrefix, setEFaturaPrefix] = useState("")
  const [eArchivePrefix, setEArchivePrefix] = useState("")
  const [initial, setInitial] = useState<{ eFatura: string; eArchive: string }>({
    eFatura: "",
    eArchive: "",
  })

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
    const ef = (data.eFaturaPrefix || "").toUpperCase()
    const ea = (data.eArchivePrefix || "").toUpperCase()
    setEFaturaPrefix(ef)
    setEArchivePrefix(ea)
    setInitial({ eFatura: ef, eArchive: ea })
    const vkn = (data.eDonusumTenantVkn || "").replace(/\D/g, "")
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

  useEffect(() => {
    if (!companyId) return
    fetchCompany()
  }, [companyId, fetchCompany])

  // VKN doğrulandıktan SONRA numaratör listesini çek — VKN yoksa istek zaten 412 döner.
  useEffect(() => {
    if (!companyId || !tenantVkn) return
    fetchNumerators()
  }, [companyId, tenantVkn, fetchNumerators])

  const isDirty = useMemo(
    () => eFaturaPrefix !== initial.eFatura || eArchivePrefix !== initial.eArchive,
    [eFaturaPrefix, eArchivePrefix, initial]
  )

  const efaturaPrefixes = useMemo(
    () => numerators.filter((n) => isEFaturaType(n) && !n.isPassive),
    [numerators]
  )
  const earsivPrefixes = useMemo(
    () => numerators.filter((n) => isEArsivType(n) && !n.isPassive),
    [numerators]
  )

  // Mysoft'taki varsayılan numaratör (isDefault) — Kobipo'da prefix seçilmezse
  // gönderimde bu kullanılır. UI'da "otomatik" seçeneğinde bunu gösteriyoruz.
  const efaturaDefaultPrefix = useMemo(
    () => (efaturaPrefixes.find((n) => n.isDefault) || efaturaPrefixes[0])?.prefix || "",
    [efaturaPrefixes]
  )
  const earsivDefaultPrefix = useMemo(
    () => (earsivPrefixes.find((n) => n.isDefault) || earsivPrefixes[0])?.prefix || "",
    [earsivPrefixes]
  )

  const validate = () => {
    const valid = (p: string) => p.length === 0 || p.length === 3
    if (!valid(eFaturaPrefix) || !valid(eArchivePrefix)) {
      toast({
        title: "Geçersiz prefix",
        description: "Prefix tam olarak 3 karakter olmalı veya boş bırakılmalı.",
        variant: "destructive",
      })
      return false
    }
    return true
  }

  const saveLocal = async () => {
    if (!companyId) return
    if (!validate()) return
    setIsSavingLocal(true)
    try {
      const res = await fetch(`/api/companies/${companyId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eFaturaPrefix: eFaturaPrefix || null,
          eArchivePrefix: eArchivePrefix || null,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.error || "Kaydedilemedi")
      }
      toast({ title: "Başarılı", description: "Prefix seçimleri kaydedildi." })
      setInitial({ eFatura: eFaturaPrefix, eArchive: eArchivePrefix })
    } catch (error) {
      toast({
        title: "Hata",
        description: error instanceof Error ? error.message : "Hata",
        variant: "destructive",
      })
    } finally {
      setIsSavingLocal(false)
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

  // VKN doğrulanmamış → kullanıcıyı E-Dönüşüm Ayarları'na yönlendir
  if (companyChecked && !tenantVkn) {
    const settingsHref = `/ayarlar/e-donusum?company=${companyId}`
    return (
      <div className="space-y-5">
        <div>
          <h1 className="text-2xl font-bold text-kobipo-navy dark:text-foreground">Seri No Tanımları</h1>
          <p className="text-sm text-muted-foreground">
            Mysoft hesabınızdaki numaratörleri yönetin
          </p>
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
                Numaratör (prefix) yönetimi için Mysoft hesabınıza bağlı mükellefin VKN'sini E-Dönüşüm Ayarları'ndan
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

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-kobipo-navy dark:text-foreground">Seri No Tanımları</h1>
          <p className="text-sm text-muted-foreground">
            Mysoft hesabınızdaki numaratörleri yönetin ve hangi prefix'in kullanılacağını seçin
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

      {/* Mysoft tarafındaki numaratörler */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle>Mysoft'taki Numaratörler</CardTitle>
              <CardDescription>
                Bu liste Mysoft hesabınızdan anlık çekilir. "Yeni Numaratör" ile yeni prefix ekleyebilirsiniz.
              </CardDescription>
            </div>
            {!isLoading && numerators.length > 0 && (
              <Badge variant="secondary">{numerators.length} kayıt</Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Çekiliyor…
            </div>
          ) : numerators.length === 0 && !mysoftError ? (
            <div className="py-8 text-center">
              <p className="text-sm font-medium">Henüz tanımlı numaratör yok</p>
              <p className="mt-1 text-xs text-muted-foreground">
                "Yeni Numaratör" butonuyla ilk prefix'inizi ekleyin.
              </p>
            </div>
          ) : numerators.length > 0 ? (
            <div className="divide-y rounded-lg border">
              {numerators.map((n) => (
                <div
                  key={`${n.edocumentType}-${n.prefix}`}
                  className="flex items-center justify-between gap-3 px-4 py-3"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="flex h-9 w-12 shrink-0 items-center justify-center rounded-md bg-muted font-mono text-sm font-bold tracking-widest">
                      {n.prefix}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">
                        {n.edocumentTypeDescription || n.edocumentType}
                      </p>
                      <div className="mt-0.5 flex flex-wrap gap-1.5">
                        {n.isDefault && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                            <CheckCircle2 className="h-2.5 w-2.5" />
                            Varsayılan
                          </span>
                        )}
                        {n.isInternetSales && (
                          <span className="inline-flex rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                            İnternet Satış
                          </span>
                        )}
                        {n.isPassive && (
                          <span className="inline-flex rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700 dark:bg-slate-700 dark:text-slate-300">
                            Pasif
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Kobipo'da kullanılacak seçim */}
      <div className="grid gap-5 md:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-kobipo-blue/10 text-kobipo-blue dark:bg-primary/15 dark:text-primary">
                <ShieldCheck className="h-5 w-5" />
              </span>
              <div>
                <CardTitle>E-Fatura</CardTitle>
                <CardDescription>Kurumsal müşterilere kestiğiniz belgeler</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="eFaturaPrefix">Kullanılacak prefix</Label>
              {efaturaPrefixes.length > 0 ? (
                <Select
                  value={eFaturaPrefix || "__none__"}
                  onValueChange={(v) => setEFaturaPrefix(v === "__none__" ? "" : v)}
                  disabled={isSavingLocal}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Numaratör seçin" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">
                      {efaturaDefaultPrefix
                        ? `Mysoft varsayılanı: ${efaturaDefaultPrefix} (otomatik)`
                        : "Mysoft varsayılanı (otomatik)"}
                    </SelectItem>
                    {efaturaPrefixes.map((n) => (
                      <SelectItem key={n.prefix} value={n.prefix}>
                        {n.prefix} {n.isDefault ? "· Varsayılan" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  id="eFaturaPrefix"
                  value={eFaturaPrefix}
                  onChange={(e) => setEFaturaPrefix(sanitizePrefix(e.target.value))}
                  placeholder="MYF"
                  maxLength={3}
                  className="font-mono text-base font-semibold uppercase tracking-widest"
                  disabled={isSavingLocal}
                />
              )}
            </div>
            <div className="rounded-lg border bg-muted/30 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Örnek belge no
              </p>
              <p className="mt-1 font-mono text-lg font-bold tracking-wide text-kobipo-navy dark:text-foreground">
                {previewInvoiceNo(eFaturaPrefix || efaturaDefaultPrefix)}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                <FileText className="h-5 w-5" />
              </span>
              <div>
                <CardTitle>E-Arşiv</CardTitle>
                <CardDescription>Gerçek kişi/şahıs müşterilere kestiğiniz belgeler</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="eArchivePrefix">Kullanılacak prefix</Label>
              {earsivPrefixes.length > 0 ? (
                <Select
                  value={eArchivePrefix || "__none__"}
                  onValueChange={(v) => setEArchivePrefix(v === "__none__" ? "" : v)}
                  disabled={isSavingLocal}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Numaratör seçin" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">
                      {earsivDefaultPrefix
                        ? `Mysoft varsayılanı: ${earsivDefaultPrefix} (otomatik)`
                        : "Mysoft varsayılanı (otomatik)"}
                    </SelectItem>
                    {earsivPrefixes.map((n) => (
                      <SelectItem key={n.prefix} value={n.prefix}>
                        {n.prefix} {n.isDefault ? "· Varsayılan" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  id="eArchivePrefix"
                  value={eArchivePrefix}
                  onChange={(e) => setEArchivePrefix(sanitizePrefix(e.target.value))}
                  placeholder="SAD"
                  maxLength={3}
                  className="font-mono text-base font-semibold uppercase tracking-widest"
                  disabled={isSavingLocal}
                />
              )}
            </div>
            <div className="rounded-lg border bg-muted/30 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Örnek belge no
              </p>
              <p className="mt-1 font-mono text-lg font-bold tracking-wide text-kobipo-navy dark:text-foreground">
                {previewInvoiceNo(eArchivePrefix || earsivDefaultPrefix)}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-dashed">
        <CardContent className="flex items-start gap-3 p-4 text-sm text-muted-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="space-y-1">
            <p>
              <span className="font-medium text-foreground">Belge no formatı:</span>{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">
                PREFIX + YIL + 9 haneli sıra
              </code>{" "}
              (ör.{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">MYF2026000001</code>).
              Sıra Mysoft tarafında otomatik artar.
            </p>
            <p className="flex items-center gap-1.5">
              <Hash className="h-3 w-3" />
              Aynı prefix'i farklı belge tipi için yeniden kullanabilirsiniz.
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {isDirty ? "Kaydedilmemiş değişiklikler var" : "Tüm değişiklikler kayıtlı"}
        </p>
        <Button onClick={saveLocal} disabled={isSavingLocal || !isDirty}>
          <Save className="mr-2 h-4 w-4" />
          {isSavingLocal ? "Kaydediliyor…" : "Kaydet"}
        </Button>
      </div>

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
