"use client"

import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from "@/components/ui/use-toast"
import { Save } from "lucide-react"
import { Switch } from "@/components/ui/switch"

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
  isEDonusumEnabled?: boolean
  invoiceSeriesPrefix?: string
}

export default function FirmaAyarlariPage() {
  const searchParams = useSearchParams()
  const companyId = searchParams.get("company")
  const { toast } = useToast()
  const [company, setCompany] = useState<Company | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [formData, setFormData] = useState({
    name: "",
    taxNumber: "",
    taxOffice: "",
    address: "",
    city: "",
    phone: "",
    email: "",
    website: "",
    isEDonusumEnabled: false,
    invoiceSeriesPrefix: "",
  })

  useEffect(() => {
    if (companyId) {
      fetchCompany()
    }
  }, [companyId])

  const fetchCompany = async () => {
    if (!companyId) return
    try {
      const response = await fetch(`/api/companies/${companyId}`)
      if (response.ok) {
        const data = await response.json()
        setCompany(data)
        setFormData({
          name: data.name || "",
          taxNumber: data.taxNumber || "",
          taxOffice: data.taxOffice || "",
          address: data.address || "",
          city: data.city || "",
          phone: data.phone || "",
          email: data.email || "",
          website: data.website || "",
          isEDonusumEnabled: Boolean(data.isEDonusumEnabled),
          invoiceSeriesPrefix: data.invoiceSeriesPrefix || "",
        })
      }
    } catch (error) {
      console.error("Error fetching company:", error)
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

  if (!companyId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Firma Ayarları</CardTitle>
          <CardDescription>Firma seçiniz</CardDescription>
        </CardHeader>
      </Card>
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
          <CardTitle>Firma Bilgileri</CardTitle>
          <CardDescription>Firma bilgilerinizi görüntüleyin ve düzenleyin</CardDescription>
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
                  disabled={isLoading}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="taxNumber">Vergi No</Label>
                <Input
                  id="taxNumber"
                  value={formData.taxNumber}
                  onChange={(e) => setFormData({ ...formData, taxNumber: e.target.value })}
                  disabled={isLoading}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="taxOffice">Vergi Dairesi</Label>
                <Input
                  id="taxOffice"
                  value={formData.taxOffice}
                  onChange={(e) => setFormData({ ...formData, taxOffice: e.target.value })}
                  disabled={isLoading}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="city">Şehir</Label>
                <Input
                  id="city"
                  value={formData.city}
                  onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                  disabled={isLoading}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Telefon</Label>
                <Input
                  id="phone"
                  type="tel"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  disabled={isLoading}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  disabled={isLoading}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="website">Web Sitesi</Label>
                <Input
                  id="website"
                  type="url"
                  value={formData.website}
                  onChange={(e) => setFormData({ ...formData, website: e.target.value })}
                  disabled={isLoading}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="invoiceSeriesPrefix">Fatura Seri Prefix</Label>
                <Input
                  id="invoiceSeriesPrefix"
                  placeholder="SAT / ALI yerine kullanılacak ortak prefix"
                  value={formData.invoiceSeriesPrefix}
                  onChange={(e) => setFormData({ ...formData, invoiceSeriesPrefix: e.target.value.toUpperCase() })}
                  disabled={isLoading}
                />
              </div>
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <p className="text-sm font-medium">E-Dönüşüm Aktif</p>
                <p className="text-xs text-muted-foreground">E-fatura/e-arşiv gönderim özelliğini aktif eder</p>
              </div>
              <Switch
                checked={formData.isEDonusumEnabled}
                onCheckedChange={(checked) => setFormData({ ...formData, isEDonusumEnabled: checked })}
                disabled={isLoading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="address">Adres</Label>
              <Input
                id="address"
                value={formData.address}
                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                disabled={isLoading}
              />
            </div>
            <div className="flex justify-end">
              <Button type="submit" disabled={isLoading}>
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

