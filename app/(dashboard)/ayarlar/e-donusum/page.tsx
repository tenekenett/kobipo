"use client"

import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from "@/components/ui/use-toast"
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  Fingerprint,
  KeyRound,
  Loader2,
  Save,
  Search,
  ShieldCheck,
  XCircle,
  Zap,
} from "lucide-react"
import { Switch } from "@/components/ui/switch"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

interface Company {
  id: string
  taxNumber?: string | null
  isEDonusumEnabled?: boolean
  eDonusumIntegrator?: string
  eDonusumProvider?: string
  eDonusumApiUsername?: string
  eDonusumApiPassword?: string
  eDonusumAlias?: string
  eDonusumApiUrl?: string
  eDonusumLastTestedAt?: string | null
  eDonusumLastTestSuccess?: boolean | null
  eDonusumTenantVkn?: string | null
}

interface DiscoveredTenant {
  vknTckn: string
  tenantName: string
  shortName: string
}

const PROVIDER_KEY = "mysoft"
const PROVIDER_LABEL = "Mysoft"

const sanitizeVkn = (raw: string) => raw.replace(/\D/g, "").slice(0, 11)

export default function EDonusumAyarlariPage() {
  const searchParams = useSearchParams()
  const companyId = searchParams.get("company")
  const { toast } = useToast()
  const [isLoading, setIsLoading] = useState(false)
  const [isTesting, setIsTesting] = useState(false)
  const [hasSavedPassword, setHasSavedPassword] = useState(false)
  const [lastTestedAt, setLastTestedAt] = useState<string | null>(null)
  const [lastTestSuccess, setLastTestSuccess] = useState<boolean | null>(null)
  // eDonusumApiUrl is intentionally kept in state but not shown in the UI —
  // we round-trip the existing value back so the backend doesn't wipe it.
  const [savedApiUrl, setSavedApiUrl] = useState<string>("")
  const [formData, setFormData] = useState({
    isEDonusumEnabled: false,
    eDonusumApiUsername: "",
    eDonusumApiPassword: "",
    eDonusumAlias: "",
  })

  // Mysoft Tenant VKN state
  const [tenantVkn, setTenantVkn] = useState("")
  const [savedTenantVkn, setSavedTenantVkn] = useState<string | null>(null)
  const [isDiscovering, setIsDiscovering] = useState(false)
  const [isVerifying, setIsVerifying] = useState(false)
  const [discoveredTenants, setDiscoveredTenants] = useState<DiscoveredTenant[] | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  // JWT'den çıkan tüm tenant adayları (kullanıcı tek tek deneyebilsin).
  const [jwtCandidates, setJwtCandidates] = useState<string[]>([])

  useEffect(() => {
    if (!companyId) return
    fetchCompany()
  }, [companyId])

  const fetchCompany = async () => {
    if (!companyId) return
    const response = await fetch(`/api/companies/${companyId}`)
    if (!response.ok) return
    const data = (await response.json()) as Company
    const passwordIsPlaceholder = data.eDonusumApiPassword === "***"
    setHasSavedPassword(passwordIsPlaceholder)
    setSavedApiUrl(data.eDonusumApiUrl || "")
    setLastTestedAt(data.eDonusumLastTestedAt || null)
    setLastTestSuccess(typeof data.eDonusumLastTestSuccess === "boolean" ? data.eDonusumLastTestSuccess : null)
    const savedVkn = (data.eDonusumTenantVkn || "").replace(/\D/g, "")
    // Kayıtlı/doğrulanmış VKN yoksa firma VKN'sini öneri olarak doldur.
    // Production'da firma VKN'si = Mysoft mükellef VKN'si (aynı tüzel kişi). Sen
    // sadece "Doğrula"ya basarsın. Farklıysa (örn. paylaşımlı test tenant'ı) üzerine yaz.
    const fallback = (data.taxNumber || "").replace(/\D/g, "")
    setTenantVkn(savedVkn || fallback)
    setSavedTenantVkn(savedVkn || null)
    setFormData({
      isEDonusumEnabled: Boolean(data.isEDonusumEnabled),
      eDonusumApiUsername: data.eDonusumApiUsername || "",
      eDonusumApiPassword: passwordIsPlaceholder ? "" : (data.eDonusumApiPassword || ""),
      eDonusumAlias: data.eDonusumAlias || "",
    })
  }

  const save = async () => {
    if (!companyId) return
    setIsLoading(true)
    try {
      const response = await fetch(`/api/companies/${companyId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...formData,
          eDonusumProvider: PROVIDER_KEY,
          eDonusumIntegrator: "OZEL_ENTEGRATOR",
          eDonusumApiUrl: savedApiUrl,
        }),
      })
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || "Kaydedilemedi")
      }
      toast({ title: "Başarılı", description: "E-Dönüşüm ayarları kaydedildi" })
      fetchCompany()
    } catch (error) {
      toast({
        title: "Hata",
        description: error instanceof Error ? error.message : "Bir hata oluştu",
        variant: "destructive",
      })
    } finally {
      setIsLoading(false)
    }
  }

  const testConnection = async () => {
    if (!formData.eDonusumApiUsername) {
      toast({
        title: "Eksik Bilgi",
        description: "Lütfen API Kullanıcı Adı'nı doldurun.",
        variant: "destructive",
      })
      return
    }
    if (!formData.eDonusumApiPassword && !hasSavedPassword) {
      toast({
        title: "Şifre Gerekli",
        description: "Lütfen API Şifresini girin veya önce kaydedin.",
        variant: "destructive",
      })
      return
    }

    setIsTesting(true)
    try {
      const response = await fetch("/api/test-mysoft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId,
          username: formData.eDonusumApiUsername,
          password: formData.eDonusumApiPassword || undefined,
        }),
      })
      const data = await response.json()

      if (data.success) {
        toast({
          title: "Bağlantı Başarılı",
          description: "Mysoft sistemine başarıyla giriş yapıldı.",
        })
        setLastTestSuccess(true)
        setLastTestedAt(new Date().toISOString())
      } else {
        throw new Error(data.message || "Giriş başarısız")
      }
    } catch (error) {
      setLastTestSuccess(false)
      setLastTestedAt(new Date().toISOString())
      toast({
        title: "Bağlantı Hatası",
        description: error instanceof Error ? error.message : "Mysoft sunucusuna ulaşılamadı.",
        variant: "destructive",
      })
    } finally {
      setIsTesting(false)
    }
  }

  const discoverTenant = async () => {
    if (!companyId) return
    setIsDiscovering(true)
    setDiscoveredTenants(null)
    setJwtCandidates([])
    try {
      const res = await fetch("/api/e-donusum/discover-tenant-vkn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || "Keşif başarısız")

      const tenants: DiscoveredTenant[] = Array.isArray(data.tenants) ? data.tenants : []
      const jwtCandidate: string | null = data.jwtCandidate || null
      const allCandidates: string[] = Array.isArray(data.jwtCandidates) ? data.jwtCandidates : []
      setJwtCandidates(allCandidates)

      if (tenants.length === 1) {
        setTenantVkn(tenants[0].vknTckn)
        toast({
          title: "Tenant bulundu",
          description: `${tenants[0].vknTckn} — ${tenants[0].tenantName || "Mysoft hesabınız"}. Şimdi "Doğrula"ya basın.`,
        })
      } else if (tenants.length > 1) {
        setDiscoveredTenants(tenants)
        setPickerOpen(true)
      } else if (jwtCandidate) {
        setTenantVkn(jwtCandidate)
        toast({
          title: "JWT'de aday bulundu",
          description: `${jwtCandidate} — Doğrulamadan kaydedilmeyecek. "Doğrula" ile teyit edin.`,
        })
      } else {
        toast({
          title: "Otomatik bulunamadı",
          description: "Mysoft hesabınızdan VKN'yi manuel olarak yazın ve 'Doğrula'ya basın.",
        })
      }
    } catch (error) {
      toast({
        title: "Hata",
        description: error instanceof Error ? error.message : "Keşif sırasında hata oluştu",
        variant: "destructive",
      })
    } finally {
      setIsDiscovering(false)
    }
  }

  const verifyTenant = async () => {
    if (!companyId) return
    const clean = sanitizeVkn(tenantVkn)
    if (clean.length !== 10 && clean.length !== 11) {
      toast({
        title: "Geçersiz VKN",
        description: "VKN 10 hane (kurumsal) veya 11 hane (gerçek kişi) olmalı.",
        variant: "destructive",
      })
      return
    }
    setIsVerifying(true)
    try {
      const res = await fetch("/api/e-donusum/verify-tenant-vkn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, vkn: clean }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        // Network/format hatası — DB durumuna güvenemiyoruz, en azından local state'i temizle.
        if (savedTenantVkn === clean) setSavedTenantVkn(null)
        throw new Error(data?.error || "Doğrulama isteği başarısız")
      }
      if (!data.success) {
        // Mysoft VKN'yi reddetti — backend stale DB değerini de temizledi, badge'i kaldır.
        if (savedTenantVkn === clean) setSavedTenantVkn(null)
        throw new Error(data.error || "VKN doğrulanmadı")
      }
      setSavedTenantVkn(clean)
      toast({
        title: "VKN doğrulandı",
        description: `Mysoft'ta ${data.numeratorCount} numaratör bulundu. Artık Seri No Tanımları'nı kullanabilirsiniz.`,
      })
    } catch (error) {
      toast({
        title: "Doğrulama başarısız",
        description: error instanceof Error ? error.message : "Mysoft VKN'yi kabul etmedi.",
        variant: "destructive",
      })
    } finally {
      setIsVerifying(false)
    }
  }

  if (!companyId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>E-Dönüşüm Ayarları</CardTitle>
          <CardDescription>Firma seçiniz</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  const formatTested = (iso: string | null) => {
    if (!iso) return null
    try {
      return new Date(iso).toLocaleString("tr-TR", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    } catch {
      return null
    }
  }

  const isVknVerified = savedTenantVkn !== null && sanitizeVkn(tenantVkn) === savedTenantVkn

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-kobipo-navy dark:text-foreground">E-Dönüşüm Ayarları</h1>
        <p className="text-sm text-muted-foreground">
          E-Fatura ve e-Arşiv entegrasyon bilgilerini yönetin
        </p>
      </div>

      {/* Provider banner */}
      <Card className="overflow-hidden">
        <div className="flex flex-col gap-4 bg-gradient-to-br from-kobipo-pale/70 to-transparent p-5 dark:from-primary/10 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-kobipo-blue text-white shadow-card dark:bg-primary dark:text-primary-foreground">
              <ShieldCheck className="h-6 w-6" />
            </span>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sağlayıcı</p>
              <p className="text-lg font-bold text-kobipo-navy dark:text-foreground">{PROVIDER_LABEL}</p>
              <p className="text-xs text-muted-foreground">
                Faturalarınız Mysoft entegratörü üzerinden gönderilir
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {lastTestSuccess === true ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-1 font-medium text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Bağlantı doğrulandı
              </span>
            ) : lastTestSuccess === false ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-red-100 px-2.5 py-1 font-medium text-red-700 dark:bg-red-900/30 dark:text-red-300">
                <XCircle className="h-3.5 w-3.5" />
                Bağlantı başarısız
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 font-medium text-muted-foreground">
                Henüz test edilmedi
              </span>
            )}
            {formatTested(lastTestedAt) && (
              <span className="text-muted-foreground">{formatTested(lastTestedAt)}</span>
            )}
          </div>
        </div>
      </Card>

      {/* Activation toggle */}
      <Card>
        <CardContent className="flex items-center justify-between gap-4 p-5">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-kobipo-blue/10 text-kobipo-blue dark:bg-primary/15 dark:text-primary">
              <Zap className="h-4 w-4" />
            </span>
            <div>
              <p className="text-sm font-semibold">E-Dönüşüm aktif</p>
              <p className="text-xs text-muted-foreground">
                Açıkken kestiğiniz faturalar Mysoft üzerinden e-Fatura/e-Arşiv olarak gönderilir
              </p>
            </div>
          </div>
          <Switch
            checked={formData.isEDonusumEnabled}
            onCheckedChange={(checked) =>
              setFormData((prev) => ({ ...prev, isEDonusumEnabled: checked }))
            }
            disabled={isLoading}
          />
        </CardContent>
      </Card>

      {/* Credentials */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
              <KeyRound className="h-4 w-4" />
            </span>
            <div>
              <CardTitle>API Erişim Bilgileri</CardTitle>
              <CardDescription>
                Mysoft tarafından size verilen kullanıcı adı, şifre ve etiket bilgileri
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="alias">
                Etiket (Alias)
                <span className="ml-1 text-xs font-normal text-muted-foreground">opsiyonel</span>
              </Label>
              <Input
                id="alias"
                value={formData.eDonusumAlias}
                onChange={(event) =>
                  setFormData((prev) => ({ ...prev, eDonusumAlias: event.target.value }))
                }
                placeholder="urn:mail:..."
                disabled={isLoading}
              />
              <p className="text-xs text-muted-foreground">
                GİB tarafından firmanıza atanan posta kutusu etiketi
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="username">API Kullanıcı Adı</Label>
              <Input
                id="username"
                value={formData.eDonusumApiUsername}
                onChange={(event) =>
                  setFormData((prev) => ({ ...prev, eDonusumApiUsername: event.target.value }))
                }
                autoComplete="off"
                disabled={isLoading}
              />
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="password" className="flex items-center justify-between gap-2">
                <span>
                  API Şifre
                  {hasSavedPassword && (
                    <span className="ml-2 inline-flex items-center gap-1 text-xs font-normal text-emerald-700 dark:text-emerald-400">
                      <CheckCircle2 className="h-3 w-3" />
                      Kayıtlı
                    </span>
                  )}
                </span>
              </Label>
              <Input
                id="password"
                type="password"
                value={formData.eDonusumApiPassword}
                onChange={(event) =>
                  setFormData((prev) => ({ ...prev, eDonusumApiPassword: event.target.value }))
                }
                placeholder={
                  hasSavedPassword
                    ? "Değiştirmek için yeni şifre girin (boş bırakılırsa korunur)"
                    : "API şifresi"
                }
                autoComplete="new-password"
                disabled={isLoading}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Mysoft Mükellef VKN */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-kobipo-blue/10 text-kobipo-blue dark:bg-primary/15 dark:text-primary">
              <Fingerprint className="h-4 w-4" />
            </span>
            <div>
              <CardTitle>Mysoft Mükellef VKN/TCKN</CardTitle>
              <CardDescription>
                Mysoft hesabınıza bağlı mükellefin VKN/TCKN'si. Numaratör (prefix) yönetimi ve fatura gönderimi için gerekli.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-[1fr_auto_auto] md:items-end">
            <div className="space-y-2">
              <Label htmlFor="tenantVkn" className="flex items-center gap-2">
                VKN/TCKN
                {isVknVerified && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                    <CheckCircle2 className="h-3 w-3" />
                    Doğrulandı
                  </span>
                )}
              </Label>
              <Input
                id="tenantVkn"
                value={tenantVkn}
                onChange={(e) => setTenantVkn(sanitizeVkn(e.target.value))}
                placeholder="10 veya 11 haneli VKN/TCKN"
                inputMode="numeric"
                maxLength={11}
                className="font-mono tracking-wider"
                disabled={isVerifying || isDiscovering}
              />
            </div>
            <Button
              variant="outline"
              onClick={discoverTenant}
              disabled={isDiscovering || isVerifying}
              type="button"
            >
              {isDiscovering ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Aranıyor…
                </>
              ) : (
                <>
                  <Search className="mr-2 h-4 w-4" />
                  Otomatik Bul
                </>
              )}
            </Button>
            <Button
              onClick={verifyTenant}
              disabled={isDiscovering || isVerifying || !tenantVkn}
              type="button"
            >
              {isVerifying ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Doğrulanıyor…
                </>
              ) : (
                <>
                  <ShieldCheck className="mr-2 h-4 w-4" />
                  Doğrula
                </>
              )}
            </Button>
          </div>
          {!isVknVerified && tenantVkn.length > 0 && (
            <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                VKN henüz doğrulanmadı. "Doğrula" butonu Mysoft'a probe atar ve başarılıysa otomatik kaydeder.
              </p>
            </div>
          )}
          {jwtCandidates.length > 1 && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">
                JWT'de birden fazla aday bulundu — tek tek deneyebilirsin:
              </p>
              <div className="flex flex-wrap gap-1.5">
                {jwtCandidates.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setTenantVkn(c)}
                    disabled={isVerifying || isDiscovering}
                    className={`rounded-full border px-2.5 py-1 font-mono text-xs transition ${
                      tenantVkn === c
                        ? "border-kobipo-blue bg-kobipo-blue/10 text-kobipo-navy dark:border-primary dark:bg-primary/15 dark:text-primary"
                        : "border-muted-foreground/20 hover:bg-muted"
                    }`}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Genelde <span className="font-medium text-foreground">Kobipo firma VKN'nizle aynıdır</span> — Mysoft'a kayıt olurken şirketinizin gerçek VKN'sini bildirmişsinizdir. Otomatik dolu geliyor, "Doğrula"ya basın. Bulamazsan vergi levhandan kontrol et.
          </p>
        </CardContent>
      </Card>

      {/* Help */}
      <Card className="border-dashed">
        <CardContent className="flex items-start gap-3 p-5 text-sm">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <FileText className="h-4 w-4" />
          </span>
          <div className="space-y-1 text-muted-foreground">
            <p className="font-medium text-foreground">Bağlantı bilgilerinizi nasıl alırsınız?</p>
            <p>
              Mysoft müşteri panelinizden API kullanıcı adı ve şifrenizi alabilirsiniz. Bağlantı
              kuramazsanız <span className="font-medium text-foreground">Destek</span> ekranından
              talep oluşturun.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" onClick={testConnection} disabled={isTesting || isLoading}>
          {isTesting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Test ediliyor…
            </>
          ) : (
            "Test Bağlantısı"
          )}
        </Button>
        <Button onClick={save} disabled={isLoading || isTesting}>
          <Save className="mr-2 h-4 w-4" />
          {isLoading ? "Kaydediliyor…" : "Kaydet"}
        </Button>
      </div>

      {/* Multi-tenant picker dialog */}
      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Birden fazla mükellef bulundu</DialogTitle>
            <DialogDescription>
              Mysoft hesabınızda yetkili olduğunuz birden fazla firma var. Birini seçin:
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            {(discoveredTenants || []).map((t) => (
              <button
                key={t.vknTckn}
                type="button"
                onClick={() => {
                  setTenantVkn(t.vknTckn)
                  setPickerOpen(false)
                }}
                className="flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-left text-sm transition hover:bg-muted"
              >
                <div>
                  <p className="font-semibold">{t.tenantName || t.shortName || "(isim yok)"}</p>
                  <p className="font-mono text-xs text-muted-foreground">{t.vknTckn}</p>
                </div>
              </button>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPickerOpen(false)}>
              Vazgeç
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
