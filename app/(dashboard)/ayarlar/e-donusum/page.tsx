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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

type Integrator = "GIB_PORTAL" | "OZEL_ENTEGRATOR"

interface Company {
  id: string
  isEDonusumEnabled?: boolean
  eDonusumIntegrator?: Integrator
  eDonusumProvider?: string
  eDonusumApiUsername?: string
  eDonusumApiPassword?: string
  eDonusumAlias?: string
  eDonusumApiUrl?: string
}

export default function EDonusumAyarlariPage() {
  const searchParams = useSearchParams()
  const companyId = searchParams.get("company")
  const { toast } = useToast()
  const [isLoading, setIsLoading] = useState(false)
  const [formData, setFormData] = useState({
    isEDonusumEnabled: false,
    eDonusumIntegrator: "GIB_PORTAL" as Integrator,
    eDonusumProvider: "",
    eDonusumApiUsername: "",
    eDonusumApiPassword: "",
    eDonusumAlias: "",
    eDonusumApiUrl: "",
  })

  useEffect(() => {
    if (!companyId) return
    fetchCompany()
  }, [companyId])

  const fetchCompany = async () => {
    if (!companyId) return
    const response = await fetch(`/api/companies/${companyId}`)
    if (!response.ok) return
    const data = (await response.json()) as Company
    setFormData({
      isEDonusumEnabled: Boolean(data.isEDonusumEnabled),
      eDonusumIntegrator: data.eDonusumIntegrator || "GIB_PORTAL",
      eDonusumProvider: data.eDonusumProvider || "",
      eDonusumApiUsername: data.eDonusumApiUsername || "",
      eDonusumApiPassword: data.eDonusumApiPassword || "",
      eDonusumAlias: data.eDonusumAlias || "",
      eDonusumApiUrl: data.eDonusumApiUrl || "",
    })
  }

  const save = async () => {
    if (!companyId) return
    setIsLoading(true)
    try {
      const response = await fetch(`/api/companies/${companyId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
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
    await new Promise((resolve) => setTimeout(resolve, 500))
    toast({
      title: "Bağlantı Testi",
      description: "Mock sağlayıcı aktif: bağlantı doğrulaması başarılı.",
    })
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

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>E-Dönüşüm Ayarları</CardTitle>
          <CardDescription>E-fatura ve e-arşiv entegrasyon bilgilerini yönetin</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <p className="text-sm font-medium">E-Dönüşüm Aktif</p>
              <p className="text-xs text-muted-foreground">E-fatura/e-arşiv gönderimini aktif eder</p>
            </div>
            <Switch
              checked={formData.isEDonusumEnabled}
              onCheckedChange={(checked) => setFormData((prev) => ({ ...prev, isEDonusumEnabled: checked }))}
              disabled={isLoading}
            />
          </div>

          <div className="space-y-2">
            <Label>Entegratör Tipi</Label>
            <Select
              value={formData.eDonusumIntegrator}
              onValueChange={(value: Integrator) => setFormData((prev) => ({ ...prev, eDonusumIntegrator: value }))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="GIB_PORTAL">GİB Portal</SelectItem>
                <SelectItem value="OZEL_ENTEGRATOR">Özel Entegratör</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Sağlayıcı</Label>
              <Input
                value={formData.eDonusumProvider}
                onChange={(event) => setFormData((prev) => ({ ...prev, eDonusumProvider: event.target.value }))}
                placeholder="Logo, Uyumsoft vb."
                disabled={isLoading}
              />
            </div>
            <div className="space-y-2">
              <Label>Alias</Label>
              <Input
                value={formData.eDonusumAlias}
                onChange={(event) => setFormData((prev) => ({ ...prev, eDonusumAlias: event.target.value }))}
                placeholder="urn:mail:..."
                disabled={isLoading}
              />
            </div>
            <div className="space-y-2">
              <Label>API Kullanıcı Adı</Label>
              <Input
                value={formData.eDonusumApiUsername}
                onChange={(event) => setFormData((prev) => ({ ...prev, eDonusumApiUsername: event.target.value }))}
                disabled={isLoading}
              />
            </div>
            <div className="space-y-2">
              <Label>API Şifre</Label>
              <Input
                type="password"
                value={formData.eDonusumApiPassword}
                onChange={(event) => setFormData((prev) => ({ ...prev, eDonusumApiPassword: event.target.value }))}
                placeholder="Kaydedilmişse *** olarak görünür"
                disabled={isLoading}
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>API URL</Label>
              <Input
                value={formData.eDonusumApiUrl}
                onChange={(event) => setFormData((prev) => ({ ...prev, eDonusumApiUrl: event.target.value }))}
                placeholder="https://..."
                disabled={isLoading}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={testConnection} disabled={isLoading}>
              Test Bağlantısı
            </Button>
            <Button onClick={save} disabled={isLoading}>
              <Save className="mr-2 h-4 w-4" />
              {isLoading ? "Kaydediliyor..." : "Kaydet"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
