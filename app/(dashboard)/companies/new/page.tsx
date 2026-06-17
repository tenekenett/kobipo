"use client"

import { useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { CityCombobox } from "@/components/ui/city-combobox"
import { useToast } from "@/components/ui/use-toast"

export default function NewCompanyPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  // Şube Yönetimi'nden "Yeni Şube" ile gelindiğinde mode=branch olur. Bu durumda
  // bu, kullanıcının ilk firması değil ek bir şube; profil/onboarding sihirbazını
  // çalıştırmadan oluşturup şube listesine döneriz.
  const isBranch = searchParams.get("mode") === "branch"
  const { toast } = useToast()
  const [formData, setFormData] = useState({
    name: "",
    taxNumber: "",
    taxOffice: "",
    address: "",
    city: "",
    phone: "",
    email: "",
  })
  const [isLoading, setIsLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)

    try {
      const response = await fetch("/api/companies", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(formData),
      })

      let data: { id?: string; error?: string; code?: string } = {}
      try {
        data = await response.json()
      } catch {
        data = {}
      }

      if (!response.ok) {
        if (data.code === "PLAN_LIMIT_EXCEEDED") {
          throw new Error("Bu paketle yeni şirket ekleyemezsiniz. Lütfen paketinizi yükseltin.")
        }
        if (data.code === "COMPANY_TAX_NUMBER_CONFLICT") {
          throw new Error("Bu vergi numarası ile kayıtlı bir firma zaten var.")
        }
        if (data.code === "DB_SCHEMA_MISMATCH") {
          throw new Error("Sistem güncellemesi gerekiyor. Lütfen biraz sonra tekrar deneyin.")
        }
        throw new Error(data.error || "Firma oluşturulamadı")
      }

      toast({
        title: isBranch ? "Şube eklendi" : "Başarılı",
        description: isBranch ? "Yeni şube başarıyla eklendi" : "Firma başarıyla oluşturuldu",
      })

      // Şube: onboarding sihirbazını atla, yeni şube aktif olacak şekilde Şube
      // Yönetimi'ne dön. Yeni firma (ilk kurulum): profil sihirbazına git.
      if (isBranch) {
        router.push(`/ayarlar/subeler?company=${data.id}`)
      } else {
        router.push(`/companies/onboarding?company=${data.id}`)
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

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <CardTitle>{isBranch ? "Yeni Şube Ekle" : "Yeni Firma Oluştur"}</CardTitle>
          <CardDescription>
            {isBranch
              ? "Yeni şubenin bilgilerini doldurun. Şube, erişiminizdeki firma/şube listesine eklenir."
              : "İlk firmanızı oluşturmak için bilgileri doldurun"}
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4">
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
                <CityCombobox
                  id="city"
                  value={formData.city}
                  onChange={(v) => setFormData({ ...formData, city: v })}
                  disabled={isLoading}
                  placeholder="Şehir yazın, listeden seçin…"
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
          </CardContent>
          <CardFooter>
            <Button type="submit" className="w-full" disabled={isLoading}>
              {isBranch
                ? isLoading
                  ? "Ekleniyor..."
                  : "Şube Ekle"
                : isLoading
                  ? "Oluşturuluyor..."
                  : "Firma Oluştur"}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  )
}

