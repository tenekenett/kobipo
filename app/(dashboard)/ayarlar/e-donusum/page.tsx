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
  Globe,
  KeyRound,
  Loader2,
  Save,
  ShieldCheck,
  XCircle,
  Zap,
} from "lucide-react"
import { Switch } from "@/components/ui/switch"
import { MYSOFT_PROD_URL, MYSOFT_TEST_URL } from "@/lib/integrations/e-invoice/constants"
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

const PROVIDER_KEY = "mysoft"
const PROVIDER_LABEL = "Mysoft"

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
    setEnvironment((data.eDonusumApiUrl || "").trim() === MYSOFT_PROD_URL ? "live" : "test")
    setLastTestedAt(data.eDonusumLastTestedAt || null)
    setLastTestSuccess(typeof data.eDonusumLastTestSuccess === "boolean" ? data.eDonusumLastTestSuccess : null)
    // Mükellef VKN: eski kayıtlı değer varsa o, yoksa firmanın kendi VKN'si.
    const companyVkn = (data.eDonusumTenantVkn || data.taxNumber || "").replace(/\D/g, "")
    setTenantVkn(companyVkn)
    setFormData({
      isEDonusumEnabled: Boolean(data.isEDonusumEnabled),
      eDonusumApiUsername: data.eDonusumApiUsername || "",
      eDonusumApiPassword: passwordIsPlaceholder ? "" : (data.eDonusumApiPassword || ""),
      eDonusumAlias: data.eDonusumAlias || "",
    })
  }

  // Ayarları (özellikle seçili ortam = eDonusumApiUrl) DB'ye yazar. Hem "Kaydet"
  // hem de Doğrula/Otomatik Bul öncesi çağrılır — böylece kullanıcı ortamı seçip
  // kaydetmeyi unutsa bile keşif/doğrulama doğru ortama (test/canlı) gider.
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
          apiUrl: environment === "live" ? MYSOFT_PROD_URL : MYSOFT_TEST_URL,
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

      {/* Mysoft Mükellef VKN — firmanın VKN'sinden otomatik (ayrı doğrulama yok) */}
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

    </div>
  )
}
