"use client"

import { useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { CityCombobox } from "@/components/ui/city-combobox"
import { useToast } from "@/components/ui/use-toast"
import { useDashboardCompany } from "@/components/dashboard/dashboard-company-provider"
import { Info } from "lucide-react"

interface ParentCompany {
  id: string
  name: string
  taxNumber?: string | null
  taxOffice?: string | null
  isEDonusumEnabled?: boolean
}

/**
 * Firma/şube oluşturma formu.
 *
 * KOTA KAPISI BURADA DEĞİL: sayfa (app/(dashboard)/companies/new/page.tsx) sunucu
 * tarafında kotayı denetler ve hakkı olmayanı forma hiç sokmaz. Burada ikinci bir
 * kontrol tutmak, bir sonraki giriş yolunda (yeni bir link, yer imi, geri tuşu)
 * yine kaçak bırakırdı. Gönderimde sunucu zaten son sözü söyler (402/400).
 */
export function NewCompanyForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  // Bu ekranın ÜÇ modu var; hepsi farklı bir şey oluşturur:
  //   ?mode=branch&parent=  → ŞUBE. Aynı tüzel kişinin ikinci adresi; VKN/vergi
  //                           dairesi/e-Dönüşüm ana firmadan devralınır, sihirbaz atlanır.
  //   ?account=             → EK FİRMA. Ayrı VKN'li yeni tüzel kişi; kendi kimliğini
  //                           girer, yalnız abonelik/modüller hesaptan akar.
  //   (param yok)           → İLK FİRMA. Kullanıcının kendi hesabı doğar.
  const isBranch = searchParams.get("mode") === "branch"
  // Şubenin bağlanacağı ana firma: ?parent= (yoksa aktif firma ?company=).
  const parentCompanyId = searchParams.get("parent") || searchParams.get("company")
  // Ek firmanın bağlanacağı hesap. Şube modunda okunmaz.
  const accountCompanyId = isBranch ? null : searchParams.get("account")
  const isExtraCompany = !isBranch && !!accountCompanyId
  const { toast } = useToast()
  const { companies, isLoading: isLoadingCompanies } = useDashboardCompany()
  const [parent, setParent] = useState<ParentCompany | null>(null)
  const [accountName, setAccountName] = useState<string | null>(null)
  const [formData, setFormData] = useState({
    name: "",
    branchName: "",
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
          // Şube ana firmayla aynı tüzel kişidir → ünvan da devralınır (elle değiştirilebilir).
          // Şubeyi ayıran ad ayrı "Şube İsmi" alanında tutulur.
          name: prev.name || data.name || "",
          taxNumber: data.taxNumber || "",
          taxOffice: data.taxOffice || "",
        }))
      })
    return () => {
      cancelled = true
    }
  }, [isBranch, parentCompanyId])

  // Ek firma modunda hesabın adını göster — kullanıcı hangi aboneliğe bağlandığını
  // görmeli. Kimlik alanları DEVRALINMAZ, o yüzden yalnız ad okunur.
  useEffect(() => {
    if (!isExtraCompany || !accountCompanyId) return
    let cancelled = false
    fetch(`/api/companies/${accountCompanyId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: ParentCompany | null) => {
        if (!cancelled && data) setAccountName(data.name || null)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [isExtraCompany, accountCompanyId])

  // YALNIZCA İLK firmada: kayıt formunda girilen ünvan ve şube ismi burada ön
  // doldurulur — kullanıcı aynı bilgiyi ikinci kez yazmasın. Kullanıcı üzerine
  // yazabilir; alan doluysa (kullanıcı yazmaya başladıysa) dokunulmaz.
  //
  // Firma sayısı kontrolü ŞART: bu ekran seçicideki "Yeni firma ekle" ve Şube
  // Yönetimi'ndeki "Yeni Firma" ile de açılır. Kapsam daraltılmazsa ikinci/üçüncü
  // firmayı açan kullanıcının formu, kayıt sırasında yazdığı BAŞKA firmanın ünvanıyla
  // dolar ve fark edilmeden kaydedilebilir.
  useEffect(() => {
    if (isBranch || isLoadingCompanies || companies.length > 0) return
    let cancelled = false
    fetch("/api/auth/profile", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((profile: { companyDisplayName?: string | null; companyBranchName?: string | null } | null) => {
        if (cancelled || !profile) return
        setFormData((prev) => ({
          ...prev,
          name: prev.name || profile.companyDisplayName || "",
          branchName: prev.branchName || profile.companyBranchName || "",
        }))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [isBranch, isLoadingCompanies, companies.length])

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
      // yalnızca ad/adres/iletişim + parentCompanyId gönderilir. Ek firmada ise kimlik
      // formdan gelir; hesaba bağlanma bilgisi accountCompanyId ile taşınır.
      const payload = isBranch
        ? {
            name: formData.name,
            branchName: formData.branchName,
            address: formData.address,
            city: formData.city,
            phone: formData.phone,
            parentCompanyId,
          }
        : isExtraCompany
          ? { ...formData, accountCompanyId }
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
        quota?: number
        used?: number
      } = {}
      try {
        data = await response.json()
      } catch {
        data = {}
      }

      if (!response.ok) {
        // Şube ve firma AYRI kotalardır; mesajı karıştırmak kullanıcıyı yanlış ürüne
        // yönlendirir (şube alıp firma açamamak gibi).
        if (data.code === "BRANCH_QUOTA_EXCEEDED") {
          throw new Error(
            `Şube kotanız dolu (${data.used ?? 0}/${data.quota ?? 0}). ` +
              "Yeni şube eklemek için aboneliğinizden ek şube satın alın."
          )
        }
        if (data.code === "COMPANY_QUOTA_EXCEEDED") {
          throw new Error(
            `Firma kotanız dolu (${data.used ?? 0}/${data.quota ?? 0}). ` +
              "Yeni firma eklemek için aboneliğinizden ek firma satın alın."
          )
        }
        if (data.code === "ACCOUNT_REQUIRED") {
          throw new Error(
            "Zaten bir hesabınız var. Yeni firmayı Firma ve Şube Yönetimi'nden, hesabınıza " +
              "ek firma olarak ekleyin."
          )
        }
        if (data.code === "ADMIN_REQUIRED") {
          throw new Error("Yeni firma eklemek yalnızca firma yöneticisine açıktır.")
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

      // Şube: onboarding sihirbazını atla, yeni şube aktif olacak şekilde Firma ve Şube
      // Yönetimi'ne dön. Firma (ilk kurulum ya da ek firma): ayrı bir tüzel kişi olduğu
      // için kendi profil sihirbazına gider.
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
          <CardTitle>
            {isBranch ? "Yeni Şube Ekle" : isExtraCompany ? "Yeni Firma Ekle" : "Yeni Firma Oluştur"}
          </CardTitle>
          <CardDescription>
            {isBranch
              ? "Yeni şubenin bilgilerini doldurun. Şube, erişiminizdeki firma/şube listesine eklenir."
              : isExtraCompany
                ? "Ayrı vergi numaralı yeni bir firma ekleyin. Kendi aboneliğini satın alır."
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
                  bağlı olarak eklenir. <span className="font-semibold">Ünvan, VKN, vergi dairesi ve
                  e-Dönüşüm ayarları</span> ana firmadan devralınır — şubeyi ayırt etmek için{" "}
                  <span className="font-semibold">Şube İsmi</span> ve adres bilgilerini girin.{" "}
                  <span className="font-semibold">Abonelik devralınmaz</span>: şube açıldıktan
                  sonra kendi modüllerini satın alır (temel modüller açık gelir).
                </p>
              </div>
            )}
            {isExtraCompany && (
              <div className="flex items-start gap-2 rounded-md border border-kobipo-blue/30 bg-kobipo-blue/5 p-3 text-xs text-kobipo-navy dark:border-primary/30 dark:bg-primary/10 dark:text-foreground">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-kobipo-blue dark:text-primary" />
                <p>
                  Bu <span className="font-semibold">ayrı bir firmadır</span>: kendi ünvanı, VKN&apos;si,
                  adresi ve e-Dönüşüm hesabı olur — şube değildir, hiçbir bilgi devralınmaz.{" "}
                  <span className="font-semibold">{accountName || "Mevcut hesabınızın"}</span>{" "}
                  hesabına bağlanır ve firma kotanızdan bir hak düşer;{" "}
                  <span className="font-semibold">aboneliği ayrıdır</span> — modüllerini
                  açıldıktan sonra kendisi satın alır (temel modüller açık gelir).
                </p>
              </div>
            )}
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="name">{isBranch ? "Ünvan *" : "Firma Ünvanı *"}</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Örn. ABC Gıda San. ve Tic. Ltd. Şti."
                  required
                  disabled={isLoading}
                />
                <p className="text-xs text-muted-foreground">
                  Faturada ve e-belgelerde basılan resmi ünvan.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="branchName">{isBranch ? "Şube İsmi *" : "Şube İsmi"}</Label>
                <Input
                  id="branchName"
                  value={formData.branchName}
                  onChange={(e) => setFormData({ ...formData, branchName: e.target.value })}
                  placeholder="Örn. Kadıköy"
                  // Şubede ZORUNLU: ünvan ana firmadan devralındığı için, şube ismi
                  // olmadan şube listede/seçicide ana firmayla birebir aynı görünür.
                  required={isBranch}
                  disabled={isLoading}
                />
                <p className="text-xs text-muted-foreground">
                  {isBranch
                    ? "Ünvan ana firmayla aynı olduğu için şubeyi ayıran ad budur; listede ünvanın yanında parantez içinde görünür. Belgelere yazılmaz."
                    : "Ünvanlar aynı olabildiği için firma seçicide ünvanın yanında parantez içinde gösterilir. Belgelere yazılmaz."}
                </p>
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
                  : isExtraCompany
                    ? "Firma Ekle"
                    : "Firma Oluştur"}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  )
}

