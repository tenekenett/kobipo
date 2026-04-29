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
        body: JSON.stringify(formData),
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
                <Label htmlFor="invoiceSeriesPrefix">Fatura Seri Prefix</Label>
                <Input
                  id="invoiceSeriesPrefix"
                  placeholder="SAT / ALI yerine kullanılacak ortak prefix"
                  value={formData.invoiceSeriesPrefix}
                  onChange={(e) => setFormData({ ...formData, invoiceSeriesPrefix: e.target.value.toUpperCase() })}
                  disabled={isLoading || !isEditing}
                />
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

