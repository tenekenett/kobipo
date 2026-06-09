"use client"

import { useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from "@/components/ui/use-toast"
import { Save } from "lucide-react"
import Link from "next/link"
import { getFirstAccessibleCompanyId } from "@/lib/company/client-selection"

interface Company {
  id: string
  name: string
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
}

export default function FirmaAyarlariPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const companyId = searchParams.get("company")
  const { toast } = useToast()
  const [company, setCompany] = useState<Company | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isResolvingCompany, setIsResolvingCompany] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [formData, setFormData] = useState({
    name: "",
    taxNumber: "",
    taxOffice: "",
    address: "",
    city: "",
    phone: "",
    email: "",
    website: "",
    invoiceSeriesPrefix: "",
    sector: "",
    businessModel: "",
    employeeRange: "",
    monthlyInvoiceVolume: "",
    primaryBusinessNeed: "",
    usesEDonusumBefore: "",
  })

  useEffect(() => {
    if (companyId) {
      setIsResolvingCompany(false)
      fetchCompany()
      return
    }

    let isMounted = true

    const resolveCompany = async () => {
      setIsResolvingCompany(true)
      try {
        const response = await fetch("/api/companies")
        if (!response.ok) {
          throw new Error("Failed to fetch companies")
        }

        const companies: Company[] = await response.json()
        if (!isMounted) return

        const firstCompanyId = getFirstAccessibleCompanyId(companies)
        if (firstCompanyId) {
          router.replace(`/ayarlar/firma?company=${firstCompanyId}`)
        } else {
          router.replace("/companies/new")
        }
      } catch (error) {
        console.error("Error resolving company:", error)
        if (isMounted) {
          router.replace("/dashboard")
        }
      } finally {
        if (isMounted) {
          setIsResolvingCompany(false)
        }
      }
    }

    resolveCompany()

    return () => {
      isMounted = false
    }
  }, [companyId, router])

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
          taxNumber: data.taxNumber || "",
          taxOffice: data.taxOffice || "",
          address: data.address || "",
          city: data.city || "",
          phone: data.phone || "",
          email: data.email || "",
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
        })
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
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="name">Firma Adı *</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                  disabled={isLoading || !isEditing}
                />
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
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  disabled={isLoading || !isEditing}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="website">Web Sitesi</Label>
                <Input
                  id="website"
                  type="url"
                  value={formData.website}
                  onChange={(e) => setFormData({ ...formData, website: e.target.value })}
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
              <Button type="submit" disabled={isLoading || !isEditing}>
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

