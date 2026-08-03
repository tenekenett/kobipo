"use client"

import { useEffect, useState, type ReactNode } from "react"
import { useSearchParams } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from "@/components/ui/use-toast"
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Clock,
  FileText,
  Globe,
  KeyRound,
  Loader2,
  RefreshCw,
  Rocket,
  Save,
  ShieldCheck,
  XCircle,
  Zap,
} from "lucide-react"
import { Switch } from "@/components/ui/switch"
import { MYSOFT_PROD_URL, MYSOFT_TEST_URL } from "@/lib/integrations/e-invoice/constants"

interface Company {
  id: string
  name?: string | null
  taxNumber?: string | null
  taxOffice?: string | null
  email?: string | null
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
  eFaturaPrefix?: string | null
  eArchivePrefix?: string | null
  eDonusumOnboardingStatus?: string | null
  eDonusumTenantCreatedAt?: string | null
  eDonusumActivatedProducts?: string[]
  eDonusumActivationError?: string | null
}

const PROVIDER_KEY = "mysoft"
const PROVIDER_LABEL = "Mysoft"

// Onboarding durum → görünen etiket + renk tonu.
const STATUS_META: Record<string, { label: string; tone: "muted" | "amber" | "emerald" | "red" }> = {
  NONE: { label: "Başvuru yapılmadı", tone: "muted" },
  TENANT_CREATED: { label: "Firma açıldı — aktivasyon bekliyor", tone: "amber" },
  ACTIVATION_PENDING: { label: "GİB onayı bekleniyor", tone: "amber" },
  ACTIVE: { label: "Aktif", tone: "emerald" },
  FAILED: { label: "Hata", tone: "red" },
}

const TONE_CLASS: Record<string, string> = {
  muted: "bg-muted text-muted-foreground",
  amber: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  emerald: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
  red: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
}

type StatusRow = {
  productType: string | null
  demandStatus: string | null
  state: "approved" | "error" | "pending"
  gibServiceMessage: string | null
  serialNumberPrefix: string | null
}

export default function EDonusumAyarlariPage() {
  const searchParams = useSearchParams()
  const companyId = searchParams.get("company")
  const { toast } = useToast()
  const [isLoading, setIsLoading] = useState(false)
  const [isTesting, setIsTesting] = useState(false)
  const [hasSavedPassword, setHasSavedPassword] = useState(false)
  const [lastTestedAt, setLastTestedAt] = useState<string | null>(null)
  const [lastTestSuccess, setLastTestSuccess] = useState<boolean | null>(null)

  // Ortam seçimi: company.eDonusumApiUrl alanına eşlenir. Canlı → MYSOFT_PROD_URL,
  // Test → MYSOFT_TEST_URL. Kayıtlı URL prod ile birebir eşleşmiyorsa güvenli
  // varsayılan olarak "test" kabul edilir.
  const [environment, setEnvironment] = useState<"test" | "live">("test")
  const [formData, setFormData] = useState({
    isEDonusumEnabled: false,
    eDonusumApiUsername: "",
    eDonusumApiPassword: "",
    eDonusumAlias: "",
  })

  // Mysoft mükellef VKN'si — firmanın VKN'sinden okunur (sadece görüntü).
  const [tenantVkn, setTenantVkn] = useState("")

  // --- Onboarding (bayi self-servis başvuru) — alttaki kapalı bölüm ---
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [onboardingStatus, setOnboardingStatus] = useState<string>("NONE")
  const [activationError, setActivationError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isChecking, setIsChecking] = useState(false)
  const [statusRows, setStatusRows] = useState<StatusRow[] | null>(null)
  const [submitResult, setSubmitResult] = useState<Array<{ type: string; ok: boolean; error?: string }> | null>(
    null,
  )
  // Kapsam (2026-08-03): yalnızca e-Arşiv. E-Fatura mükellefin mali mührünü gerektirdiği
  // için devre dışı — route seviyesinde de kapalı. Bkz. docs/e-donusum-onboarding/PLAN.md §3.1.
  const [products, setProducts] = useState({
    EArchive: { enabled: true },
  })

  // İnteraktif Vergi Dairesi kimliği — GİB başvurusu bununla yapılır (mali mühür yerine).
  // 🔒 Yalnızca başvuru isteğiyle sunucuya gider; hiçbir yere kaydedilmez ve başarılı
  // başvurudan sonra state'ten temizlenir.
  const [ivd, setIvd] = useState({ username: "", password: "" })
  const [consent, setConsent] = useState(false)

  useEffect(() => {
    if (!companyId) return
    fetchCompany()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId])

  const fetchCompany = async () => {
    if (!companyId) return
    const response = await fetch(`/api/companies/${companyId}`)
    if (!response.ok) return
    const data = (await response.json()) as Company
    const passwordIsPlaceholder = data.eDonusumApiPassword === "***"
    setHasSavedPassword(passwordIsPlaceholder)
    setEnvironment((data.eDonusumApiUrl || "").trim() === MYSOFT_PROD_URL ? "live" : "test")
    setLastTestedAt(data.eDonusumLastTestedAt || null)
    setLastTestSuccess(typeof data.eDonusumLastTestSuccess === "boolean" ? data.eDonusumLastTestSuccess : null)
    const companyVkn = (data.eDonusumTenantVkn || data.taxNumber || "").replace(/\D/g, "")
    setTenantVkn(companyVkn)
    setFormData({
      isEDonusumEnabled: Boolean(data.isEDonusumEnabled),
      eDonusumApiUsername: data.eDonusumApiUsername || "",
      eDonusumApiPassword: passwordIsPlaceholder ? "" : (data.eDonusumApiPassword || ""),
      eDonusumAlias: data.eDonusumAlias || "",
    })

    // Onboarding durumu (alttaki bölüm)
    setOnboardingStatus(data.eDonusumOnboardingStatus || "NONE")
    setActivationError(data.eDonusumActivationError || null)
  }

  const persistSettings = async (): Promise<boolean> => {
    if (!companyId) return false
    const response = await fetch(`/api/companies/${companyId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...formData,
        eDonusumProvider: PROVIDER_KEY,
        eDonusumIntegrator: "OZEL_ENTEGRATOR",
        eDonusumApiUrl: environment === "live" ? MYSOFT_PROD_URL : MYSOFT_TEST_URL,
      }),
    })
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      throw new Error(data.error || "Kaydedilemedi")
    }
    return true
  }

  const save = async () => {
    if (!companyId) return
    setIsLoading(true)
    try {
      await persistSettings()
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
      toast({ title: "Eksik Bilgi", description: "Lütfen API Kullanıcı Adı'nı doldurun.", variant: "destructive" })
      return
    }
    if (!formData.eDonusumApiPassword && !hasSavedPassword) {
      toast({ title: "Şifre Gerekli", description: "Lütfen API Şifresini girin veya önce kaydedin.", variant: "destructive" })
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
          apiUrl: environment === "live" ? MYSOFT_PROD_URL : MYSOFT_TEST_URL,
        }),
      })
      const data = await response.json()
      if (data.success) {
        toast({ title: "Bağlantı Başarılı", description: "Mysoft sistemine başarıyla giriş yapıldı." })
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

  // --- Onboarding (alttaki kapalı bölüm) ---
  const submitOnboarding = async () => {
    if (!companyId) return
    const payloadProducts: any[] = []
    if (products.EArchive.enabled) {
      payloadProducts.push({ type: "EArchive" })
    }
    if (payloadProducts.length === 0) {
      toast({ title: "Ürün seçin", description: "E-Arşiv Fatura'yı açık duruma getirin.", variant: "destructive" })
      return
    }
    if (!ivd.username.trim() || !ivd.password) {
      toast({
        title: "İVD bilgileri gerekli",
        description:
          "GİB başvurusu İnteraktif Vergi Dairesi kimliğinizle yapılıyor — kullanıcı kodu ve şifre zorunlu.",
        variant: "destructive",
      })
      return
    }
    if (!consent) {
      toast({
        title: "Onay gerekli",
        description: "Devam etmek için yetkilendirme onayını işaretleyin.",
        variant: "destructive",
      })
      return
    }
    // Seri ön ek (prefix) artık kullanıcıdan İSTENMEZ: Mysoft aktivasyonunda backend
    // otomatik atar (firma adından türetir). Kullanıcı sonradan Seri No Tanımları'ndan
    // değiştirebilir. Bu yüzden payload'a serialNumberPrefix koymuyoruz.

    setIsSubmitting(true)
    setSubmitResult(null)
    try {
      const res = await fetch("/api/e-donusum/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId,
          products: payloadProducts,
          ivdUsername: ivd.username.trim(),
          ivdPassword: ivd.password,
          consentAccepted: consent,
        }),
      })
      const data = await res.json()
      setSubmitResult(Array.isArray(data.activations) ? data.activations : null)
      if (data.success) {
        setOnboardingStatus(data.status || "ACTIVATION_PENDING")
        // 🔒 Başvuru gittiğine göre şifreye artık gerek yok — bellekten temizle.
        // (Hata durumunda BIRAKILIYOR ki kullanıcı baştan yazmak zorunda kalmasın.)
        setIvd((v) => ({ ...v, password: "" }))
        toast({
          title: "Başvuru alındı",
          description: "Firma açıldı ve aktivasyon başvurusu GİB'e iletildi. Durumu 'Yenile' ile takip edin.",
        })
        fetchCompany()
      } else {
        throw new Error(data.error || "Başvuru başarısız")
      }
    } catch (error) {
      toast({
        title: "Başvuru hatası",
        description: error instanceof Error ? error.message : "Bir hata oluştu",
        variant: "destructive",
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  const refreshStatus = async () => {
    if (!companyId) return
    setIsChecking(true)
    try {
      const res = await fetch(`/api/e-donusum/onboarding/status?companyId=${encodeURIComponent(companyId)}`)
      const data = await res.json()
      if (!data.success) throw new Error(data.error || "Durum alınamadı")
      setStatusRows(Array.isArray(data.activations) ? data.activations : [])
      if (data.status) setOnboardingStatus(data.status)
      if (data.allApproved) {
        toast({ title: "Aktivasyon onaylandı", description: "Tüm ürünler GİB tarafından onaylandı." })
      }
    } catch (error) {
      toast({
        title: "Durum hatası",
        description: error instanceof Error ? error.message : "Bir hata oluştu",
        variant: "destructive",
      })
    } finally {
      setIsChecking(false)
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
      return new Date(iso).toLocaleString("tr-TR", { dateStyle: "medium", timeStyle: "short" })
    } catch {
      return null
    }
  }

  const statusMeta = STATUS_META[onboardingStatus] || STATUS_META.NONE
  const hasStarted = onboardingStatus !== "NONE"
  // Tenant açıldıysa (başvuru gitti) fatura kesebilmek için kontör yüklenmeli → CTA göster.
  const tenantReady = ["TENANT_CREATED", "ACTIVATION_PENDING", "ACTIVE"].includes(onboardingStatus)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-kobipo-navy dark:text-foreground">E-Dönüşüm Ayarları</h1>
          <p className="text-sm text-muted-foreground">
            E-Fatura ve e-Arşiv entegrasyon bilgilerini yönetin
          </p>
        </div>
        <Button onClick={save} variant="success" disabled={isLoading || isTesting}>
          <Save className="mr-2 h-4 w-4" />
          {isLoading ? "Kaydediliyor…" : "Kaydet"}
        </Button>
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
            onCheckedChange={(checked) => setFormData((prev) => ({ ...prev, isEDonusumEnabled: checked }))}
            disabled={isLoading}
          />
        </CardContent>
      </Card>

      {/* Environment selector */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-kobipo-blue/10 text-kobipo-blue dark:bg-primary/15 dark:text-primary">
              <Globe className="h-4 w-4" />
            </span>
            <div>
              <CardTitle>Ortam</CardTitle>
              <CardDescription>
                Faturaların gönderileceği Mysoft ortamı. Canlı seçiliyken belgeler gerçek olarak GİB'e iletilir.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            {([
              { key: "test", title: "Test", desc: "Deneme ortamı — faturalar GİB'e gitmez." },
              { key: "live", title: "Canlı", desc: "Gerçek ortam — faturalar GİB'e gönderilir." },
            ] as const).map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => setEnvironment(opt.key)}
                disabled={isLoading}
                className={`flex flex-col gap-1 rounded-lg border p-4 text-left transition ${
                  environment === opt.key
                    ? "border-kobipo-blue bg-kobipo-blue/5 ring-1 ring-kobipo-blue dark:border-primary dark:bg-primary/10 dark:ring-primary"
                    : "border-muted-foreground/20 hover:bg-muted"
                }`}
              >
                <span className="flex items-center gap-2 text-sm font-semibold">
                  {environment === opt.key && <CheckCircle2 className="h-4 w-4 text-kobipo-blue dark:text-primary" />}
                  {opt.title}
                </span>
                <span className="text-xs text-muted-foreground">{opt.desc}</span>
              </button>
            ))}
          </div>
          {environment === "live" && (
            <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                <span className="font-semibold">Canlı ortam seçili.</span> Kaydettikten sonra kestiğiniz e-Fatura/e-Arşiv
                belgeleri gerçek olarak GİB'e gönderilir. Canlı API kullanıcı/şifrenizi girip "Test Bağlantısı" ile
                doğruladığınızdan emin olun.
              </p>
            </div>
          )}
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
                onChange={(event) => setFormData((prev) => ({ ...prev, eDonusumAlias: event.target.value }))}
                placeholder="urn:mail:..."
                disabled={isLoading}
              />
              <p className="text-xs text-muted-foreground">GİB tarafından firmanıza atanan posta kutusu etiketi</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="username">API Kullanıcı Adı</Label>
              <Input
                id="username"
                value={formData.eDonusumApiUsername}
                onChange={(event) => setFormData((prev) => ({ ...prev, eDonusumApiUsername: event.target.value }))}
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
                      <CheckCircle2 className="h-3 w-3" /> Kayıtlı
                    </span>
                  )}
                </span>
              </Label>
              <Input
                id="password"
                type="password"
                value={formData.eDonusumApiPassword}
                onChange={(event) => setFormData((prev) => ({ ...prev, eDonusumApiPassword: event.target.value }))}
                placeholder={hasSavedPassword ? "Değiştirmek için yeni şifre girin (boş bırakılırsa korunur)" : "API şifresi"}
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
              <ShieldCheck className="h-4 w-4" />
            </span>
            <div>
              <CardTitle>Mysoft Mükellef VKN/TCKN</CardTitle>
              <CardDescription>
                Faturalar firmanızın VKN'si üzerinden gönderilir — ayrı bir doğrulama adımı gerekmez.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          <Label>Kullanılan VKN/TCKN</Label>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex h-10 items-center rounded-md border bg-muted/40 px-3 font-mono text-sm tracking-wider">
              {tenantVkn || "—"}
            </span>
            {!tenantVkn && (
              <span className="text-xs text-amber-700 dark:text-amber-300">
                Firma VKN'niz boş —{" "}
                <a href={`/ayarlar/firma?company=${companyId}`} className="font-medium underline">
                  Firma Ayarları
                </a>
                'ndan girin.
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Bu değer Firma Ayarları'ndaki VKN'den gelir. Değiştirmek için firma bilgilerinizi güncelleyin.
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
              Mysoft müşteri panelinizden API kullanıcı adı ve şifrenizi alabilirsiniz. Bağlantı kuramazsanız{" "}
              <span className="font-medium text-foreground">Destek</span> ekranından talep oluşturun.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" onClick={testConnection} disabled={isTesting || isLoading}>
          {isTesting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Test ediliyor…
            </>
          ) : (
            "Test Bağlantısı"
          )}
        </Button>
        <Button onClick={save} variant="success" disabled={isLoading || isTesting}>
          <Save className="mr-2 h-4 w-4" />
          {isLoading ? "Kaydediliyor…" : "Kaydet"}
        </Button>
      </div>

      {/* En altta, kapalı: Kobipo ile e-Dönüşüm başvurusu (beta — geliştiriliyor) */}
      <Card className="border-dashed">
        <button
          type="button"
          onClick={() => setShowOnboarding((v) => !v)}
          className="flex w-full items-center justify-between gap-3 p-5 text-left"
        >
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <Rocket className="h-4 w-4" />
            </span>
            <div>
              <p className="text-sm font-semibold">
                Kobipo ile e-Arşiv Başvurusu
                <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                  Beta
                </span>
              </p>
              <p className="text-xs text-muted-foreground">
                Mali mühür olmadan, İnteraktif Vergi Dairesi bilgilerinizle e-Arşiv hesabınızı açın
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {hasStarted && (
              <span className={`hidden rounded-full px-2 py-0.5 text-[10px] font-medium sm:inline ${TONE_CLASS[statusMeta.tone]}`}>
                {statusMeta.label}
              </span>
            )}
            <ChevronDown className={`h-5 w-5 shrink-0 text-muted-foreground transition-transform ${showOnboarding ? "rotate-180" : ""}`} />
          </div>
        </button>

        {showOnboarding && (
          <CardContent className="space-y-4 border-t pt-5">
            {!tenantVkn && (
              <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <p>
                  Firma VKN'niz boş.{" "}
                  <a href={`/ayarlar/firma?company=${companyId}`} className="font-medium underline">
                    Firma Ayarları
                  </a>
                  'ndan VKN'yi girmeden başvuru yapılamaz.
                </p>
              </div>
            )}

            <ProductRow
              title="E-Arşiv Fatura"
              desc="Nihai tüketiciye/mükellef olmayanlara kesilen faturalar"
              enabled={products.EArchive.enabled}
              onToggle={(v) => setProducts((p) => ({ ...p, EArchive: { ...p.EArchive, enabled: v } }))}
            />

            <ProductRow
              title="E-Fatura"
              desc="GİB e-Fatura mükelleflerine kesilen faturalar"
              enabled={false}
              onToggle={() => {}}
              disabled
              badge="Yakında"
              note={
                <p className="rounded-md border bg-muted/40 p-2.5 text-[11px] leading-relaxed text-muted-foreground">
                  E-Fatura başvurusu için mükellefin <span className="font-medium">mali mührü</span>{" "}
                  (tüzel kişi) ya da <span className="font-medium">e-imzası</span> (şahıs firması)
                  gerekiyor. Mühürle imzalama, cihazın takılı olduğu bilgisayarda yapılmak zorunda
                  olduğundan bu adım Kobipo üzerinden yürütülemiyor. E-Arşiv'de böyle bir şart yok.
                </p>
              }
            />

            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Fatura seri ön eki (numaratör) başvuruda otomatik atanır — sonra{" "}
              <span className="font-medium">Seri No Tanımları</span>'ndan değiştirebilirsiniz.
            </p>

            {/* İVD kimliği — GİB başvurusu bununla yapılır (mali mühür yerine geçen yol) */}
            <div className="space-y-3 rounded-lg border p-4">
              <div className="flex items-start gap-2">
                <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <div>
                  <p className="text-sm font-semibold">İnteraktif Vergi Dairesi bilgileri</p>
                  <p className="text-xs text-muted-foreground">
                    GİB başvurusu adınıza bu kimlikle yapılır — mali mühür veya e-imza gerekmez.
                  </p>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-xs">İVD kullanıcı kodu</Label>
                  <Input
                    value={ivd.username}
                    onChange={(e) => setIvd((v) => ({ ...v, username: e.target.value }))}
                    placeholder="Genelde VKN / TCKN"
                    autoComplete="off"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">İVD şifresi</Label>
                  <Input
                    type="password"
                    value={ivd.password}
                    onChange={(e) => setIvd((v) => ({ ...v, password: e.target.value }))}
                    placeholder="••••••••"
                    autoComplete="new-password"
                  />
                </div>
              </div>

              <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="space-y-1">
                  <p>
                    Başvurunun tamamlanabilmesi için{" "}
                    <span className="font-medium">İnteraktif Vergi Dairesi'ne kayıtlı bir telefon
                    numaranız</span>{" "}
                    olmalıdır.
                  </p>
                  <p>
                    Şifrenizi bilmiyorsanız çoğunlukla mali müşavirinizdedir; yoksa{" "}
                    <a
                      href="https://ivd.gib.gov.tr"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium underline"
                    >
                      ivd.gib.gov.tr
                    </a>{" "}
                    üzerinden edinebilirsiniz.
                  </p>
                </div>
              </div>

              <p className="flex items-start gap-2 text-[11px] leading-relaxed text-muted-foreground">
                <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Şifreniz yalnızca bu başvuru isteğiyle birlikte iletilir — Kobipo veritabanına
                kaydedilmez, kayıtlara yazılmaz.
              </p>
            </div>

            {/* Yetkilendirme onayı — kaydı SystemLog'a düşer (zaman + IP + kullanıcı) */}
            <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border p-4 text-xs leading-relaxed">
              <input
                type="checkbox"
                className="mt-0.5 rounded"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
              />
              <span>
                Kobipo'yu, girdiğim İnteraktif Vergi Dairesi bilgileriyle{" "}
                <span className="font-medium">adıma e-Dönüşüm başvurusu yapmak</span> üzere
                yetkilendiriyorum. Başvurunun özel entegratör (Mysoft) üzerinden GİB'e iletileceğini
                kabul ediyorum.
              </span>
            </label>

            {activationError && (
              <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-800 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
                <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <p>
                  <span className="font-semibold">Son hata:</span> {activationError}
                </p>
              </div>
            )}

            {submitResult && submitResult.length > 0 && (
              <div className="space-y-1.5 rounded-md border bg-muted/30 p-3 text-xs">
                <p className="font-semibold">Başvuru sonucu</p>
                {submitResult.map((a) => (
                  <div key={a.type} className="flex items-center gap-2">
                    {a.ok ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                    ) : (
                      <XCircle className="h-3.5 w-3.5 text-red-600" />
                    )}
                    <span className="font-medium">{a.type === "EInvoice" ? "E-Fatura" : a.type === "EArchive" ? "E-Arşiv" : a.type}</span>
                    {!a.ok && a.error && <span className="text-red-700 dark:text-red-300">— {a.error}</span>}
                  </div>
                ))}
              </div>
            )}

            {statusRows && statusRows.length > 0 && (
              <div className="space-y-1.5 rounded-md border bg-muted/30 p-3 text-xs">
                <p className="font-semibold">GİB aktivasyon durumu</p>
                {statusRows.map((r, i) => (
                  <div key={`${r.productType}-${i}`} className="flex flex-wrap items-center gap-2">
                    {r.state === "approved" ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                    ) : r.state === "error" ? (
                      <XCircle className="h-3.5 w-3.5 text-red-600" />
                    ) : (
                      <Clock className="h-3.5 w-3.5 text-amber-600" />
                    )}
                    <span className="font-medium">{r.productType || "—"}</span>
                    <span className="text-muted-foreground">{r.demandStatus || r.state}</span>
                    {r.serialNumberPrefix && <span className="text-muted-foreground">· {r.serialNumberPrefix}</span>}
                    {r.gibServiceMessage && <span className="text-muted-foreground">· {r.gibServiceMessage}</span>}
                  </div>
                ))}
              </div>
            )}

            <div className="flex flex-wrap gap-2 pt-1">
              <Button onClick={submitOnboarding} disabled={isSubmitting || isChecking || !tenantVkn}>
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Başvuruluyor…
                  </>
                ) : (
                  <>
                    <Rocket className="mr-2 h-4 w-4" />
                    {hasStarted ? "Tekrar Başvur / Ürün Ekle" : "Başvur ve Aktive Et"}
                  </>
                )}
              </Button>
              {hasStarted && (
                <Button variant="outline" onClick={refreshStatus} disabled={isChecking || isSubmitting}>
                  {isChecking ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Sorgulanıyor…
                    </>
                  ) : (
                    <>
                      <RefreshCw className="mr-2 h-4 w-4" /> Durumu Yenile
                    </>
                  )}
                </Button>
              )}
            </div>

            {tenantReady && (
              <div className="flex flex-col gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm dark:border-emerald-900/40 dark:bg-emerald-950/30 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-2">
                  <Zap className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                  <p className="text-emerald-900 dark:text-emerald-200">
                    e-Dönüşüm hesabınız hazırlanıyor. Fatura kesebilmek için{" "}
                    <span className="font-medium">kontör (belge kredisi)</span> yüklemeniz gerekir.
                  </p>
                </div>
                <Button asChild size="sm" className="shrink-0 bg-emerald-600 hover:bg-emerald-700">
                  <a href={`/e-donusum/kontor?company=${companyId}`}>
                    <Zap className="mr-2 h-4 w-4" /> Kontör Yükle
                  </a>
                </Button>
              </div>
            )}
          </CardContent>
        )}
      </Card>
    </div>
  )
}

// Ürün seçim satırı: aç/kapa (seri ön ek başvuruda otomatik atanır — burada sorulmaz).
// `disabled` → kapsam dışı ürün: anahtar kilitli, `note` ile gerekçe gösterilir.
function ProductRow({
  title,
  desc,
  enabled,
  onToggle,
  disabled,
  badge,
  note,
  children,
}: {
  title: string
  desc: string
  enabled: boolean
  onToggle: (v: boolean) => void
  disabled?: boolean
  badge?: string
  note?: ReactNode
  children?: ReactNode
}) {
  const shellClass = disabled
    ? "border-muted-foreground/20 bg-muted/30"
    : enabled
      ? "border-kobipo-blue/40 bg-kobipo-blue/5 dark:border-primary/40 dark:bg-primary/5"
      : "border-muted-foreground/20"
  return (
    <div className={`rounded-lg border p-4 transition ${shellClass}`}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold">
            <span className={disabled ? "text-muted-foreground" : undefined}>{title}</span>
            {badge && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                {badge}
              </span>
            )}
          </p>
          <p className="text-xs text-muted-foreground">{desc}</p>
        </div>
        <Switch
          checked={disabled ? false : enabled}
          onCheckedChange={onToggle}
          disabled={disabled}
          aria-label={title}
        />
      </div>
      {note && <div className="mt-3">{note}</div>}
      {!disabled && enabled && children && <div className="mt-3 space-y-1.5">{children}</div>}
    </div>
  )
}
