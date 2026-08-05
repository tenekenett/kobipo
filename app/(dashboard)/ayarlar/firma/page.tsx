"use client"

import { useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from "@/components/ui/use-toast"
import { AlertTriangle, CheckCircle2, Loader2, Mailbox, RefreshCw, Save } from "lucide-react"
import Link from "next/link"
import { getFirstAccessibleCompanyId } from "@/lib/company/client-selection"
import { useDashboardCompany } from "@/components/dashboard/dashboard-company-provider"

interface Company {
  id: string
  name: string
  branchName?: string | null
  taxNumber?: string
  taxOffice?: string
  address?: string
  city?: string
  phone?: string
  email?: string
  website?: string
  invoiceSeriesPrefix?: string
  eFaturaPrefix?: string | null
  eArchivePrefix?: string | null
  sector?: string | null
  businessModel?: string | null
  employeeRange?: string | null
  monthlyInvoiceVolume?: string | null
  primaryBusinessNeed?: string | null
  usesEDonusumBefore?: boolean | null
  eDonusumAlias?: string | null
}

export default function FirmaAyarlariPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const companyId = searchParams.get("company")
  const {
    selectedCompany,
    companies: accessibleCompanies,
    isLoading: isLoadingCompanies,
  } = useDashboardCompany()
  const { toast } = useToast()
  const [company, setCompany] = useState<Company | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isResolvingCompany, setIsResolvingCompany] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [formData, setFormData] = useState({
    name: "",
    branchName: "",
    taxNumber: "",
    taxOffice: "",
    address: "",
    city: "",
    phone: "",
    website: "",
    invoiceSeriesPrefix: "",
    sector: "",
    businessModel: "",
    employeeRange: "",
    monthlyInvoiceVolume: "",
    primaryBusinessNeed: "",
    usesEDonusumBefore: "",
    eDonusumAlias: "",
  })

  // Firmanın kendi VKN'sine kayıtlı GİB fatura posta kutusu adresleri (aliases).
  // Cari eklerken kullanılan aynı check-vkn altyapısından beslenir.
  const [postaKutulari, setPostaKutulari] = useState<string[]>([])
  const [isFetchingPk, setIsFetchingPk] = useState(false)
  const [pkFetched, setPkFetched] = useState(false)
  const [pkError, setPkError] = useState<string | null>(null)

  useEffect(() => {
    if (companyId) {
      setIsResolvingCompany(false)
      fetchCompany()
      return
    }

    // Param yoksa SEÇİMİ PROVIDER ÇÖZER (URL → localStorage → cookie) ve `?company=`
    // olarak adres çubuğuna yazar. Burada eskiden /api/companies çekilip KOŞULSUZ
    // ilk firmaya `router.replace` ediliyordu: header'daki "Firma Ayarları" linki
    // param taşımadığı için şubedeki kullanıcı ana firmanın ayarlarına düşüyor,
    // üstelik provider ile yarışıyordu. Artık yalnızca provider'ın da bir seçim
    // üretemediği durumda (hiç firma yok) kuruluma yönlendiriyoruz.
    setIsResolvingCompany(true)
    if (isLoadingCompanies) return

    const selected = selectedCompany?.slug ?? selectedCompany?.id
    const fallback = selected ?? getFirstAccessibleCompanyId(accessibleCompanies)
    router.replace(
      fallback ? `/ayarlar/firma?company=${encodeURIComponent(fallback)}` : "/companies/new"
    )
  }, [companyId, isLoadingCompanies, selectedCompany, accessibleCompanies, router])

  const fetchCompany = async () => {
    if (!companyId) return
    try {
      const response = await fetch(`/api/companies/${companyId}`)
      if (response.ok) {
        const data = await response.json()
        setCompany(data)
        setIsEditing(false)
        setFormData({
          name: data.name || "",
          branchName: data.branchName || "",
          taxNumber: data.taxNumber || "",
          taxOffice: data.taxOffice || "",
          address: data.address || "",
          city: data.city || "",
          phone: data.phone || "",
          website: data.website || "",
          invoiceSeriesPrefix: data.invoiceSeriesPrefix || "",
          sector: data.sector || "",
          businessModel: data.businessModel || "",
          employeeRange: data.employeeRange || "",
          monthlyInvoiceVolume: data.monthlyInvoiceVolume || "",
          primaryBusinessNeed: data.primaryBusinessNeed || "",
          usesEDonusumBefore:
            typeof data.usesEDonusumBefore === "boolean"
              ? String(data.usesEDonusumBefore)
              : "",
          eDonusumAlias: data.eDonusumAlias || "",
        })
        // VKN geçerliyse firmanın kendi posta kutularını Mysoft'tan otomatik getir.
        const vkn = (data.taxNumber || "").replace(/\D/g, "")
        if (/^\d{10,11}$/.test(vkn)) {
          fetchPostaKutulari(vkn)
        } else {
          setPostaKutulari([])
          setPkFetched(false)
          setPkError(null)
        }
      } else if (response.status === 403 || response.status === 404) {
        // Stale or unauthorized company id in URL/localStorage; recover to first valid company.
        const companiesResponse = await fetch("/api/companies")
        if (!companiesResponse.ok) {
          throw new Error("Firma erişimi doğrulanamadı")
        }
        const companies: Company[] = await companiesResponse.json()
        const firstCompanyId = getFirstAccessibleCompanyId(companies)
        if (firstCompanyId) {
          router.replace(`/ayarlar/firma?company=${firstCompanyId}`)
          return
        }
        router.replace("/companies/new")
        return
      } else {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || "Firma bilgisi alınamadı")
      }
    } catch (error) {
      console.error("Error fetching company:", error)
      toast({
        title: "Hata",
        description: "Firma bilgisi yüklenemedi",
        variant: "destructive",
      })
    }
  }

  // Firmanın kendi VKN'sine kayıtlı GİB fatura posta kutusu (alias) adreslerini
  // check-vkn ucundan çeker — cari eklerkenki VKN sorgusuyla aynı altyapı.
  const fetchPostaKutulari = async (vkn: string) => {
    if (!companyId || !/^\d{10,11}$/.test(vkn)) return
    setIsFetchingPk(true)
    setPkError(null)
    try {
      const res = await fetch(`/api/e-donusum/check-vkn?companyId=${companyId}&vkn=${vkn}`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || "Posta kutusu adresleri getirilemedi")
      setPostaKutulari(Array.isArray(data.aliases) ? data.aliases : [])
      setPkFetched(true)
    } catch (error) {
      setPostaKutulari([])
      setPkFetched(true)
      setPkError(error instanceof Error ? error.message : "Posta kutusu adresleri getirilemedi")
    } finally {
      setIsFetchingPk(false)
    }
  }

  // GİB alias'ları urn:mail: önekiyle beklenir; çıplak adresi öneke tamamlarız.
  const aliasFromAdres = (adres: string) =>
    /^urn:/i.test(adres.trim()) ? adres.trim() : `urn:mail:${adres.trim()}`

  // Seçilen posta kutusunu forma yazar; kalıcı olması için Kaydet gerekir.
  const selectPostaKutusu = (adres: string) => {
    setFormData((prev) => ({ ...prev, eDonusumAlias: aliasFromAdres(adres) }))
  }

  // Kullanıcı "ornek.com" yazarsa başına https:// ekleriz — böylece geçerli bir URL
  // olur ve kaydederken şema zorunluluğu takılmaz. Boşsa boş bırakılır.
  const normalizeWebsite = (value: string) => {
    const trimmed = value.trim()
    if (!trimmed) return ""
    return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!companyId) return

    setIsLoading(true)
    try {
      const response = await fetch(`/api/companies/${companyId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...formData,
          website: normalizeWebsite(formData.website),
          usesEDonusumBefore:
            formData.usesEDonusumBefore === ""
              ? null
              : formData.usesEDonusumBefore === "true",
        }),
      })

      if (response.ok) {
        toast({
          title: "Başarılı",
          description: "Firma bilgileri güncellendi",
        })
        setIsEditing(false)
        fetchCompany()
      } else {
        const data = await response.json()
        throw new Error(data.error || "Güncellenemedi")
      }
    } catch (error: any) {
      toast({
        title: "Hata",
        description: error.message || "Bir hata oluştu",
        variant: "destructive",
      })
    } finally {
      setIsLoading(false)
    }
  }

  if (!companyId || isResolvingCompany) {
    return (
      <div className="flex items-center justify-center p-8">
        <p className="text-muted-foreground">Yönlendiriliyor...</p>
      </div>
    )
  }

  if (!company) {
    return (
      <div className="flex items-center justify-center p-8">
        <p className="text-muted-foreground">Yükleniyor...</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <div>
              <CardTitle>Firma Bilgileri</CardTitle>
              <CardDescription>Firma bilgilerinizi görüntüleyin ve düzenleyin</CardDescription>
            </div>
            {!isEditing && (
              <Button type="button" variant="outline" onClick={() => setIsEditing(true)}>
                Düzenleme Yap
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            {isEditing && (
              <div className="flex justify-end">
                <Button type="submit" variant="success" disabled={isLoading}>
                  <Save className="mr-2 h-4 w-4" />
                  {isLoading ? "Kaydediliyor..." : "Kaydet"}
                </Button>
              </div>
            )}
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="name">Firma Ünvanı *</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                  disabled={isLoading || !isEditing}
                />
                <p className="text-xs text-muted-foreground">
                  Faturada ve e-belgelerde basılan resmi ünvan.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="branchName">Şube İsmi</Label>
                <Input
                  id="branchName"
                  placeholder="Örn. Kadıköy"
                  value={formData.branchName}
                  onChange={(e) => setFormData({ ...formData, branchName: e.target.value })}
                  disabled={isLoading || !isEditing}
                />
                <p className="text-xs text-muted-foreground">
                  Şubelerin ünvanı aynı olduğu için firma seçicide ünvanın yanında parantez
                  içinde gösterilir (ör. <span className="font-medium">{formData.name || "Ünvan"}
                  {formData.branchName ? ` (${formData.branchName})` : " (Kadıköy)"}</span>).
                  Belgelere yazılmaz.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="taxNumber">Vergi No</Label>
                <Input
                  id="taxNumber"
                  value={formData.taxNumber}
                  onChange={(e) => setFormData({ ...formData, taxNumber: e.target.value })}
                  disabled={isLoading || !isEditing}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="taxOffice">Vergi Dairesi</Label>
                <Input
                  id="taxOffice"
                  value={formData.taxOffice}
                  onChange={(e) => setFormData({ ...formData, taxOffice: e.target.value })}
                  disabled={isLoading || !isEditing}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="city">Şehir</Label>
                <Input
                  id="city"
                  value={formData.city}
                  onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                  disabled={isLoading || !isEditing}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Telefon</Label>
                <Input
                  id="phone"
                  type="tel"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  disabled={isLoading || !isEditing}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="website">Web Sitesi</Label>
                <Input
                  id="website"
                  type="text"
                  inputMode="url"
                  placeholder="ornek.com"
                  value={formData.website}
                  onChange={(e) => setFormData({ ...formData, website: e.target.value })}
                  onBlur={(e) => setFormData({ ...formData, website: normalizeWebsite(e.target.value) })}
                  disabled={isLoading || !isEditing}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="invoiceSeriesPrefix">Fatura Seri Prefix (Kobipo iç)</Label>
                <Input
                  id="invoiceSeriesPrefix"
                  placeholder="SAT / ALI yerine kullanılacak ortak prefix"
                  value={formData.invoiceSeriesPrefix}
                  onChange={(e) => setFormData({ ...formData, invoiceSeriesPrefix: e.target.value.toUpperCase() })}
                  disabled={isLoading || !isEditing}
                />
                <p className="text-xs text-muted-foreground">
                  Bu alan Kobipo iç fatura numarası içindir (ör. <code className="rounded bg-muted px-1 py-0.5 font-mono">SAT-2026-0001</code>).
                  E-Fatura / E-Arşiv için Mysoft'a gönderilen prefix bundan farklıdır — aşağıdaki kartı kullanın.
                </p>
              </div>
            </div>
            <div className="rounded-md border p-3 space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-2">
                  <Mailbox className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">Fatura Posta Kutusu Adresleri</p>
                    <p className="text-xs text-muted-foreground">
                      Firmanızın VKN'sine kayıtlı GİB e-Fatura posta kutuları — Mysoft üzerinden getirilir.
                      Firma e-posta adresi yerine bu kutular kullanılır. Varsayılan kutuyu seçmek için{" "}
                      <span className="font-medium text-foreground">Düzenleme Yap</span>'a basıp{" "}
                      <span className="font-medium text-foreground">Seç</span>in ve kaydedin.
                    </p>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fetchPostaKutulari(formData.taxNumber.replace(/\D/g, ""))}
                  disabled={isFetchingPk || !/^\d{10,11}$/.test(formData.taxNumber.replace(/\D/g, ""))}
                >
                  {isFetchingPk ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                  <span className="ml-2">Yenile</span>
                </Button>
              </div>
              {isFetchingPk ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Posta kutuları getiriliyor…
                </div>
              ) : pkError ? (
                <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <p>{pkError}</p>
                </div>
              ) : postaKutulari.length > 0 ? (
                <ul className="space-y-2">
                  {postaKutulari.map((adres) => {
                    const selected =
                      !!formData.eDonusumAlias.trim() &&
                      aliasFromAdres(formData.eDonusumAlias) === aliasFromAdres(adres)
                    return (
                      <li
                        key={adres}
                        className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm"
                      >
                        <Mailbox className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 break-all font-mono">{adres}</span>
                        {selected ? (
                          <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            Seçili
                          </span>
                        ) : (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="shrink-0"
                            onClick={() => selectPostaKutusu(adres)}
                            disabled={isLoading || !isEditing}
                          >
                            Seç
                          </Button>
                        )}
                      </li>
                    )
                  })}
                </ul>
              ) : pkFetched ? (
                <p className="text-xs text-muted-foreground">
                  Bu VKN için GİB'de kayıtlı bir posta kutusu bulunamadı. Firma e-Fatura mükellefi
                  değilse bu normaldir.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Geçerli bir Vergi No kayıtlıysa posta kutusu adresleri otomatik listelenir.
                </p>
              )}
            </div>
            <div className="rounded-md border p-3 space-y-3">
              <div>
                <p className="text-sm font-medium">İş Profili</p>
                <p className="text-xs text-muted-foreground">
                  Sektör, ölçek ve ihtiyaçlarınız. Kayıt sürecinde toplanan bu bilgileri buradan
                  güncelleyebilirsiniz.
                </p>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="sector">Sektör</Label>
                  <Input
                    id="sector"
                    placeholder="Örn: Perakende, Üretim, Hizmet"
                    value={formData.sector}
                    onChange={(e) => setFormData({ ...formData, sector: e.target.value })}
                    disabled={isLoading || !isEditing}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="businessModel">İş Modeli</Label>
                  <Input
                    id="businessModel"
                    placeholder="B2B, B2C, Toptan, Proje bazlı"
                    value={formData.businessModel}
                    onChange={(e) => setFormData({ ...formData, businessModel: e.target.value })}
                    disabled={isLoading || !isEditing}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="employeeRange">Çalışan Aralığı</Label>
                  <Input
                    id="employeeRange"
                    placeholder="1-5, 6-20, 21-50, 50+"
                    value={formData.employeeRange}
                    onChange={(e) => setFormData({ ...formData, employeeRange: e.target.value })}
                    disabled={isLoading || !isEditing}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="monthlyInvoiceVolume">Aylık Fatura Hacmi</Label>
                  <Input
                    id="monthlyInvoiceVolume"
                    placeholder="0-25, 26-100, 101-500, 500+"
                    value={formData.monthlyInvoiceVolume}
                    onChange={(e) =>
                      setFormData({ ...formData, monthlyInvoiceVolume: e.target.value })
                    }
                    disabled={isLoading || !isEditing}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="primaryBusinessNeed">Birincil İhtiyaç</Label>
                <Input
                  id="primaryBusinessNeed"
                  placeholder="Nakit akışı takibi, e-dönüşüm, stok yönetimi vb."
                  value={formData.primaryBusinessNeed}
                  onChange={(e) =>
                    setFormData({ ...formData, primaryBusinessNeed: e.target.value })
                  }
                  disabled={isLoading || !isEditing}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="usesEDonusumBefore">Daha Önce E-Dönüşüm Kullanımı</Label>
                <select
                  id="usesEDonusumBefore"
                  value={formData.usesEDonusumBefore}
                  onChange={(e) =>
                    setFormData({ ...formData, usesEDonusumBefore: e.target.value })
                  }
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={isLoading || !isEditing}
                >
                  <option value="">Seçiniz</option>
                  <option value="true">Evet</option>
                  <option value="false">Hayır</option>
                </select>
              </div>
            </div>
            <div className="rounded-md border p-3">
              <p className="text-sm font-medium">E-Dönüşüm Ayarları</p>
              <p className="text-xs text-muted-foreground">
                E-Dönüşüm aktivasyonu ve entegratör bilgileri artık ayrı sayfada yönetilir.
              </p>
              <Link href={`/ayarlar/e-donusum?company=${companyId}`} className="mt-2 inline-block text-sm text-blue-600 hover:underline">
                Ayarlar {'>'} E-Dönüşüm sayfasına git
              </Link>
            </div>
            <div className="rounded-md border p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">E-Fatura / E-Arşiv Prefix'leri (Mysoft)</p>
                  <p className="text-xs text-muted-foreground">
                    Mysoft tarafında tanımlı numaratörler. Boş bırakılırsa Kobipo fatura kesim
                    anında Mysoft'tan aktif default numaratörü otomatik kullanır.
                  </p>
                </div>
                <Link
                  href={`/e-donusum/seri-no?company=${companyId}`}
                  className="text-sm text-blue-600 hover:underline"
                >
                  Seri No Tanımları'na git →
                </Link>
              </div>
              <div className="mt-3 flex flex-wrap gap-4">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    E-Fatura
                  </p>
                  {company?.eFaturaPrefix ? (
                    <span className="mt-1 inline-flex h-7 items-center rounded-md bg-muted px-2 font-mono text-sm font-bold tracking-widest">
                      {company.eFaturaPrefix}
                    </span>
                  ) : (
                    <span className="mt-1 inline-flex h-7 items-center rounded-md border border-dashed px-2 text-xs text-muted-foreground">
                      Otomatik (Mysoft default)
                    </span>
                  )}
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    E-Arşiv
                  </p>
                  {company?.eArchivePrefix ? (
                    <span className="mt-1 inline-flex h-7 items-center rounded-md bg-muted px-2 font-mono text-sm font-bold tracking-widest">
                      {company.eArchivePrefix}
                    </span>
                  ) : (
                    <span className="mt-1 inline-flex h-7 items-center rounded-md border border-dashed px-2 text-xs text-muted-foreground">
                      Otomatik (Mysoft default)
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="address">Adres</Label>
              <Input
                id="address"
                value={formData.address}
                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                disabled={isLoading || !isEditing}
              />
            </div>
            <div className="flex justify-end gap-2">
              {isEditing && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={fetchCompany}
                  disabled={isLoading}
                >
                  Vazgeç
                </Button>
              )}
              <Button type="submit" variant="success" disabled={isLoading || !isEditing}>
                <Save className="mr-2 h-4 w-4" />
                {isLoading ? "Kaydediliyor..." : "Kaydet"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

