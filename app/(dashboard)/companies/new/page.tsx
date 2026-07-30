"use client"

import { useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { CityCombobox } from "@/components/ui/city-combobox"
import { useToast } from "@/components/ui/use-toast"
import { Info } from "lucide-react"

interface ParentCompany {
  id: string
  name: string
  taxNumber?: string | null
  taxOffice?: string | null
  isEDonusumEnabled?: boolean
}

export default function NewCompanyPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  // Şube Yönetimi'nden "Yeni Şube" ile gelindiğinde mode=branch olur. Bu durumda
  // bu, kullanıcının ilk firması değil ana firmaya bağlı bir şubedir (mağaza gibi):
  // VKN/vergi dairesi/e-Dönüşüm ana firmadan devralınır, profil sihirbazı atlanır.
  const isBranch = searchParams.get("mode") === "branch"
  // Şubenin bağlanacağı ana firma: ?parent= (yoksa aktif firma ?company=).
  const parentCompanyId = searchParams.get("parent") || searchParams.get("company")
  const { toast } = useToast()
  const [parent, setParent] = useState<ParentCompany | null>(null)
  const [formData, setFormData] = useState({
    name: "",
    taxNumber: "",
    taxOffice: "",
    address: "",
    city: "",
    phone: "",
  })
  const [isLoading, setIsLoading] = useState(false)

  // Şube modunda ana firmanın kimlik bilgilerini çek (VKN/vergi dairesi salt-okunur gösterilir).
  useEffect(() => {
    if (!isBranch || !parentCompanyId) return
    let cancelled = false
    fetch(`/api/companies/${parentCompanyId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: ParentCompany | null) => {
        if (cancelled || !data) return
        setParent(data)
        setFormData((prev) => ({
          ...prev,
          taxNumber: data.taxNumber || "",
          taxOffice: data.taxOffice || "",
        }))
      })
    return () => {
      cancelled = true
    }
  }, [isBranch, parentCompanyId])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (isBranch && !parentCompanyId) {
      toast({
        title: "Ana firma seçili değil",
        description: "Şube eklemek için önce bir firma seçin.",
        variant: "destructive",
      })
      return
    }

    // İlk firma kaydında VKN/TCKN zorunlu — e-Dönüşüm ve GİB posta kutusu sorguları
    // bu numaraya dayanır. Şubede VKN ana firmadan devralındığı için kontrol yapılmaz.
    if (!isBranch) {
      const vkn = formData.taxNumber.replace(/\D/g, "")
      if (vkn.length !== 10 && vkn.length !== 11) {
        toast({
          title: "Vergi No zorunlu",
          description: "Firma oluşturmak için 10 haneli VKN veya 11 haneli TCKN girin.",
          variant: "destructive",
        })
        return
      }
    }

    setIsLoading(true)

    try {
      // Şubede VKN/vergi dairesi/e-Dönüşüm sunucu tarafında ana firmadan devralınır;
      // yalnızca ad/adres/iletişim + parentCompanyId gönderilir.
      const payload = isBranch
        ? {
            name: formData.name,
            address: formData.address,
            city: formData.city,
            phone: formData.phone,
            parentCompanyId,
          }
        : formData

      const response = await fetch("/api/companies", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      })

      let data: {
        id?: string
        error?: string
        code?: string
        branchQuota?: number
        currentBranches?: number
      } = {}
      try {
        data = await response.json()
      } catch {
        data = {}
      }

      if (!response.ok) {
        if (data.code === "PLAN_LIMIT_EXCEEDED") {
          // Şube kotası ile firma (maxCompanies) limiti ayrı sınırlar — mesajı karıştırma.
          if (isBranch) {
            const quota = data.branchQuota ?? 0
            throw new Error(
              `Şube kotanız dolu (${data.currentBranches ?? 0}/${quota}). ` +
                "Yeni şube eklemek için aboneliğinizden ek şube satın alın."
            )
          }
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
            {isBranch && (
              <div className="flex items-start gap-2 rounded-md border border-kobipo-blue/30 bg-kobipo-blue/5 p-3 text-xs text-kobipo-navy dark:border-primary/30 dark:bg-primary/10 dark:text-foreground">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-kobipo-blue dark:text-primary" />
                <p>
                  Bu şube{" "}
                  <span className="font-semibold">{parent?.name || "ana firmaya"}</span>{" "}
                  bağlı olarak eklenir. <span className="font-semibold">VKN, vergi dairesi ve
                  e-Dönüşüm ayarları</span> ana firmadan devralınır — yalnızca şube adı ve adres
                  bilgilerini girin.
                </p>
              </div>
            )}
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="name">{isBranch ? "Şube Adı *" : "Firma Adı *"}</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder={isBranch ? "Örn. Kadıköy Şubesi" : undefined}
                  required
                  disabled={isLoading}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="taxNumber">
                  {isBranch ? "Vergi No (ana firmadan)" : "Vergi No *"}
                </Label>
                <Input
                  id="taxNumber"
                  value={formData.taxNumber}
                  onChange={(e) => setFormData({ ...formData, taxNumber: e.target.value })}
                  placeholder={isBranch ? undefined : "10 haneli VKN veya 11 haneli TCKN"}
                  required={!isBranch}
                  disabled={isLoading || isBranch}
                  readOnly={isBranch}
                />
                {!isBranch && (
                  <p className="text-xs text-muted-foreground">
                    E-Dönüşüm ve GİB posta kutusu bilgileri bu numaraya göre getirilir.
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="taxOffice">Vergi Dairesi{isBranch && " (ana firmadan)"}</Label>
                <Input
                  id="taxOffice"
                  value={formData.taxOffice}
                  onChange={(e) => setFormData({ ...formData, taxOffice: e.target.value })}
                  disabled={isLoading || isBranch}
                  readOnly={isBranch}
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
            <Button type="submit" variant="success" className="w-full" disabled={isLoading}>
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

