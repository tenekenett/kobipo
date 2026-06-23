"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { ArrowLeft, CheckCircle2, Loader2, Plus, Save, Search, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/components/ui/use-toast"

type EntityType = "customers" | "suppliers"
type OpeningBalanceType = "DEBIT" | "CREDIT"

type FormData = {
  code: string
  name: string
  taxNumber: string
  taxOffice: string
  address: string
  city: string
  district: string
  phone: string
  email: string
  contactPerson: string
  paymentDueDays: string
  openingBalanceAmount: string
  openingBalanceType: OpeningBalanceType
  isAlsoSupplier: boolean
  isAlsoCustomer: boolean
  bankInfo: string
  note: string
  riskLimit: string
  classification1Id: string
  classification2Id: string
  authorizedUserId: string
}

type BranchForm = { id: string; name: string; address: string }
type VknInfo = {
  accountName?: string
  isEInvoiceTaxpayer?: boolean
  eInvoiceStartDate?: string | null
  eWaybillStartDate?: string | null
  accountType?: number | null
  aliases?: string[]
  notFound?: boolean
}
type DefinitionType = "CLASS_1" | "CLASS_2"
type CompanyDefinition = {
  id: string
  type: DefinitionType
  label: string
}
type CompanyMember = {
  user?: {
    id: string
    name?: string
    email: string
  }
}

const defaultFormData: FormData = {
  code: "",
  name: "",
  taxNumber: "",
  taxOffice: "",
  address: "",
  city: "",
  district: "",
  phone: "",
  email: "",
  contactPerson: "",
  paymentDueDays: "",
  openingBalanceAmount: "",
  openingBalanceType: "DEBIT",
  isAlsoSupplier: false,
  isAlsoCustomer: false,
  bankInfo: "",
  note: "",
  riskLimit: "",
  classification1Id: "",
  classification2Id: "",
  authorizedUserId: "",
}

function normalizePaymentDueDays(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

type CariEntityFormPageProps = {
  entityType: EntityType
  mode: "create" | "edit"
  entityId?: string
}

export function CariEntityFormPage({ entityType, mode, entityId }: CariEntityFormPageProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { toast } = useToast()

  const companyId = searchParams.get("company")
  const isCustomer = entityType === "customers"
  const entityLabel = isCustomer ? "Müşteri" : "Tedarikçi"
  const [activeTab, setActiveTab] = useState("identity")
  const [isLoading, setIsLoading] = useState(false)
  const [isFetching, setIsFetching] = useState(mode === "edit")
  const [formData, setFormData] = useState<FormData>(defaultFormData)
  const [branches, setBranches] = useState<BranchForm[]>([])
  const [definitions, setDefinitions] = useState<CompanyDefinition[]>([])
  const [members, setMembers] = useState<CompanyMember[]>([])
  const [isFetchingVkn, setIsFetchingVkn] = useState(false)
  const [vknInfo, setVknInfo] = useState<VknInfo | null>(null)

  // VKN/TCKN'den GİB hesap bilgilerini getirir: ünvan, e-Fatura mükellef durumu/tarihi,
  // hesap tipi (tüzel/şahıs) ve posta kutusu etiketleri. NOT: GİB adres/vergi dairesi
  // vermez — bunlar elle girilir. Ünvan boşsa otomatik doldurulur.
  const fetchFromVkn = async () => {
    if (!companyId) return
    const vkn = formData.taxNumber.replace(/\D/g, "")
    if (vkn.length !== 10 && vkn.length !== 11) {
      toast({
        title: "Geçersiz VKN/TCKN",
        description: "10 (kurumsal) veya 11 (gerçek kişi) haneli numara girin.",
        variant: "destructive",
      })
      return
    }
    setIsFetchingVkn(true)
    setVknInfo(null)
    try {
      const res = await fetch(`/api/e-donusum/check-vkn?companyId=${companyId}&vkn=${vkn}`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || "Sorgulama başarısız")
      if (data.accountName) {
        setFormData((prev) => ({
          ...prev,
          name: prev.name.trim() ? prev.name : data.accountName,
        }))
        setVknInfo({
          accountName: data.accountName,
          isEInvoiceTaxpayer: Boolean(data.isEInvoiceTaxpayer),
          eInvoiceStartDate: data.eInvoiceStartDate ?? null,
          eWaybillStartDate: data.eWaybillStartDate ?? null,
          accountType: data.accountType ?? null,
          aliases: Array.isArray(data.aliases) ? data.aliases : [],
        })
        toast({
          title: "Bilgiler getirildi",
          description: `${data.accountName}${data.isEInvoiceTaxpayer ? " • e-Fatura mükellefi" : ""}`,
        })
      } else {
        setVknInfo({ notFound: true })
        toast({
          title: "Ünvan bulunamadı",
          description: data.reason || "GİB'de bu VKN için kayıt bulunamadı. Bilgileri elle girin.",
        })
      }
    } catch (e) {
      toast({
        title: "Hata",
        description: e instanceof Error ? e.message : "VKN sorgulanamadı",
        variant: "destructive",
      })
    } finally {
      setIsFetchingVkn(false)
    }
  }

  const backHref = useMemo(() => {
    if (!companyId) return "/cari"
    return `/cari?company=${companyId}&tab=${entityType}`
  }, [companyId, entityType])

  useEffect(() => {
    if (mode !== "edit" || !entityId || !companyId) return

    const fetchEntity = async () => {
      setIsFetching(true)
      try {
        const response = await fetch(`/api/cari/${entityType}/${entityId}?companyId=${companyId}`, {
          cache: "no-store",
        })
        if (!response.ok) {
          throw new Error(`${entityLabel} bilgileri alınamadı`)
        }
        const data = await response.json()
        setFormData({
          code: data.code || "",
          name: data.name || "",
          taxNumber: data.taxNumber || "",
          taxOffice: data.taxOffice || "",
          address: data.address || "",
          city: data.city || "",
          district: data.district || "",
          phone: data.phone || "",
          email: data.email || "",
          contactPerson: data.contactPerson || "",
          paymentDueDays:
            data.paymentDueDays === null || data.paymentDueDays === undefined
              ? ""
              : String(data.paymentDueDays),
          openingBalanceAmount: String(data.openingBalanceAmount ?? ""),
          openingBalanceType: data.openingBalanceType === "CREDIT" ? "CREDIT" : "DEBIT",
          isAlsoSupplier: Boolean(data.isAlsoSupplier),
          isAlsoCustomer: Boolean(data.isAlsoCustomer),
          bankInfo: data.bankInfo || "",
          note: data.note || "",
          riskLimit: data.riskLimit === null || data.riskLimit === undefined ? "" : String(data.riskLimit),
          classification1Id: data.classification1Id || "",
          classification2Id: data.classification2Id || "",
          authorizedUserId: data.authorizedUserId || "",
        })
        setBranches(
          Array.isArray(data.branches)
            ? data.branches.map((branch: { id?: string; name?: string; address?: string }) => ({
                id: branch.id || crypto.randomUUID(),
                name: branch.name || "",
                address: branch.address || "",
              }))
            : []
        )
      } catch (error) {
        toast({
          title: "Hata",
          description: error instanceof Error ? error.message : "Kayıt alınamadı",
          variant: "destructive",
        })
      } finally {
        setIsFetching(false)
      }
    }

    void fetchEntity()
  }, [companyId, entityId, entityLabel, entityType, mode, toast])

  useEffect(() => {
    if (!companyId) return

    const fetchLookupData = async () => {
      try {
        const [definitionsResponse, membersResponse] = await Promise.all([
          fetch(`/api/company/definitions?companyId=${companyId}`, { cache: "no-store" }),
          fetch(`/api/company/users?companyId=${companyId}`, { cache: "no-store" }),
        ])

        if (definitionsResponse.ok) {
          const definitionsData = (await definitionsResponse.json()) as CompanyDefinition[]
          setDefinitions(definitionsData)
        }
        if (membersResponse.ok) {
          const membersData = (await membersResponse.json()) as CompanyMember[]
          setMembers(membersData)
        }
      } catch {
        // optional lookup data, keep form usable
      }
    }

    void fetchLookupData()
  }, [companyId])

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!companyId) {
      toast({
        title: "Hata",
        description: "Firma seçimi bulunamadı",
        variant: "destructive",
      })
      return
    }

    setIsLoading(true)
    try {
      const payload = {
        ...formData,
        companyId,
        paymentDueDays: normalizePaymentDueDays(formData.paymentDueDays),
        riskLimit:
          formData.riskLimit.trim().length > 0 && Number.isFinite(Number(formData.riskLimit))
            ? Number(formData.riskLimit)
            : null,
        branches: isCustomer
          ? branches
              .map((branch) => ({
                name: branch.name.trim(),
                address: branch.address.trim(),
              }))
              .filter((branch) => branch.name.length > 0)
          : undefined,
        classification1Id: formData.classification1Id || null,
        classification2Id: formData.classification2Id || null,
        authorizedUserId: formData.authorizedUserId || null,
      }
      const endpoint = mode === "edit" && entityId ? `/api/cari/${entityType}/${entityId}` : `/api/cari/${entityType}`
      const response = await fetch(endpoint, {
        method: mode === "edit" ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        let message = "İşlem tamamlanamadı"
        try {
          const data = await response.json()
          if (typeof data?.error === "string") message = data.error
        } catch {
          // no-op
        }
        throw new Error(message)
      }

      toast({
        title: "Başarılı",
        description: `${entityLabel} ${mode === "edit" ? "güncellendi" : "oluşturuldu"}`,
      })
      router.push(backHref)
      router.refresh()
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

  const addBranch = () => {
    setBranches((prev) => [...prev, { id: crypto.randomUUID(), name: "", address: "" }])
  }

  const updateBranch = (id: string, patch: Partial<Omit<BranchForm, "id">>) => {
    setBranches((prev) => prev.map((branch) => (branch.id === id ? { ...branch, ...patch } : branch)))
  }

  const removeBranch = (id: string) => {
    setBranches((prev) => prev.filter((branch) => branch.id !== id))
  }

  if (!companyId) {
    return (
      <div className="flex items-center justify-center p-8">
        <p className="text-muted-foreground">Lütfen bir firma seçin</p>
      </div>
    )
  }

  if (isFetching) {
    return (
      <div className="flex items-center justify-center p-8">
        <p className="text-muted-foreground">Yükleniyor...</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link href={backHref}>
            <Button variant="outline" type="button">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Geri Dön
            </Button>
          </Link>
        </div>
        <Button type="submit" form="cari-entity-form" disabled={isLoading}>
          <Save className="mr-2 h-4 w-4" />
          {isLoading ? "Kaydediliyor..." : "Kaydet"}
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <CardTitle>{mode === "edit" ? `${entityLabel} Düzenle` : `Yeni ${entityLabel}`}</CardTitle>
          <CardDescription>
            {entityLabel} kaydı için sekmeleri doldurup kaydedin.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form id="cari-entity-form" onSubmit={handleSubmit} className="space-y-5">
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="h-auto w-full justify-start gap-2 overflow-auto rounded-md bg-muted p-1">
                <TabsTrigger value="identity">Kimlik Bilgileri</TabsTrigger>
                <TabsTrigger value="contact">İletişim</TabsTrigger>
                <TabsTrigger value="account">Cari</TabsTrigger>
                <TabsTrigger value="other">Diğer</TabsTrigger>
                {isCustomer && <TabsTrigger value="branches">Şubeler</TabsTrigger>}
              </TabsList>

              <TabsContent value="identity" className="space-y-4 pt-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="taxNumber">Vergi / TC Kimlik No</Label>
                    <div className="flex gap-2">
                      <Input
                        id="taxNumber"
                        value={formData.taxNumber}
                        onChange={(e) => setFormData({ ...formData, taxNumber: e.target.value })}
                        disabled={isLoading || isFetchingVkn}
                        className="flex-1"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={fetchFromVkn}
                        disabled={isLoading || isFetchingVkn}
                        title="VKN'den bilgileri getir"
                        className="shrink-0"
                      >
                        {isFetchingVkn ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Search className="h-4 w-4" />
                        )}
                        <span className="ml-1 hidden sm:inline">VKN'den Getir</span>
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      GİB'den ünvan, e-Fatura durumu ve posta kutusu otomatik getirilir.
                    </p>
                  </div>

                  {vknInfo && (
                    <div className="md:col-span-2">
                      {vknInfo.notFound ? (
                        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
                          GİB'de bu VKN için kayıt bulunamadı. Bilgileri elle girebilirsiniz.
                        </div>
                      ) : (
                        <div className="space-y-1.5 rounded-md border bg-muted/40 p-3 text-xs">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium text-foreground">{vknInfo.accountName}</span>
                            {vknInfo.accountType === 1 && (
                              <span className="rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                                Tüzel kişi
                              </span>
                            )}
                            {vknInfo.accountType === 2 && (
                              <span className="rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                                Şahıs
                              </span>
                            )}
                          </div>
                          {vknInfo.isEInvoiceTaxpayer ? (
                            <div className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
                              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                              <span>
                                e-Fatura mükellefi
                                {vknInfo.eInvoiceStartDate
                                  ? ` (${new Date(vknInfo.eInvoiceStartDate).toLocaleDateString("tr-TR", { dateStyle: "medium" })}'den beri)`
                                  : ""}{" "}
                                — faturalar e-Fatura olarak kesilir
                              </span>
                            </div>
                          ) : (
                            <div className="text-muted-foreground">
                              e-Fatura mükellefi değil — faturalar e-Arşiv olarak kesilir
                            </div>
                          )}
                          {vknInfo.aliases && vknInfo.aliases.length > 0 && (
                            <div className="text-muted-foreground">
                              <span className="font-medium text-foreground">Posta kutusu:</span>{" "}
                              {vknInfo.aliases.join(", ")}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="name">İsmi / Ünvanı *</Label>
                    <Input
                      id="name"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      required
                      disabled={isLoading}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="code">Kodu</Label>
                    <Input
                      id="code"
                      value={formData.code}
                      onChange={(e) => setFormData({ ...formData, code: e.target.value })}
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
                    <Label htmlFor="district">İlçe</Label>
                    <Input
                      id="district"
                      value={formData.district}
                      onChange={(e) => setFormData({ ...formData, district: e.target.value })}
                      disabled={isLoading}
                    />
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="contact" className="space-y-4 pt-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="email">E-Posta</Label>
                    <Input
                      id="email"
                      type="email"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      disabled={isLoading}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="contactPerson">Yetkili Kişi</Label>
                    <Input
                      id="contactPerson"
                      value={formData.contactPerson}
                      onChange={(e) => setFormData({ ...formData, contactPerson: e.target.value })}
                      disabled={isLoading}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="phone">Cep Telefonu</Label>
                    <Input
                      id="phone"
                      type="tel"
                      value={formData.phone}
                      onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                      disabled={isLoading}
                    />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="address">Adres</Label>
                    <Textarea
                      id="address"
                      value={formData.address}
                      onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                      disabled={isLoading}
                      rows={3}
                    />
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="account" className="space-y-4 pt-4">
                <div className="grid gap-4 md:grid-cols-2">
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
                    <Label htmlFor="paymentDueDays">Vadesi (gün)</Label>
                    <Input
                      id="paymentDueDays"
                      type="number"
                      min="0"
                      value={formData.paymentDueDays}
                      onChange={(e) => setFormData({ ...formData, paymentDueDays: e.target.value })}
                      disabled={isLoading}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="openingBalanceAmount">Açılış Bakiyesi</Label>
                    <Input
                      id="openingBalanceAmount"
                      type="number"
                      step="0.01"
                      value={formData.openingBalanceAmount}
                      onChange={(e) => setFormData({ ...formData, openingBalanceAmount: e.target.value })}
                      disabled={isLoading}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="openingBalanceType">Bakiye Türü</Label>
                    <select
                      id="openingBalanceType"
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      value={formData.openingBalanceType}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          openingBalanceType: e.target.value === "CREDIT" ? "CREDIT" : "DEBIT",
                        })
                      }
                      disabled={isLoading}
                    >
                      <option value="DEBIT">Borç</option>
                      <option value="CREDIT">Alacak</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="riskLimit">Açık Hesap Risk Limiti</Label>
                    <Input
                      id="riskLimit"
                      type="number"
                      value={formData.riskLimit}
                      onChange={(e) => setFormData({ ...formData, riskLimit: e.target.value })}
                      disabled={isLoading}
                    />
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="other" className="space-y-4 pt-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Label htmlFor="classification1Id">Sınıflandırma 1</Label>
                      <Link
                        href={`/ayarlar/tanimlar?company=${companyId}`}
                        className="text-xs text-amber-600 hover:underline"
                      >
                        + yeni sınıflandırma ekle
                      </Link>
                    </div>
                    <select
                      id="classification1Id"
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      value={formData.classification1Id}
                      onChange={(e) => setFormData({ ...formData, classification1Id: e.target.value })}
                      disabled={isLoading}
                    >
                      <option value="">Seçiniz</option>
                      {definitions
                        .filter((item) => item.type === "CLASS_1")
                        .map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.label}
                          </option>
                        ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Label htmlFor="authorizedUserId">Yetkili Çalışan</Label>
                    </div>
                    <select
                      id="authorizedUserId"
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      value={formData.authorizedUserId}
                      onChange={(e) => setFormData({ ...formData, authorizedUserId: e.target.value })}
                      disabled={isLoading}
                    >
                      <option value="">çalışan seçin... (isteğe bağlı)</option>
                      {members
                        .filter((item) => Boolean(item.user?.id))
                        .map((item) => (
                          <option key={item.user!.id} value={item.user!.id}>
                            {item.user!.name || item.user!.email}
                          </option>
                        ))}
                    </select>
                    <p className="text-xs text-muted-foreground">
                      Dilerseniz bu müşteriyi sadece seçtiğiniz çalışanın görmesini sağlayabilirsiniz.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Label htmlFor="classification2Id">Sınıflandırma 2</Label>
                      <Link
                        href={`/ayarlar/tanimlar?company=${companyId}`}
                        className="text-xs text-amber-600 hover:underline"
                      >
                        + yeni sınıflandırma ekle
                      </Link>
                    </div>
                    <select
                      id="classification2Id"
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      value={formData.classification2Id}
                      onChange={(e) => setFormData({ ...formData, classification2Id: e.target.value })}
                      disabled={isLoading}
                    >
                      <option value="">Seçiniz</option>
                      {definitions
                        .filter((item) => item.type === "CLASS_2")
                        .map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.label}
                          </option>
                        ))}
                    </select>
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="bankInfo">Banka Bilgileri</Label>
                    <Textarea
                      id="bankInfo"
                      value={formData.bankInfo}
                      onChange={(e) => setFormData({ ...formData, bankInfo: e.target.value })}
                      disabled={isLoading}
                      rows={3}
                    />
                  </div>
                  <div className="space-y-3 md:col-span-2 rounded-md border p-3">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="linked-role-switch">
                        {isCustomer ? "Aynı zamanda Tedarikçi" : "Aynı zamanda Müşteri"}
                      </Label>
                      <Switch
                        id="linked-role-switch"
                        checked={isCustomer ? formData.isAlsoSupplier : formData.isAlsoCustomer}
                        onCheckedChange={(checked) =>
                          setFormData({
                            ...formData,
                            isAlsoSupplier: isCustomer ? checked : false,
                            isAlsoCustomer: isCustomer ? false : checked,
                          })
                        }
                        disabled={isLoading}
                      />
                    </div>
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="note">Not</Label>
                    <Textarea
                      id="note"
                      value={formData.note}
                      onChange={(e) => setFormData({ ...formData, note: e.target.value })}
                      disabled={isLoading}
                      rows={4}
                    />
                  </div>
                </div>
              </TabsContent>

              {isCustomer && (
                <TabsContent value="branches" className="space-y-4 pt-4">
                  <div className="rounded-md bg-muted/60 p-3 text-sm text-muted-foreground">
                    Bu müşterinin birden fazla şubesi varsa burada ayrı ayrı ekleyebilirsiniz. Tedarikçi akışında
                    şube adımı bulunmaz.
                  </div>
                  <div className="flex justify-start">
                    <Button type="button" variant="outline" onClick={addBranch} disabled={isLoading}>
                      <Plus className="mr-2 h-4 w-4" />
                      Yeni şube ekle
                    </Button>
                  </div>
                  <div className="space-y-3">
                    {branches.length === 0 ? (
                      <p className="text-sm text-muted-foreground">Henüz şube eklenmedi.</p>
                    ) : (
                      branches.map((branch, index) => (
                        <div key={branch.id} className="space-y-2 rounded-md border p-3">
                          <div className="flex items-center justify-between">
                            <p className="text-sm font-medium">Şube {index + 1}</p>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => removeBranch(branch.id)}
                              disabled={isLoading}
                            >
                              <Trash2 className="h-4 w-4 text-red-600" />
                            </Button>
                          </div>
                          <Input
                            placeholder="Şube adı"
                            value={branch.name}
                            onChange={(e) => updateBranch(branch.id, { name: e.target.value })}
                            disabled={isLoading}
                          />
                          <Textarea
                            placeholder="Şube adresi"
                            value={branch.address}
                            onChange={(e) => updateBranch(branch.id, { address: e.target.value })}
                            disabled={isLoading}
                            rows={2}
                          />
                        </div>
                      ))
                    )}
                  </div>
                </TabsContent>
              )}
            </Tabs>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
