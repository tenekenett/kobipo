"use client"

import { useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/use-toast"

type OnboardingFormState = {
  sector: string
  businessModel: string
  employeeRange: string
  monthlyInvoiceVolume: string
  primaryBusinessNeed: string
  usesEDonusumBefore: string
}

const defaultFormState: OnboardingFormState = {
  sector: "",
  businessModel: "",
  employeeRange: "",
  monthlyInvoiceVolume: "",
  primaryBusinessNeed: "",
  usesEDonusumBefore: "",
}

export default function CompanyOnboardingPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { toast } = useToast()
  const companyId = searchParams.get("company")

  const [formData, setFormData] = useState<OnboardingFormState>(defaultFormState)
  const [isLoading, setIsLoading] = useState(false)
  const [isInitialLoading, setIsInitialLoading] = useState(true)

  useEffect(() => {
    if (!companyId) {
      router.replace("/dashboard")
      return
    }

    const fetchCompany = async () => {
      try {
        const response = await fetch(`/api/companies/${companyId}`)
        if (!response.ok) {
          throw new Error("Firma bilgileri alınamadı")
        }

        const company = await response.json()
        setFormData({
          sector: company.sector || "",
          businessModel: company.businessModel || "",
          employeeRange: company.employeeRange || "",
          monthlyInvoiceVolume: company.monthlyInvoiceVolume || "",
          primaryBusinessNeed: company.primaryBusinessNeed || "",
          usesEDonusumBefore:
            typeof company.usesEDonusumBefore === "boolean"
              ? String(company.usesEDonusumBefore)
              : "",
        })
      } catch (error) {
        toast({
          title: "Hata",
          description: "Onboarding bilgileri yüklenemedi",
          variant: "destructive",
        })
      } finally {
        setIsInitialLoading(false)
      }
    }

    fetchCompany()
  }, [companyId, router, toast])

  const updateField = (field: keyof OnboardingFormState, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!companyId) return

    setIsLoading(true)
    try {
      const response = await fetch(`/api/companies/${companyId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sector: formData.sector || null,
          businessModel: formData.businessModel || null,
          employeeRange: formData.employeeRange || null,
          monthlyInvoiceVolume: formData.monthlyInvoiceVolume || null,
          primaryBusinessNeed: formData.primaryBusinessNeed || null,
          usesEDonusumBefore:
            formData.usesEDonusumBefore === ""
              ? null
              : formData.usesEDonusumBefore === "true",
          onboardingCompletedAt: new Date().toISOString(),
        }),
      })

      if (!response.ok) {
        const payload = await response.json()
        throw new Error(payload.error || "Onboarding kaydedilemedi")
      }

      router.push(`/companies/onboarding/complete?company=${companyId}`)
    } catch (error: any) {
      toast({
        title: "Hata",
        description: error.message || "Onboarding kaydı sırasında bir hata oluştu",
        variant: "destructive",
      })
    } finally {
      setIsLoading(false)
    }
  }

  if (!companyId || isInitialLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-muted-foreground">Yükleniyor...</p>
      </div>
    )
  }

  return (
    <div className="flex min-h-[70vh] items-center justify-center p-4">
      <Card className="w-full max-w-3xl">
        <CardHeader>
          <CardTitle>Firmanızı daha yakından tanıyalım</CardTitle>
          <CardDescription>
            Size daha iyi bir başlangıç deneyimi sunmak için sektörel ve iş modeli bilgilerinizi
            doldurun.
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="sector">Sektör</Label>
                <Input
                  id="sector"
                  value={formData.sector}
                  onChange={(event) => updateField("sector", event.target.value)}
                  placeholder="Örn: Perakende, Üretim, Hizmet"
                  disabled={isLoading}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="businessModel">İş modeli</Label>
                <Input
                  id="businessModel"
                  value={formData.businessModel}
                  onChange={(event) => updateField("businessModel", event.target.value)}
                  placeholder="B2B, B2C, Toptan, Proje bazlı"
                  disabled={isLoading}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="employeeRange">Çalışan sayısı aralığı</Label>
                <Input
                  id="employeeRange"
                  value={formData.employeeRange}
                  onChange={(event) => updateField("employeeRange", event.target.value)}
                  placeholder="1-5, 6-20, 21-50, 50+"
                  disabled={isLoading}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="monthlyInvoiceVolume">Aylık fatura adedi</Label>
                <Input
                  id="monthlyInvoiceVolume"
                  value={formData.monthlyInvoiceVolume}
                  onChange={(event) => updateField("monthlyInvoiceVolume", event.target.value)}
                  placeholder="0-25, 26-100, 101-500, 500+"
                  disabled={isLoading}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="primaryBusinessNeed">Öncelikli ihtiyacınız nedir?</Label>
              <Input
                id="primaryBusinessNeed"
                value={formData.primaryBusinessNeed}
                onChange={(event) => updateField("primaryBusinessNeed", event.target.value)}
                placeholder="Nakit akışı takibi, e-dönüşüm, stok yönetimi vb."
                disabled={isLoading}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="usesEDonusumBefore">Daha önce e-dönüşüm kullandınız mı?</Label>
              <select
                id="usesEDonusumBefore"
                value={formData.usesEDonusumBefore}
                onChange={(event) => updateField("usesEDonusumBefore", event.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                disabled={isLoading}
              >
                <option value="">Seçiniz</option>
                <option value="true">Evet</option>
                <option value="false">Hayır</option>
              </select>
            </div>
          </CardContent>
          <CardFooter className="justify-end">
            <Button type="submit" disabled={isLoading}>
              {isLoading ? "Kaydediliyor..." : "Kaydet ve Devam Et"}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  )
}
