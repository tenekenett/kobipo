"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useToast } from "@/components/ui/use-toast"
import { Plus, Trash2, X, Clock, Check, Eye, Download, Loader2 } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { ProductCombobox } from "@/components/e-donusum/product-combobox"
import { CounterpartyCombobox } from "@/components/e-donusum/counterparty-combobox"
import { WithholdingCombobox } from "@/components/e-donusum/withholding-combobox"


type LineExtraKey = "description" | "discountRate" | "withholdingRate" | "exciseRate" | "otherTaxRate"

const LINE_EXTRA_LABEL: Record<LineExtraKey, string> = {
  description: "Satır açıklaması",
  discountRate: "İskonto",
  withholdingRate: "Tevkifat (%)",
  exciseRate: "ÖTV (%)",
  otherTaxRate: "Diğer Vergi",
}

type DiscountMode = "PERCENT" | "AMOUNT"

const LINE_EXTRA_ORDER: LineExtraKey[] = [
  "description",
  "discountRate",
  "withholdingRate",
  "exciseRate",
  "otherTaxRate",
]

const INVOICE_UNIT_OPTIONS = ["ADET", "KG", "MT", "M2", "M3", "LT", "SA", "GUN", "PAKET"] as const
const E_DOC_TYPES = new Set(["E_INVOICE", "E_ARCHIVE"])
const BRAND_COLOR = "#143d6b"

// GİB KDV İstisna Kodları (yaygın olanlar). 0% KDV seçildiğinde zorunlu.
// Tam liste için: https://efatura.gov.tr (KDV istisna kodları)
const TAX_EXEMPTION_CODES: { code: string; label: string }[] = [
  { code: "351", label: "351 - Diğer istisnalar (genel)" },
  { code: "350", label: "350 - KDV Kanunu kapsamında istisna" },
  { code: "319", label: "319 - Eğitim / öğretim hizmetleri" },
  { code: "325", label: "325 - Sağlık hizmetleri" },
  { code: "301", label: "301 - İhracat (uyarı: IHRACAT profili + gümrük alanları gerekir)" },
]

interface Customer { id: string; name: string; taxNumber?: string | null; taxOffice?: string | null; address?: string | null }
interface Supplier { id: string; name: string; taxNumber?: string | null; taxOffice?: string | null; address?: string | null }
interface Product { id: string; name: string; code?: string; salePrice?: number; vatRate: number; unit?: string }
export interface InvoiceItem { productId?: string; description: string; unit?: string; quantity: number; unitPrice: number; discountRate?: number; discountAmount?: number; discountMode?: DiscountMode; vatRate: number; withholdingRate?: number; withholdingCode?: string; withholdingName?: string; exciseRate?: number; otherTaxRate?: number; otherTaxName?: string; taxExemptionReasonCode?: string; taxExemptionReason?: string; salePrice?: number }
interface CompanySettings { id: string; name?: string; taxNumber?: string | null; taxOffice?: string | null; address?: string | null; isEDonusumEnabled?: boolean }

export type InvoiceEditorMode = "create" | "edit"

export type InvoiceEditorProps = {
  companyId: string
  mode: InvoiceEditorMode
  invoiceId?: string
  defaultManual?: boolean
  defaultType?: "SALES" | "PURCHASE" | "RETURN"
  defaultCustomerId?: string
  defaultSupplierId?: string
  duplicateFromId?: string
  backHref?: string
  fromIncomingUuid?: string
}

export function InvoiceEditor({ companyId, mode, invoiceId, defaultManual, defaultType, defaultCustomerId, defaultSupplierId, duplicateFromId, backHref, fromIncomingUuid }: InvoiceEditorProps) {
  const router = useRouter()
  const { toast } = useToast()

  const [customers, setCustomers] = useState<Customer[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [bootstrappingEdit, setBootstrappingEdit] = useState(mode === "edit")
  const [companySettings, setCompanySettings] = useState<CompanySettings | null>(null)
  const [editingInvoiceId, setEditingInvoiceId] = useState<string | null>(null)
  // Hazır GİB tevkifat kodları (Mysoft'tan). E-dönüşüm açık firmalarda dolu döner;
  // boşsa tevkifat alanı serbest yüzde girişine geri düşer.
  const [withholdingTypes, setWithholdingTypes] = useState<Array<{ code: string; name: string; rate: number }>>([])

  // Gelen e-faturadan dönüştürme akışı için
  const [incomingPrefillError, setIncomingPrefillError] = useState<string | null>(null)
  const [incomingSupplierCandidate, setIncomingSupplierCandidate] = useState<{
    name: string | null
    taxNumber: string | null
    taxOffice: string | null
    address: string | null
    city: string | null
    district: string | null
  } | null>(null)
  const [isCreatingSupplier, setIsCreatingSupplier] = useState(false)
  // useRef: state'ten farklı olarak senkron güncellenir, effect re-run'larda race olmaz.
  // Aynı prefill mantığını birden çok kez çalıştırırsak notlar ve kalemler tekrar eder.
  const prefilledFromIncomingRef = useRef(false)
  // Kopya prefill'i de bir kez çalışsın (effect re-run'larda tekrarlamasın).
  const duplicatedRef = useRef(false)
  const [suppliersLoaded, setSuppliersLoaded] = useState(false)
  const [productsLoaded, setProductsLoaded] = useState(false)

  // VKN otomatik tespit: müşteri/tedarikçi seçildiğinde Mysoft GİB'den sorgular,
  // sonucuna göre invoiceType (E_INVOICE vs E_ARCHIVE) belirlenir.
  const [vknCheck, setVknCheck] = useState<{
    checking: boolean
    isEInvoiceTaxpayer: boolean | null
    suggestedInvoiceType: "E_INVOICE" | "E_ARCHIVE" | "MANUAL" | null
    accountName: string | null
    reason: string | null
  }>({
    checking: false,
    isEInvoiceTaxpayer: null,
    suggestedInvoiceType: null,
    accountName: null,
    reason: null,
  })

  // Önceki Fiyatlar Modal State'leri
  const [isPriceModalOpen, setIsPriceModalOpen] = useState(false)
  const [activePriceTab, setActivePriceTab] = useState<"sales" | "customerSales" | "purchases" | "supplierPurchases" | "quotes">("sales")
  const [priceHistory, setPriceHistory] = useState<{ sales: any[], customerSales: any[], purchases: any[], supplierPurchases: any[], quotes: any[] }>({ sales: [], customerSales: [], purchases: [], supplierPurchases: [], quotes: [] })
  const [isPriceHistoryLoading, setIsPriceHistoryLoading] = useState(false)
  const [activeItemIndexForPrices, setActiveItemIndexForPrices] = useState<number | null>(null)

  // GİB formatı taslak önizleme modalı
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)
  const [isPreviewLoading, setIsPreviewLoading] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  const [formData, setFormData] = useState({
    type: "SALES",
    invoiceType: "E_ARCHIVE",
    invoiceNo: "", // boş bırakılırsa API otomatik üretir; gelen e-faturadan içe aktarmada doldurulur
    customerId: "",
    supplierId: "",
    date: new Date().toISOString().split("T")[0],
    dueDate: "",
    currency: "TRY",
    exchangeRate: "",
    exchangeRateDate: "",
    notes: "",
  })
  
  const [items, setItems] = useState<InvoiceItem[]>([
    { description: "", unit: "ADET", quantity: 1, unitPrice: 0, discountRate: 0, vatRate: 20, withholdingRate: 0, exciseRate: 0 },
  ])
  const [lineExtras, setLineExtras] = useState<LineExtraKey[][]>([[]])

  // Fatura altı (genel) iskonto: kullanıcı % veya ₺ olarak girer, save'de tutar
  // (globalDiscountAmount) olarak DB'ye yazılır. KDV matrahından oransal düşülür.
  const [globalDiscountEnabled, setGlobalDiscountEnabled] = useState(false)
  const [globalDiscountMode, setGlobalDiscountMode] = useState<DiscountMode>("PERCENT")
  const [globalDiscountInput, setGlobalDiscountInput] = useState<string>("")

  // "Tutar" (KDV dahil) kolonu düzenlenirken kullanıcının yazdığı ham metni tutarız;
  // odak kaybında yeniden hesaplanan tutara döneriz.
  const [editingTotalIndex, setEditingTotalIndex] = useState<number | null>(null)
  const [editingTotalValue, setEditingTotalValue] = useState<string>("")

  const listHref = backHref || `/e-donusum?company=${encodeURIComponent(companyId)}`
  const goBack = () => router.push(listHref)

  useEffect(() => {
    if (!companyId) return
    fetchCustomers()
    fetchSuppliers()
    fetchProducts()
    fetchCompanySettings()
  }, [companyId])

  // Önizleme blob URL'ini bileşen kapanırken serbest bırak (bellek sızıntısı olmasın).
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  // Hazır GİB tevkifat kodlarını çek (e-dönüşüm açık firmalarda dolu döner).
  useEffect(() => {
    if (!companyId) return
    let active = true
    fetch(`/api/e-donusum/withholding-types?companyId=${companyId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (active && d && Array.isArray(d.data)) setWithholdingTypes(d.data)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [companyId])

  useEffect(() => {
    if (defaultManual) setFormData((prev) => ({ ...prev, invoiceType: "MANUAL" }))
  }, [defaultManual])

  // Liste sayfasından gelen varsayılan fatura tipi (örn. alış sayfasından PURCHASE).
  // Sadece create modunda ve gelen e-faturadan dönüştürme yokken uygulanır;
  // o akış tipi kendi içinde PURCHASE yapıyor.
  useEffect(() => {
    if (mode !== "create" || !defaultType || fromIncomingUuid) return
    setFormData((prev) => (prev.type === defaultType ? prev : { ...prev, type: defaultType }))
  }, [mode, defaultType, fromIncomingUuid])

  // Cari kartından "Fatura Kes" ile gelindiğinde ilgili müşteri/tedarikçiyi
  // baştan seçili getir. Sadece create modunda ve gelen e-fatura akışı yokken.
  useEffect(() => {
    if (mode !== "create" || fromIncomingUuid) return
    if (defaultCustomerId) {
      setFormData((prev) =>
        prev.customerId === defaultCustomerId ? prev : { ...prev, customerId: defaultCustomerId, supplierId: "" },
      )
    } else if (defaultSupplierId) {
      setFormData((prev) =>
        prev.supplierId === defaultSupplierId ? prev : { ...prev, supplierId: defaultSupplierId, customerId: "" },
      )
    }
  }, [mode, defaultCustomerId, defaultSupplierId, fromIncomingUuid])

  useEffect(() => {
    if (mode !== "edit" || !companyId || !invoiceId) return
    fetchInvoiceForEdit(invoiceId)
  }, [mode, companyId, invoiceId])

  // Gelen e-faturadan dönüştürme: sipariş suppliers + products yüklendikten sonra
  // pre-fill yap. URL'de fromIncoming varsa /api/e-donusum/inbox/[uuid]?withModel=1
  // çağrısı ile header + kalemleri çekiyoruz.
  useEffect(() => {
    if (mode !== "create") return
    if (!fromIncomingUuid || !companyId) return
    if (prefilledFromIncomingRef.current) return
    if (!suppliersLoaded || !productsLoaded) return
    // Senkron guard: bu effect ikinci kez girmeden flag işaretle.
    prefilledFromIncomingRef.current = true

    const prefill = async () => {
      try {
        const res = await fetch(
          `/api/e-donusum/inbox/${encodeURIComponent(fromIncomingUuid)}?companyId=${encodeURIComponent(
            companyId,
          )}&withModel=1`,
        )
        const data = await res.json()
        if (!res.ok) {
          setIncomingPrefillError(data.error || "Gelen fatura okunamadı")
          return
        }

        if (data.isLinkedToPurchase) {
          setIncomingPrefillError(
            "Bu gelen fatura zaten bir alış faturasına dönüştürülmüş. Lütfen ilgili faturayı açın.",
          )
          return
        }

        const senderVkn: string | null = data.sender?.taxNumber || null
        const senderName: string | null = data.sender?.name || null
        const matchedSupplier = senderVkn
          ? suppliers.find((s) => (s.taxNumber || "").trim() === senderVkn.trim())
          : null

        if (!matchedSupplier) {
          setIncomingSupplierCandidate({
            name: senderName,
            taxNumber: senderVkn,
            taxOffice: data.model?.sender?.taxOffice || null,
            address: data.model?.sender?.address || null,
            city: data.model?.sender?.city || null,
            district: data.model?.sender?.district || null,
          })
        }

        const modelLines: any[] = Array.isArray(data.model?.lines) ? data.model.lines : []
        if (modelLines.length === 0) {
          // Kalem detayı gelmedi → aşağıda tek satırlık "Mal/Hizmet" taslağına düşülür.
          // Sessiz kalmasın: nedeni (Mysoft model hatası vb.) kullanıcıya bildir.
          toast({
            title: "Fatura kalemleri otomatik alınamadı",
            description:
              (data.modelError as string) ||
              "Mysoft bu fatura için kalem listesi döndürmedi. Tek satırlık taslak eklendi; lütfen kalemleri elle düzenleyin.",
            variant: "destructive",
          })
        }
        const newItems: InvoiceItem[] =
          modelLines.length > 0
            ? modelLines.map((ln: any) => {
                const desc: string = String(ln.description || "").trim()
                const code: string = String(ln.productCode || "").trim()
                // Önce kod ile, sonra isim ile ürün eşleştirme
                const byCode = code
                  ? products.find(
                      (p) => (p.code || "").trim().toLowerCase() === code.toLowerCase(),
                    )
                  : undefined
                const byName =
                  !byCode && desc
                    ? products.find(
                        (p) => (p.name || "").trim().toLowerCase() === desc.toLowerCase(),
                      )
                    : undefined
                const matchedProduct = byCode || byName
                const qty = Number(ln.quantity) || 0
                const unitPrice = Number(ln.unitPrice) || 0
                const vat = Number(ln.vatRate ?? 20)
                const discRate = Number(ln.discountRate ?? 0)
                const discAmount = Number(ln.discountAmount ?? 0)
                // KDV dışı "Diğer Vergiler" (ör. Konaklama Vergisi) — matrahın üzerine
                // eklenen ek vergi. Oran + ad gelen faturadan taşınır.
                const otherTaxRate = Number(ln.otherTaxRate ?? 0)
                // KDV tevkifatı: gelen faturadan (başlık invoiceType=TEVKIFAT reconciliation'ı
                // ya da detailList) taşınır. Önceden hep 0'a sabitlendiği için tevkifat düşüyordu.
                const withholdingRate = Number(ln.withholdingRate ?? 0)
                return {
                  productId: matchedProduct?.id,
                  description: desc || (matchedProduct?.name ?? ""),
                  unit: (ln.unit as string) || matchedProduct?.unit || "ADET",
                  quantity: qty > 0 ? qty : 1,
                  unitPrice,
                  discountRate: discRate,
                  discountAmount: discAmount,
                  discountMode: discAmount > 0 && discRate === 0 ? "AMOUNT" as DiscountMode : "PERCENT" as DiscountMode,
                  vatRate: Number.isFinite(vat) ? vat : 20,
                  withholdingRate: Number.isFinite(withholdingRate) && withholdingRate > 0 ? withholdingRate : 0,
                  withholdingCode: (ln.withholdingCode as string) || undefined,
                  withholdingName: (ln.withholdingName as string) || undefined,
                  exciseRate: 0,
                  otherTaxRate: Number.isFinite(otherTaxRate) && otherTaxRate > 0 ? otherTaxRate : 0,
                  otherTaxName: (ln.otherTaxName as string) || undefined,
                }
              })
            : [
                {
                  // Mysoft sandbox kalem detayı dönmediğinde tek satırlık placeholder.
                  // Kullanıcı bu satırı düzenleyip gerçek ürünü seçebilir. ETTN notlarda
                  // zaten görünüyor, satır açıklamasına eklemiyoruz.
                  description: "Mal/Hizmet",
                  unit: "ADET",
                  quantity: 1,
                  unitPrice: Number(data.taxExclusiveAmount) || 0,
                  discountRate: 0,
                  vatRate: 20,
                  withholdingRate: 0,
                  exciseRate: 0,
                },
              ]

        // Başlık toplamları satırlarla birebir tutmadığında (tevkifat/avans mahsubu)
        // provider bir bilgilendirme notu döndürür; kullanıcı görsün diye notlara ekle.
        const reconcileNote: string =
          typeof data.model?.reconcileNote === "string" ? data.model.reconcileNote.trim() : ""
        const sourceNote =
          `Kaynak gelen e-fatura: ${data.invoiceNo || ""} (ETTN ${fromIncomingUuid})` +
          (reconcileNote ? `\n${reconcileNote}` : "")
        // Tedarikçinin gerçek fatura numarasını koru — POST endpoint'i body.invoiceNo
        // varsa kendi numarasını üretmiyor (generateInvoiceNumber fallback'i atlanıyor).
        const importedInvoiceNo = typeof data.invoiceNo === "string" ? data.invoiceNo.trim() : ""
        setFormData((prev) => ({
          ...prev,
          type: "PURCHASE",
          invoiceType: "MANUAL",
          invoiceNo: importedInvoiceNo || prev.invoiceNo,
          customerId: "",
          supplierId: matchedSupplier?.id || "",
          date: data.date
            ? new Date(data.date).toISOString().split("T")[0]
            : prev.date,
          currency: data.currency || prev.currency,
          notes: prev.notes && prev.notes.includes(sourceNote) ? prev.notes : sourceNote,
        }))
        setItems(newItems)
        setLineExtras(
          newItems.map((it) => {
            const extras: LineExtraKey[] = []
            if (it.description) extras.push("description")
            if ((it.discountRate || 0) > 0 || (it.discountAmount || 0) > 0) extras.push("discountRate")
            if ((it.withholdingRate || 0) > 0) extras.push("withholdingRate")
            if ((it.otherTaxRate || 0) > 0) extras.push("otherTaxRate")
            return extras
          }),
        )
      } catch (e: any) {
        setIncomingPrefillError(e?.message || "Pre-fill sırasında hata")
      }
    }

    prefill()
  }, [
    mode,
    fromIncomingUuid,
    companyId,
    suppliersLoaded,
    productsLoaded,
  ])

  const handleCreateSupplierFromIncoming = async () => {
    if (!incomingSupplierCandidate || !companyId) return
    setIsCreatingSupplier(true)
    try {
      const res = await fetch("/api/cari/suppliers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId,
          name: incomingSupplierCandidate.name || "(Mysoft Gönderici)",
          taxNumber: incomingSupplierCandidate.taxNumber,
          taxOffice: incomingSupplierCandidate.taxOffice,
          address: incomingSupplierCandidate.address,
          city: incomingSupplierCandidate.city,
          district: incomingSupplierCandidate.district,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Tedarikçi oluşturulamadı")
      // Önce suppliers state'ine yeni kaydı ekle, sonra supplierId set et.
      // Aksi halde Select option'da bulamadığı id'yi göstermez ve dropdown boş kalır.
      const newSupplier: Supplier = {
        id: data.id,
        name: data.name,
        taxNumber: data.taxNumber ?? null,
        taxOffice: data.taxOffice ?? null,
        address: data.address ?? null,
      }
      setSuppliers((prev) =>
        prev.some((s) => s.id === newSupplier.id) ? prev : [...prev, newSupplier],
      )
      setFormData((prev) => ({ ...prev, customerId: "", supplierId: newSupplier.id }))
      setIncomingSupplierCandidate(null)
      // Arkaplanda asıl listeyi de tazele (best effort)
      fetchSuppliers()
      toast({ title: "Tedarikçi oluşturuldu", description: newSupplier.name })
    } catch (e: any) {
      toast({
        title: "Tedarikçi oluşturulamadı",
        description: e?.message || "Bilinmeyen hata",
        variant: "destructive",
      })
    } finally {
      setIsCreatingSupplier(false)
    }
  }

  useEffect(() => {
    if (companySettings && !companySettings.isEDonusumEnabled) {
      setFormData((prev) => {
        const t = String(prev.invoiceType || "").toUpperCase()
        if (t === "E_INVOICE" || t === "E_ARCHIVE") return { ...prev, invoiceType: "MANUAL" }
        return prev
      })
    }
  }, [companySettings])

  // Müşteri/tedarikçi değiştiğinde VKN'yi GİB'den sorgula ve invoiceType'ı otomatik
  // güncelle. Bu sayede kullanıcının E-Arşiv/E-Fatura seçmesine gerek kalmaz.
  useEffect(() => {
    const isEDonusumEnabled = Boolean(companySettings?.isEDonusumEnabled)

    let counterpartyVkn: string | null = null
    if (formData.customerId) {
      const c = customers.find((x) => x.id === formData.customerId)
      counterpartyVkn = (c?.taxNumber || "").replace(/\D/g, "") || null
    } else if (formData.supplierId) {
      const s = suppliers.find((x) => x.id === formData.supplierId)
      counterpartyVkn = (s?.taxNumber || "").replace(/\D/g, "") || null
    }

    // Karşı taraf yoksa state'i sıfırla — type kullanıcı seçimine göre kalır.
    if (!counterpartyVkn) {
      setVknCheck({
        checking: false,
        isEInvoiceTaxpayer: null,
        suggestedInvoiceType: null,
        accountName: null,
        reason: null,
      })
      return
    }

    // E-Dönüşüm kapalıysa direkt MANUAL.
    if (!isEDonusumEnabled) {
      setVknCheck({
        checking: false,
        isEInvoiceTaxpayer: false,
        suggestedInvoiceType: "MANUAL",
        accountName: null,
        reason: "e-dönüşüm pasif",
      })
      setFormData((prev) => (prev.invoiceType === "MANUAL" ? prev : { ...prev, invoiceType: "MANUAL" }))
      return
    }

    // PURCHASE/RETURN için Mysoft gönderimi yok — kayıt amacıyla MANUAL kullanmak yeterli.
    if (formData.type !== "SALES") {
      setVknCheck({
        checking: false,
        isEInvoiceTaxpayer: null,
        suggestedInvoiceType: "MANUAL",
        accountName: null,
        reason: "alış/iade — e-belge gönderilmez",
      })
      setFormData((prev) => (prev.invoiceType === "MANUAL" ? prev : { ...prev, invoiceType: "MANUAL" }))
      return
    }

    if (!/^\d{10,11}$/.test(counterpartyVkn)) {
      setVknCheck({
        checking: false,
        isEInvoiceTaxpayer: false,
        suggestedInvoiceType: "E_ARCHIVE",
        accountName: null,
        reason: "geçersiz VKN/TCKN — varsayılan E-Arşiv",
      })
      setFormData((prev) => (prev.invoiceType === "E_ARCHIVE" ? prev : { ...prev, invoiceType: "E_ARCHIVE" }))
      return
    }

    setVknCheck((prev) => ({ ...prev, checking: true }))
    const ctrl = new AbortController()
    const url = `/api/e-donusum/check-vkn?companyId=${encodeURIComponent(
      companyId,
    )}&vkn=${encodeURIComponent(counterpartyVkn)}`
    fetch(url, { signal: ctrl.signal })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          setVknCheck({
            checking: false,
            isEInvoiceTaxpayer: false,
            suggestedInvoiceType: "E_ARCHIVE",
            accountName: null,
            reason: data.error || `HTTP ${res.status}`,
          })
          setFormData((prev) =>
            prev.invoiceType === "E_ARCHIVE" ? prev : { ...prev, invoiceType: "E_ARCHIVE" },
          )
          return
        }
        const suggested: "E_INVOICE" | "E_ARCHIVE" | "MANUAL" =
          data.suggestedInvoiceType === "E_INVOICE"
            ? "E_INVOICE"
            : data.suggestedInvoiceType === "MANUAL"
              ? "MANUAL"
              : "E_ARCHIVE"
        setVknCheck({
          checking: false,
          isEInvoiceTaxpayer: Boolean(data.isEInvoiceTaxpayer),
          suggestedInvoiceType: suggested,
          accountName: data.accountName || null,
          reason: data.reason || null,
        })
        setFormData((prev) => (prev.invoiceType === suggested ? prev : { ...prev, invoiceType: suggested }))
      })
      .catch((e: any) => {
        if (e?.name === "AbortError") return
        setVknCheck({
          checking: false,
          isEInvoiceTaxpayer: false,
          suggestedInvoiceType: "E_ARCHIVE",
          accountName: null,
          reason: e?.message || "VKN sorgu hatası",
        })
        setFormData((prev) =>
          prev.invoiceType === "E_ARCHIVE" ? prev : { ...prev, invoiceType: "E_ARCHIVE" },
        )
      })

    return () => ctrl.abort()
  }, [
    formData.customerId,
    formData.supplierId,
    formData.type,
    customers,
    suppliers,
    companySettings,
    companyId,
  ])

  const fetchCustomers = async () => {
    if (!companyId) return
    try {
      const res = await fetch(`/api/cari/customers?companyId=${companyId}`)
      if (res.ok) setCustomers(await res.json())
    } catch (e) { console.error("Error fetching customers:", e) }
  }

  const fetchSuppliers = async () => {
    if (!companyId) return
    try {
      const res = await fetch(`/api/cari/suppliers?companyId=${companyId}`)
      if (res.ok) setSuppliers(await res.json())
    } catch (e) { console.error("Error fetching suppliers:", e) }
    finally { setSuppliersLoaded(true) }
  }

  const fetchProducts = async () => {
    if (!companyId) return
    try {
      const res = await fetch(`/api/stok/products?companyId=${companyId}`)
      if (res.ok) setProducts(await res.json())
    } catch (e) { console.error("Error fetching products:", e) }
    finally { setProductsLoaded(true) }
  }

  const fetchCompanySettings = async () => {
    if (!companyId) return
    try {
     
      const res = await fetch(`/api/companies/${companyId}`)
      
      if (!res.ok) return
      
      // Artık listeden bulmamıza gerek yok, direkt o şirket geldi
      const current = await res.json()
      
      setCompanySettings(current)
      if (current && !current.isEDonusumEnabled) {
        setFormData((prev) => ({ ...prev, invoiceType: "MANUAL" }))
      }
    } catch (e) { 
      console.error("Error fetching company settings:", e) 
    }
  }

  const fetchInvoiceForEdit = async (id: string) => {
    try {
      setIsLoading(true)
      const res = await fetch(`/api/e-donusum/invoices/${id}?companyId=${companyId || ""}`)
      if (!res.ok) throw new Error("Fatura bilgisi alınamadı")
      const data = await res.json()
      if (data.status !== "DRAFT") throw new Error("Sadece taslak faturalar düzenlenebilir")

      setEditingInvoiceId(id)
      setFormData({
        type: data.type || "SALES",
        invoiceType: data.invoiceType || "MANUAL",
        invoiceNo: data.invoiceNo || "",
        customerId: data.customerId || "",
        supplierId: data.supplierId || "",
        date: data.date ? new Date(data.date).toISOString().split("T")[0] : new Date().toISOString().split("T")[0],
        dueDate: data.dueDate ? new Date(data.dueDate).toISOString().split("T")[0] : "",
        currency: data.currency || "TRY",
        exchangeRate: data.exchangeRate ? String(data.exchangeRate) : "",
        exchangeRateDate: data.exchangeRateDate ? new Date(data.exchangeRateDate).toISOString().split("T")[0] : "",
        notes: data.notes || "",
      })

      // Fatura altı iskonto: DB'de tutar olarak saklı; yüklerken AMOUNT modunda
      // doğrudan göster (yüzde olarak girilmişse de kullanıcı tekrar değiştirebilir).
      const savedGlobalDiscount = Number(data.globalDiscountAmount) || 0
      if (savedGlobalDiscount > 0) {
        setGlobalDiscountEnabled(true)
        setGlobalDiscountMode("AMOUNT")
        setGlobalDiscountInput(String(savedGlobalDiscount))
      } else {
        setGlobalDiscountEnabled(false)
        setGlobalDiscountInput("")
      }

      const editItems = Array.isArray(data.items)
        ? data.items.map((item: any) => {
            const discRate = Number(item.discountRate) || 0
            const discAmount = Number(item.discountAmount) || 0
            return {
              productId: item.productId || undefined,
              description: item.description || "",
              unit: (item.unit as string) || item.product?.unit || "ADET",
              quantity: Number(item.quantity) || 1,
              unitPrice: Number(item.unitPrice) || 0,
              discountRate: discRate,
              discountAmount: discAmount,
              discountMode: (discAmount > 0 && discRate === 0 ? "AMOUNT" : "PERCENT") as DiscountMode,
              vatRate: Number(item.vatRate) || 20,
              withholdingRate: Number(item.withholdingRate) || 0,
              withholdingCode: item.withholdingCode || undefined,
              withholdingName: item.withholdingName || undefined,
              exciseRate: Number(item.exciseRate) || 0,
              otherTaxRate: Number(item.otherTaxRate) || 0,
              otherTaxName: item.otherTaxName || undefined,
              taxExemptionReasonCode: item.taxExemptionReasonCode || undefined,
              taxExemptionReason: item.taxExemptionReason || undefined,
            }
          }) : []

      const finalItems: InvoiceItem[] = editItems.length > 0 ? editItems : [{ description: "", unit: "ADET", quantity: 1, unitPrice: 0, discountRate: 0, vatRate: 20, withholdingRate: 0, exciseRate: 0 }]
      setItems(finalItems)
      setLineExtras(finalItems.map((it) => {
        const extras: LineExtraKey[] = []
        if (it.description) extras.push("description")
        if ((it.discountRate || 0) > 0 || (it.discountAmount || 0) > 0) extras.push("discountRate")
        if ((it.withholdingRate || 0) > 0 || it.withholdingCode) extras.push("withholdingRate")
        if ((it.exciseRate || 0) > 0) extras.push("exciseRate")
        if ((it.otherTaxRate || 0) > 0) extras.push("otherTaxRate")
        return extras
      }))
    } catch (e: any) {
      toast({ title: "Hata", description: e.message, variant: "destructive" })
      goBack()
    } finally {
      setIsLoading(false)
      setBootstrappingEdit(false)
    }
  }

  // Mevcut bir faturadan KOPYA hazırla: kaynak faturanın tüm değerlerini
  // (cari, tip, kalemler, notlar) forma yükler AMA tarihi bugüne çeker, fatura
  // no'yu boşaltır ve editingInvoiceId set ETMEZ → kaydedince yeni bir TASLAK
  // oluşur (PUT değil POST). Hiçbir şey otomatik gönderilmez.
  const prefillFromInvoiceForDuplicate = async (id: string) => {
    try {
      setIsLoading(true)
      const res = await fetch(`/api/e-donusum/invoices/${id}?companyId=${companyId || ""}`)
      if (!res.ok) throw new Error("Kopyalanacak fatura bilgisi alınamadı")
      const data = await res.json()

      setFormData({
        type: data.type || "SALES",
        invoiceType: data.invoiceType || "MANUAL",
        invoiceNo: "", // kopyaya yeni numara üretilsin
        customerId: data.customerId || "",
        supplierId: data.supplierId || "",
        date: new Date().toISOString().split("T")[0], // güncel tarih
        dueDate: "", // vade kullanıcı tarafından yeniden girilsin
        currency: data.currency || "TRY",
        exchangeRate: data.exchangeRate ? String(data.exchangeRate) : "",
        exchangeRateDate: data.exchangeRateDate ? new Date(data.exchangeRateDate).toISOString().split("T")[0] : "",
        notes: data.notes || "",
      })

      const copiedItems: InvoiceItem[] = Array.isArray(data.items)
        ? data.items.map((item: any) => {
            const discRate = Number(item.discountRate) || 0
            const discAmount = Number(item.discountAmount) || 0
            return {
              productId: item.productId || undefined,
              description: item.description || "",
              unit: (item.unit as string) || item.product?.unit || "ADET",
              quantity: Number(item.quantity) || 1,
              unitPrice: Number(item.unitPrice) || 0,
              discountRate: discRate,
              discountAmount: discAmount,
              discountMode: (discAmount > 0 && discRate === 0 ? "AMOUNT" : "PERCENT") as DiscountMode,
              vatRate: Number(item.vatRate) || 20,
              withholdingRate: Number(item.withholdingRate) || 0,
              withholdingCode: item.withholdingCode || undefined,
              withholdingName: item.withholdingName || undefined,
              exciseRate: Number(item.exciseRate) || 0,
              otherTaxRate: Number(item.otherTaxRate) || 0,
              otherTaxName: item.otherTaxName || undefined,
              taxExemptionReasonCode: item.taxExemptionReasonCode || undefined,
              taxExemptionReason: item.taxExemptionReason || undefined,
            }
          })
        : []

      const finalItems: InvoiceItem[] =
        copiedItems.length > 0
          ? copiedItems
          : [{ description: "", unit: "ADET", quantity: 1, unitPrice: 0, discountRate: 0, vatRate: 20, withholdingRate: 0, exciseRate: 0 }]
      setItems(finalItems)
      setLineExtras(finalItems.map((it) => {
        const extras: LineExtraKey[] = []
        if (it.description) extras.push("description")
        if ((it.discountRate || 0) > 0 || (it.discountAmount || 0) > 0) extras.push("discountRate")
        if ((it.withholdingRate || 0) > 0 || it.withholdingCode) extras.push("withholdingRate")
        if ((it.exciseRate || 0) > 0) extras.push("exciseRate")
        if ((it.otherTaxRate || 0) > 0) extras.push("otherTaxRate")
        return extras
      }))

      toast({ title: "Kopya hazırlandı", description: "Güncel tarihli taslak. Kontrol edip kaydedin — otomatik gönderilmez." })
    } catch (e: any) {
      toast({ title: "Hata", description: e.message, variant: "destructive" })
    } finally {
      setIsLoading(false)
    }
  }

  // Kopya prefill tetikleyici: yalnızca create modunda, gelen e-fatura akışı
  // yokken ve bir kez.
  useEffect(() => {
    if (mode !== "create" || !duplicateFromId || fromIncomingUuid) return
    if (duplicatedRef.current) return
    duplicatedRef.current = true
    void prefillFromInvoiceForDuplicate(duplicateFromId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, duplicateFromId, fromIncomingUuid, companyId])

  // Önceki Fiyatları Getiren Fonksiyon
  const handleOpenPricesModal = async (index: number, productId: string | undefined) => {
    if (!productId) {
      toast({ title: "Uyarı", description: "Lütfen önce bir ürün seçin." })
      return
    }
    setActiveItemIndexForPrices(index)
    setActivePriceTab(formData.type === "PURCHASE" ? "purchases" : "sales")
    setIsPriceModalOpen(true)
    setIsPriceHistoryLoading(true)

    try {
      const qs = new URLSearchParams({ companyId })
      if (formData.type === "PURCHASE" && formData.supplierId) {
        qs.set("supplierId", formData.supplierId)
      } else if (formData.customerId) {
        qs.set("customerId", formData.customerId)
      }
      const res = await fetch(`/api/stok/products/${productId}/prices?${qs.toString()}`)
      if (res.ok) {
        const data = await res.json()
        setPriceHistory(data)
      }
    } catch (error) {
      console.error("Fiyat geçmişi çekilemedi:", error)
    } finally {
      setIsPriceHistoryLoading(false)
    }
  }

  // Modaldan fiyat seçilip satıra uygulanması
  const applyPriceToLine = (price: number) => {
    if (activeItemIndexForPrices !== null) {
      updateItem(activeItemIndexForPrices, "unitPrice", price)
      setIsPriceModalOpen(false)
    }
  }

  const addItem = () => {
    setItems([...items, { description: "", unit: "ADET", quantity: 1, unitPrice: 0, discountRate: 0, vatRate: 20, withholdingRate: 0, exciseRate: 0 }])
    setLineExtras((prev) => [...prev, []])
  }

  const removeItem = (index: number) => {
    if (items.length > 1) {
      setItems(items.filter((_, i) => i !== index))
      setLineExtras((prev) => prev.filter((_, i) => i !== index))
    }
  }

  const updateItem = (index: number, field: keyof InvoiceItem, value: any) => {
    const newItems = [...items]
    newItems[index] = { ...newItems[index], [field]: value }
    // KDV oranı 0 dışı bir değere geçildiyse istisna alanlarını temizle
    if (field === "vatRate" && Number(value) !== 0) {
      newItems[index].taxExemptionReasonCode = undefined
      newItems[index].taxExemptionReason = undefined
    }
    setItems(newItems)
  }

  // Tevkifat kodu seçimi: ad ve oran koddan otomatik gelir. Kod 650 ("diğer")
  // oranı serbesttir; o satırda oran kullanıcı tarafından girilir.
  const applyWithholdingCode = (index: number, code: string) => {
    setItems((prev) =>
      prev.map((it, i) => {
        if (i !== index) return it
        if (!code) return { ...it, withholdingCode: "", withholdingName: "", withholdingRate: 0 }
        const w = withholdingTypes.find((t) => t.code === code)
        return {
          ...it,
          withholdingCode: code,
          withholdingName: w?.name || "",
          withholdingRate: code === "650" ? (it.withholdingRate || 0) : (w?.rate || 0),
        }
      }),
    )
  }

  const getLineExtras = (index: number): LineExtraKey[] => lineExtras[index] || []
  const addLineExtra = (index: number, key: LineExtraKey) => {
    setLineExtras((prev) => {
      const next = prev.map((arr, i) => (i === index ? [...arr, key] : arr))
      while (next.length < items.length) next.push([])
      return next
    })
  }

  const removeLineExtra = (index: number, key: LineExtraKey) => {
    setLineExtras((prev) => prev.map((arr, i) => (i === index ? arr.filter((k) => k !== key) : arr)))
    if (key === "description") updateItem(index, "description", "")
    if (key === "discountRate") {
      updateItem(index, "discountRate", 0)
      updateItem(index, "discountAmount", 0)
    }
    if (key === "withholdingRate") {
      setItems((prev) =>
        prev.map((it, i) =>
          i === index ? { ...it, withholdingRate: 0, withholdingCode: "", withholdingName: "" } : it,
        ),
      )
    }
    if (key === "exciseRate") updateItem(index, "exciseRate", 0)
    if (key === "otherTaxRate") {
      setItems((prev) =>
        prev.map((it, i) =>
          i === index ? { ...it, otherTaxRate: 0, otherTaxName: undefined } : it,
        ),
      )
    }
  }

  const setDiscountMode = (index: number, mode: DiscountMode) => {
    setItems((prev) =>
      prev.map((it, i) => {
        if (i !== index) return it
        // Mod değişirken karşı alanı sıfırla — yalnız aktif olan dolu kalsın.
        return mode === "PERCENT"
          ? { ...it, discountMode: "PERCENT", discountAmount: 0 }
          : { ...it, discountMode: "AMOUNT", discountRate: 0 }
      }),
    )
  }

  const applyProductToLine = (index: number, product: Product) => {
    const newItems = [...items]
    const prev = newItems[index]
    const prevDesc = (prev.description || "").trim()
    // Kullanıcı bir ürün seçtiğinde description'ı ürün adıyla doldur. Aksi halde
    // DB'ye ve Mysoft XML'ine boş "productName" gider; detay sayfasında "-" görünür.
    // Daha önce yazılmış özel bir satır notu varsa ve başka bir ürünün adı değilse korunur.
    const isPreviousAutoName =
      prevDesc === "" || products.some((p) => p.name === prev.description)
    newItems[index] = {
      ...prev,
      productId: product.id,
      description: isPreviousAutoName ? product.name : prev.description,
      unit: (product.unit || "ADET").toUpperCase(),
      unitPrice: Number(product.salePrice) || 0,
      discountRate: 0,
      vatRate: Number(product.vatRate) || 20,
      withholdingRate: 0,
      exciseRate: 0,
      // Alış faturasında ürünün satış fiyatı satır üzerinden güncellenebilsin diye
      // mevcut satış fiyatını ön-doldur. Sadece PURCHASE tipinde UI'da gösterilir.
      salePrice: product.salePrice != null ? Number(product.salePrice) : undefined,
    }
    setItems(newItems)
  }

  const mergeProductIntoList = (product: Product) => {
    setProducts((prev) => (prev.some((p) => p.id === product.id) ? prev : [product, ...prev]))
  }

  const computeItemDiscount = (item: InvoiceItem, itemGross: number) => {
    // Mod açıkça AMOUNT ise tutar; PERCENT ise oran. Eski faturalar için (mod yok)
    // discountAmount > 0 ise AMOUNT, aksi halde discountRate üzerinden hesaplanır.
    const mode: DiscountMode =
      item.discountMode ?? (Number(item.discountAmount || 0) > 0 ? "AMOUNT" : "PERCENT")
    if (mode === "AMOUNT") {
      const raw = Number(item.discountAmount || 0)
      // Negatif veya brüt-aşan tutarı normalize et — net sıfırın altına düşmesin.
      return Math.max(0, Math.min(raw, itemGross))
    }
    const rate = Number(item.discountRate || 0)
    return itemGross * (rate / 100)
  }

  // Bir satırın KDV DAHİL toplamı (iskonto, ÖTV, tevkifat dahil). Hem "Tutar"
  // kolonunu göstermek hem de tersine birim fiyat hesaplamak için kullanılır.
  const computeItemTotal = (item: InvoiceItem) => {
    const gross = (Number(item.quantity) || 0) * (Number(item.unitPrice) || 0)
    const net = gross - computeItemDiscount(item, gross)
    const vat = net * (Number(item.vatRate) || 0) / 100
    const excise = net * (Number(item.exciseRate) || 0) / 100
    const otherTax = net * (Number(item.otherTaxRate) || 0) / 100
    const withholding = vat * (Number(item.withholdingRate) || 0) / 100
    return net + vat + excise + otherTax - withholding
  }

  // Kullanıcı "Tutar" (KDV dahil) alanına doğrudan değer yazınca, o toplamı miktara
  // ve KDV/ÖTV/tevkifat/iskontoya göre geriye çözüp birim fiyatı otomatik günceller.
  const setLineTotal = (index: number, rawValue: string) => {
    const item = items[index]
    if (!item) return
    const quantity = Number(item.quantity) || 0
    const desiredTotal = parseFloat(String(rawValue).replace(",", "."))
    if (quantity <= 0 || !Number.isFinite(desiredTotal) || desiredTotal < 0) return

    const vatRate = Number(item.vatRate) || 0
    const exciseRate = Number(item.exciseRate) || 0
    const otherTaxRate = Number(item.otherTaxRate) || 0
    const withholdingRate = Number(item.withholdingRate) || 0
    // total = net * (1 + kdv + ötv + diğer vergi - kdv*tevkifat)
    const factor = 1 + vatRate / 100 + exciseRate / 100 + otherTaxRate / 100 - (vatRate / 100) * (withholdingRate / 100)
    if (factor <= 0) return
    const net = desiredTotal / factor

    // net = gross - iskonto  → gross'u (dolayısıyla birim fiyatı) geri çöz.
    const mode: DiscountMode =
      item.discountMode ?? (Number(item.discountAmount || 0) > 0 ? "AMOUNT" : "PERCENT")
    let gross: number
    if (mode === "AMOUNT") {
      gross = net + Number(item.discountAmount || 0)
    } else {
      const keep = 1 - Number(item.discountRate || 0) / 100
      if (keep <= 0) return
      gross = net / keep
    }

    const unitPrice = gross / quantity
    if (!Number.isFinite(unitPrice) || unitPrice < 0) return
    // UBL standardı: birim fiyat 6 ondalığa kadar.
    updateItem(index, "unitPrice", Math.round(unitPrice * 1e6) / 1e6)
  }

  const calculateTotals = () => {
    let netAmount = 0, discountAmount = 0, vatAmount = 0, withholdingAmount = 0, exciseAmount = 0, otherTaxAmount = 0
    items.forEach((item) => {
      const itemGross = item.quantity * item.unitPrice
      const itemDiscount = computeItemDiscount(item, itemGross)
      const itemNet = itemGross - itemDiscount
      const itemVat = itemNet * (item.vatRate / 100)
      // KDV tevkifatı: tevkif edilen tutar KDV üzerinden hesaplanır (matrah değil).
      const itemWithholding = itemVat * ((item.withholdingRate || 0) / 100)
      const itemExcise = itemNet * ((item.exciseRate || 0) / 100)
      const itemOtherTax = itemNet * ((item.otherTaxRate || 0) / 100)
      netAmount += itemNet; discountAmount += itemDiscount; vatAmount += itemVat; withholdingAmount += itemWithholding; exciseAmount += itemExcise; otherTaxAmount += itemOtherTax
    })

    // Fatura altı iskonto: kullanıcının girdiği değeri tutara çevir, KDV matrahını
    // oransal olarak düşür, vat/withholding/excise/diğer vergi'yi yeniden hesapla.
    const rawGlobal = parseFloat(globalDiscountInput) || 0
    const globalDiscount = !globalDiscountEnabled || rawGlobal <= 0 || netAmount <= 0
      ? 0
      : globalDiscountMode === "AMOUNT"
        ? Math.max(0, Math.min(rawGlobal, netAmount))
        : Math.max(0, Math.min(netAmount * (rawGlobal / 100), netAmount))

    const ratio = netAmount > 0 ? globalDiscount / netAmount : 0
    const adjNet = netAmount - globalDiscount
    const adjVat = vatAmount * (1 - ratio)
    const adjWithholding = withholdingAmount * (1 - ratio)
    const adjExcise = exciseAmount * (1 - ratio)
    const adjOtherTax = otherTaxAmount * (1 - ratio)
    const totalAmount = adjNet + adjVat + adjExcise + adjOtherTax - adjWithholding

    return {
      netAmount: adjNet,
      grossNetAmount: netAmount, // global iskonto öncesi ara toplam (gösterim için)
      discountAmount,
      globalDiscount,
      vatAmount: adjVat,
      withholdingAmount: adjWithholding,
      exciseAmount: adjExcise,
      otherTaxAmount: adjOtherTax,
      totalAmount,
    }
  }

  const resetForm = () => {
    setEditingInvoiceId(null)
    setFormData({ type: "SALES", invoiceType: companySettings?.isEDonusumEnabled ? "E_ARCHIVE" : "MANUAL", invoiceNo: "", customerId: "", supplierId: "", date: new Date().toISOString().split("T")[0], dueDate: "", currency: "TRY", exchangeRate: "", exchangeRateDate: "", notes: "" })
    setItems([{ description: "", unit: "ADET", quantity: 1, unitPrice: 0, discountRate: 0, vatRate: 20, withholdingRate: 0, exciseRate: 0 }])
    setLineExtras([[]])
    setGlobalDiscountEnabled(false)
    setGlobalDiscountInput("")
    setGlobalDiscountMode("PERCENT")
  }

  const isEDonusumActive = Boolean(companySettings?.isEDonusumEnabled)
  const effectiveInvoiceType = useMemo(() => {
    const t = String(formData.invoiceType || "").toUpperCase()
    if (E_DOC_TYPES.has(t) && !isEDonusumActive) return "MANUAL"
    return t || "MANUAL"
  }, [formData.invoiceType, isEDonusumActive])

  const eInvoiceMissingMessages = useMemo(() => {
    if (!isEDonusumActive) return [] as string[]
    if (!E_DOC_TYPES.has(effectiveInvoiceType)) return [] as string[]
    const messages: string[] = []
    const co = companySettings
    if (!co?.taxNumber?.trim()) messages.push("Firma VKN/TCKN eksik")
    if (!co?.taxOffice?.trim()) messages.push("Firma vergi dairesi eksik")
    if (!co?.address?.trim()) messages.push("Firma adresi eksik")

    if (formData.customerId) {
      const cu = customers.find((c) => c.id === formData.customerId)
      if (cu) {
        if (!cu.taxNumber?.trim()) messages.push("Müşteri vergi numarası eksik")
        if (!cu.taxOffice?.trim()) messages.push("Müşteri vergi dairesi eksik")
        if (!cu.address?.trim()) messages.push("Müşteri adresi eksik")
      }
    } else if (formData.supplierId) {
      const su = suppliers.find((s) => s.id === formData.supplierId)
      if (su) {
        if (!su.taxNumber?.trim()) messages.push("Tedarikçi vergi numarası eksik")
        if (!su.taxOffice?.trim()) messages.push("Tedarikçi vergi dairesi eksik")
        if (!su.address?.trim()) messages.push("Tedarikçi adresi eksik")
      }
    }
    return Array.from(new Set(messages))
  }, [isEDonusumActive, effectiveInvoiceType, formData.customerId, formData.supplierId, companySettings, customers, suppliers])

  // Eksik alanların kaynağını ayır: firma bilgisi eksikse firma ayarlarına,
  // cari (müşteri/tedarikçi) bilgisi eksikse ilgili carinin düzenleme sayfasına yönlendir.
  const hasCompanyMissing = eInvoiceMissingMessages.some((m) => m.startsWith("Firma"))
  const hasCounterpartyMissing = eInvoiceMissingMessages.some(
    (m) => m.startsWith("Müşteri") || m.startsWith("Tedarikçi"),
  )
  const counterpartyEditHref = useMemo(() => {
    const company = encodeURIComponent(companyId)
    if (formData.customerId) return `/cari/customers/${formData.customerId}/edit?company=${company}`
    if (formData.supplierId) return `/cari/suppliers/${formData.supplierId}/edit?company=${company}`
    return null
  }, [formData.customerId, formData.supplierId, companyId])

  // GİB formatı taslak önizleme (kaydetmeden). preview-pdf endpoint'i canlı
  // formdan GİB düzeninde "TASLAK" filigranlı PDF üretir; iframe'de gösteririz.
  const buildPreviewPayload = () => ({
    companyId,
    type: formData.type,
    invoiceType: effectiveInvoiceType,
    invoiceNo: formData.invoiceNo,
    customerId: formData.customerId,
    supplierId: formData.supplierId,
    date: formData.date,
    dueDate: formData.dueDate,
    currency: formData.currency,
    notes: formData.notes,
    items,
    globalDiscountAmount: totals.globalDiscount > 0 ? totals.globalDiscount : 0,
  })

  const handlePreview = async () => {
    const meaningful = items.some(
      (it) => it.productId || (Number(it.quantity) || 0) > 0 || (Number(it.unitPrice) || 0) > 0 || it.description?.trim(),
    )
    if (!meaningful) {
      return toast({ title: "Önizleme için kalem gerekli", description: "En az bir fatura kalemi girin", variant: "destructive" })
    }
    setIsPreviewLoading(true)
    try {
      const res = await fetch("/api/e-donusum/invoices/preview-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPreviewPayload()),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || "Önizleme oluşturulamadı")
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      setPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev)
        return url
      })
      setIsPreviewOpen(true)
    } catch (e: any) {
      toast({ title: "Önizleme başarısız", description: e?.message || "Bir hata oluştu", variant: "destructive" })
    } finally {
      setIsPreviewLoading(false)
    }
  }

  const handleDownloadPreview = () => {
    if (!previewUrl) return
    const a = document.createElement("a")
    a.href = previewUrl
    a.download = `taslak-fatura${formData.invoiceNo ? "-" + formData.invoiceNo : ""}.pdf`
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  const handleSubmit = async () => {
    if (items.length === 0) return toast({ title: "Hata", description: "En az bir kalem ekleyin", variant: "destructive" })
    if (!formData.customerId && !formData.supplierId) return toast({ title: "Hata", description: "Müşteri veya tedarikçi seçin", variant: "destructive" })
    if (isEDonusumActive && E_DOC_TYPES.has(effectiveInvoiceType) && eInvoiceMissingMessages.length > 0) return toast({ title: "E-fatura için eksik bilgi", description: eInvoiceMissingMessages.join(" · "), variant: "destructive" })

    // KDV %0 olan kalemlerde istisna sebebi zorunlu (Şematron kuralı)
    const isEDocument = E_DOC_TYPES.has(effectiveInvoiceType)
    if (isEDocument) {
      const missingExemption = items.findIndex((it) => Number(it.vatRate) === 0 && (!it.taxExemptionReasonCode || !it.taxExemptionReason?.trim()))
      if (missingExemption >= 0) {
        return toast({
          title: "İstisna sebebi gerekli",
          description: `${missingExemption + 1}. kalem KDV %0 — istisna kodu ve sebebi zorunlu.`,
          variant: "destructive",
        })
      }
    }

    setIsLoading(true)
    try {
      const isEditing = Boolean(editingInvoiceId)
      // sendInvoice: false → fatura DRAFT olarak kaydedilir. Mysoft'a göndermek
      // için kullanıcı önizleme sayfasındaki "Mysoft'a Gönder" butonuna basar.
      // Bu sayede kesilen her fatura önce gözden geçirilir, sonra GİB'e gider.
      const response = await fetch(isEditing ? `/api/e-donusum/invoices/${editingInvoiceId}` : "/api/e-donusum/invoices", {
        method: isEditing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId,
          ...formData,
          invoiceType: effectiveInvoiceType,
          items,
          globalDiscountAmount: totals.globalDiscount > 0 ? totals.globalDiscount : 0,
          sendInvoice: false,
          ...(fromIncomingUuid && !isEditing ? { fromIncomingUuid } : {}),
        }),
      })

      if (response.ok) {
        const saved = await response.json().catch(() => null)
        const savedId: string | undefined = saved?.id || editingInvoiceId
        toast({ title: "Başarılı", description: isEditing ? "Fatura güncellendi" : "Fatura oluşturuldu" })
        resetForm()
        if (savedId) {
          router.push(`/faturalar/${savedId}/onizleme?company=${encodeURIComponent(companyId)}`)
        } else {
          router.push(listHref)
        }
      } else {
        const data = await response.json()
        throw new Error(data.error || "Oluşturulamadı")
      }
    } catch (error: any) {
      toast({ title: "Hata", description: error.message || "Bir hata oluştu", variant: "destructive" })
    } finally {
      setIsLoading(false)
    }
  }

  const totals = calculateTotals()
  const isEditMode = mode === "edit" && editingInvoiceId

  if (bootstrappingEdit) return <div className="flex items-center justify-center p-12 text-muted-foreground">Fatura yükleniyor…</div>

  return (
    <>
      <Card className="w-full min-w-0">
        <CardContent className="space-y-8 pt-6">

          <div className="flex flex-wrap justify-end gap-3">
            <Button onClick={handlePreview} disabled={isPreviewLoading || isLoading} variant="outline">
              {isPreviewLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Eye className="mr-2 h-4 w-4" />}
              Önizle (GİB)
            </Button>
            <Button onClick={handleSubmit} disabled={isLoading} variant="success">
              {isLoading ? editingInvoiceId ? "Güncelleniyor..." : "Kaydediliyor..." : editingInvoiceId ? "Faturayı Güncelle" : "Taslak Olarak Kaydet"}
            </Button>
          </div>

          {/* GELEN E-FATURADAN DÖNÜŞTÜRME BANNER'I */}
          {fromIncomingUuid && (
            <div className="rounded-md border border-sky-300 bg-sky-50 p-4 text-sm text-sky-950">
              <p className="font-semibold">Gelen e-faturadan alış faturasına dönüştürülüyor</p>
              <p className="mt-1 text-xs text-sky-900/80">
                Kalemler ve tutarlar Mysoft'tan otomatik dolduruldu. Gerekirse düzenleyip kaydedin.
                Kayıt sonrası stok ve cari bakiyeniz güncellenir.
              </p>
              {incomingPrefillError && (
                <p className="mt-2 text-amber-900">
                  Pre-fill uyarısı: {incomingPrefillError}
                </p>
              )}
              {incomingSupplierCandidate && (
                <div className="mt-3 flex flex-wrap items-center gap-2 rounded border border-amber-300 bg-amber-50 p-3 text-amber-950">
                  <span className="text-xs">
                    Tedarikçi VKN <span className="font-mono">{incomingSupplierCandidate.taxNumber || "-"}</span>
                    {" "}({incomingSupplierCandidate.name || "isimsiz"}) sistemde yok.
                  </span>
                  <Button
                    size="sm"
                    onClick={handleCreateSupplierFromIncoming}
                    disabled={isCreatingSupplier}
                  >
                    {isCreatingSupplier ? "Oluşturuluyor..." : "Tedarikçiyi oluştur ve seç"}
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* HATA MESAJLARI BÖLÜMÜ */}
          {isEDonusumActive && E_DOC_TYPES.has(effectiveInvoiceType) && eInvoiceMissingMessages.length > 0 && (
            <div role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
              <p className="font-semibold">E-fatura / E-arşiv için eksik alanlar</p>
              <ul className="mt-2 list-inside list-disc space-y-1">
                {eInvoiceMissingMessages.map((m) => (<li key={m}>{m}</li>))}
              </ul>
              <div className="mt-3 flex flex-wrap gap-2">
                {hasCompanyMissing && (
                  <Button variant="outline" size="sm" asChild><Link href={`/ayarlar/firma?company=${encodeURIComponent(companyId)}`}>Firma ayarları</Link></Button>
                )}
                {hasCounterpartyMissing && counterpartyEditHref && (
                  <Button variant="outline" size="sm" asChild><Link href={counterpartyEditHref}>Cariyi düzenle</Link></Button>
                )}
              </div>
            </div>
          )}

          {/* --- 2 SÜTUNLU ÜST BÖLÜM --- */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Fatura Tipi</Label>
                <Select value={formData.type} onValueChange={(value) => setFormData({ ...formData, type: value })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="SALES">Satış Faturası</SelectItem>
                    <SelectItem value="PURCHASE">Alış Faturası</SelectItem>
                    <SelectItem value="RETURN">İade Faturası</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              <div className="space-y-2">
                <Label>Belge Türü</Label>
                {(() => {
                  const type = effectiveInvoiceType
                  const checking = vknCheck.checking
                  const baseLabel =
                    type === "E_INVOICE"
                      ? "E-Fatura"
                      : type === "E_ARCHIVE"
                        ? "E-Arşiv"
                        : "Manuel"
                  const cls =
                    type === "E_INVOICE"
                      ? "border-sky-300 bg-sky-50 text-sky-900 dark:bg-sky-500/15 dark:text-sky-300"
                      : type === "E_ARCHIVE"
                        ? "border-emerald-300 bg-emerald-50 text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-300"
                        : "border-slate-300 bg-slate-50 text-slate-800 dark:bg-slate-500/15 dark:text-slate-300"
                  return (
                    <div
                      className={`flex flex-col gap-1 rounded-md border px-3 py-2 text-sm ${cls}`}
                    >
                      <div className="flex items-center gap-2 font-medium">
                        {checking ? "Sorgulanıyor..." : baseLabel}
                      </div>
                      <div className="text-xs opacity-80">
                        {!formData.customerId && !formData.supplierId
                          ? "Müşteri/tedarikçi seçilince otomatik belirlenir"
                          : vknCheck.checking
                            ? "VKN GİB'de kontrol ediliyor..."
                            : type === "E_INVOICE"
                              ? "Alıcı E-Fatura mükellefi — Mysoft'a E-Fatura olarak gönderilir"
                              : type === "E_ARCHIVE"
                                ? vknCheck.reason
                                  ? vknCheck.reason
                                  : "Alıcı E-Fatura mükellefi değil — E-Arşiv kesilir"
                                : vknCheck.reason
                                  ? vknCheck.reason
                                  : "Sistemde otomatik gönderim yok"}
                      </div>
                    </div>
                  )
                })()}
              </div>

              <div className="space-y-2">
                <Label>Müşteri / Tedarikçi</Label>
                <CounterpartyCombobox
                  customers={customers}
                  suppliers={suppliers}
                  selectedCustomerId={formData.customerId || undefined}
                  selectedSupplierId={formData.supplierId || undefined}
                  companyId={companyId}
                  defaultCreateKind={formData.type === "PURCHASE" ? "supplier" : "customer"}
                  onCreated={(created, kind) => {
                    if (kind === "customer") {
                      const c: Customer = {
                        id: created.id,
                        name: created.name,
                        taxNumber: created.taxNumber ?? null,
                        taxOffice: created.taxOffice ?? null,
                        address: created.address ?? null,
                      }
                      setCustomers((prev) => (prev.some((x) => x.id === c.id) ? prev : [c, ...prev]))
                      setFormData((prev) => ({ ...prev, customerId: created.id, supplierId: "" }))
                    } else {
                      const s: Supplier = {
                        id: created.id,
                        name: created.name,
                        taxNumber: created.taxNumber ?? null,
                        taxOffice: created.taxOffice ?? null,
                        address: created.address ?? null,
                      }
                      setSuppliers((prev) => (prev.some((x) => x.id === s.id) ? prev : [s, ...prev]))
                      setFormData((prev) => ({ ...prev, supplierId: created.id, customerId: "" }))
                    }
                  }}
                  onSelect={(sel) => {
                    if (!sel) {
                      setFormData({ ...formData, customerId: "", supplierId: "" })
                    } else if (sel.kind === "customer") {
                      setFormData({ ...formData, customerId: sel.id, supplierId: "" })
                    } else {
                      setFormData({ ...formData, customerId: "", supplierId: sel.id })
                    }
                  }}
                />
              </div>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Fatura Tarihi</Label>
                <Input type="date" value={formData.date} onChange={(e) => setFormData({ ...formData, date: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Vade Tarihi</Label>
                <Input type="date" value={formData.dueDate} onChange={(e) => setFormData({ ...formData, dueDate: e.target.value })} />
              </div>
            </div>
          </div>

          {/* --- FATURA KALEMLERİ (TABLO GÖRÜNÜMÜ) --- */}
          {/* --- FATURA KALEMLERİ (KUSURSUZ RESPONSIVE YAPI) --- */}
          <div className="space-y-3">
            <Label className="text-base font-semibold">Fatura Kalemleri</Label>

            <div className="w-full min-w-0 rounded-xl border border-slate-200 overflow-hidden shadow-sm bg-slate-50/30">
              
              {/* --- MASAÜSTÜ BAŞLIKLAR (Mobilde tamamen gizlenir) --- */}
              <div 
                className="hidden md:grid grid-cols-12 gap-2 p-3 font-semibold text-sm items-center" 
                style={{ backgroundColor: BRAND_COLOR, color: "white" }}
              >
                <div className={`${formData.type === "PURCHASE" ? "col-span-3" : "col-span-4"} pl-1`}>Ürün / Hizmet</div>
                <div className="col-span-1">Birim</div>
                <div className="col-span-1 text-center">Miktar</div>
                <div className="col-span-2 text-right pr-2">Birim Fiyat</div>
                <div className="col-span-1 text-center">KDV %</div>
                {formData.type === "PURCHASE" && <div className="col-span-1 text-right">Satış Fiyatı</div>}
                <div className="col-span-2 text-right">Tutar</div>
                <div className="col-span-1 text-center">İşlem</div>
              </div>

              {/* --- KALEMLER LİSTESİ --- */}
              <div className="flex flex-col md:divide-y md:divide-gray-200 p-2 md:p-0 gap-3 md:gap-0">
                {items.map((item, index) => {
                  const extras = getLineExtras(index)
                  const available = LINE_EXTRA_ORDER.filter((k) => !extras.includes(k))
                  
                  return (
                    <div 
                      key={index} 
                      // Mobilde: Gölgesi olan şık bir KART. Masaüstünde: Gölgesiz, kenarlıksız düz bir SATIR.
                      className="p-4 md:p-3 bg-white hover:bg-slate-50/80 transition-all rounded-xl md:rounded-none border border-slate-200 md:border-0 shadow-sm md:shadow-none"
                    >
                      {/* 12 KOLONLU ANA GRID (Mobilde ve PC'de Ortak) */}
                      <div className="grid grid-cols-12 gap-y-4 gap-x-3 md:gap-x-2 md:items-start">
                        
                        {/* 1. ÜRÜN */}
                        <div className={`col-span-12 ${formData.type === "PURCHASE" ? "md:col-span-3" : "md:col-span-4"}`}>
                          <Label className="md:hidden text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block">Ürün / Hizmet</Label>
                          <ProductCombobox
                            companyId={companyId}
                            products={products}
                            selectedProductId={item.productId}
                            selectedLabel={item.description}
                            defaults={
                              formData.type === "PURCHASE"
                                ? { unit: item.unit, vatRate: item.vatRate, purchasePrice: item.unitPrice }
                                : { unit: item.unit, vatRate: item.vatRate, salePrice: item.unitPrice }
                            }
                            priceContext={formData.type === "PURCHASE" ? "purchase" : "sale"}
                            onSelect={(p) => { mergeProductIntoList(p as Product); applyProductToLine(index, p as Product) }}
                            onClearBinding={() => updateItem(index, "productId", undefined)}
                          />
                        </div>

                        {/* 2. BİRİM */}
                        <div className="col-span-4 md:col-span-1">
                          <Label className="md:hidden text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block">Birim</Label>
                          <Select value={(item.unit || "ADET").toUpperCase()} onValueChange={(v) => updateItem(index, "unit", v)}>
                            <SelectTrigger className="w-full font-medium"><SelectValue /></SelectTrigger>
                            <SelectContent>{INVOICE_UNIT_OPTIONS.map((u) => (<SelectItem key={u} value={u}>{u}</SelectItem>))}</SelectContent>
                          </Select>
                        </div>

                        {/* 3. MİKTAR */}
                        <div className="col-span-4 md:col-span-1">
                          <Label className="md:hidden text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block">Miktar</Label>
                          <Input type="number" min="0" step="0.01" className="md:text-center font-medium" value={item.quantity || ""} onChange={(e) => updateItem(index, "quantity", e.target.value === "" ? 0 : parseFloat(e.target.value) || 0)} onFocus={(e) => (e.target as HTMLInputElement).select()} />
                        </div>

                        {/* 4. FİYAT VE GEÇMİŞ LİNKİ */}
                        <div className="col-span-4 md:col-span-2">
                          <Label className="md:hidden text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block">Birim Fiyat</Label>
                          <Input type="number" min="0" step="any" className="text-right font-medium" value={item.unitPrice || ""} onChange={(e) => updateItem(index, "unitPrice", e.target.value === "" ? 0 : parseFloat(e.target.value) || 0)} onFocus={(e) => (e.target as HTMLInputElement).select()} title="6 ondalık basamağa kadar girilebilir (UBL standardı)" />
                          <div className="flex justify-end mt-1.5">
                            <button
                              type="button"
                              className="text-[11px] font-semibold text-[#48c79c] hover:text-[#38a37f] transition-colors flex items-center"
                              onClick={() => handleOpenPricesModal(index, item.productId)}
                              disabled={!item.productId}
                            >
                              <Clock className="w-3 h-3 mr-1" /> geçmiş
                            </button>
                          </div>
                        </div>

                        {/* 5. KDV */}
                        <div className="col-span-4 md:col-span-1">
                          <Label className="md:hidden text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block">KDV %</Label>
                          <Select value={String(item.vatRate)} onValueChange={(v) => updateItem(index, "vatRate", parseFloat(v))}>
                            <SelectTrigger className="w-full md:text-center font-medium"><SelectValue /></SelectTrigger>
                            <SelectContent><SelectItem value="0">%0</SelectItem><SelectItem value="1">%1</SelectItem><SelectItem value="8">%8</SelectItem><SelectItem value="10">%10</SelectItem><SelectItem value="18">%18</SelectItem><SelectItem value="20">%20</SelectItem></SelectContent>
                          </Select>
                        </div>

                        {/* 5b. SATIŞ FİYATI (yalnızca alış faturasında — ürünün satış fiyatını günceller) */}
                        {formData.type === "PURCHASE" && (
                          <div className="col-span-4 md:col-span-1">
                            <Label className="md:hidden text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block">Satış Fiyatı</Label>
                            <Input
                              type="number"
                              min="0"
                              step="0.01"
                              className="text-right font-medium"
                              value={item.salePrice ?? ""}
                              onChange={(e) => updateItem(index, "salePrice", e.target.value === "" ? undefined : parseFloat(e.target.value) || 0)}
                              onFocus={(e) => (e.target as HTMLInputElement).select()}
                              disabled={!item.productId}
                              placeholder="(opsiyonel)"
                              title="Ürünün satış fiyatını güncelle"
                            />
                          </div>
                        )}

                        {/* 6. TUTAR (KDV dahil — düzenlenebilir; birim fiyatı geriye hesaplar) */}
                        <div className="col-span-8 md:col-span-2">
                          <Label className="md:hidden text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block">Toplam Tutar (KDV dahil)</Label>
                          <div className="relative">
                            <span
                              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm font-bold"
                              style={{ color: BRAND_COLOR }}
                            >
                              ₺
                            </span>
                            <Input
                              type="number"
                              min="0"
                              step="any"
                              inputMode="decimal"
                              className="h-10 pl-6 text-right font-bold tabular-nums text-[15px] md:text-sm"
                              style={{ color: BRAND_COLOR }}
                              value={
                                editingTotalIndex === index
                                  ? editingTotalValue
                                  : String(Math.round(computeItemTotal(item) * 100) / 100)
                              }
                              onFocus={(e) => {
                                setEditingTotalIndex(index)
                                setEditingTotalValue(String(Math.round(computeItemTotal(item) * 100) / 100))
                                ;(e.target as HTMLInputElement).select()
                              }}
                              onChange={(e) => {
                                setEditingTotalValue(e.target.value)
                                setLineTotal(index, e.target.value)
                              }}
                              onBlur={() => setEditingTotalIndex(null)}
                              title="KDV dahil tutarı yazın; birim fiyat miktara göre otomatik hesaplanır"
                            />
                          </div>
                        </div>

                        {/* 7. İŞLEMLER */}
                        <div className="col-span-12 md:col-span-1 flex items-center justify-between md:justify-center pt-3 md:pt-0 border-t md:border-0 mt-1 md:mt-0 border-slate-100">
                          <span className="md:hidden text-[10px] font-bold text-slate-400 uppercase tracking-widest">İşlemler</span>
                          <div className="flex gap-2 md:gap-1">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild><Button type="button" variant="outline" size="icon" className="h-9 w-9 border-slate-200" disabled={available.length === 0} title="Satır Eklentisi (İskonto, ÖTV vb)"><Plus className="h-4 w-4 text-slate-500" /></Button></DropdownMenuTrigger>
                              <DropdownMenuContent align="end">{available.map((key) => (<DropdownMenuItem key={key} onSelect={(e) => { e.preventDefault(); addLineExtra(index, key) }}>{LINE_EXTRA_LABEL[key]}</DropdownMenuItem>))}</DropdownMenuContent>
                            </DropdownMenu>
                            <Button type="button" variant="outline" size="icon" className="h-9 w-9 border-red-100 bg-red-50 hover:bg-red-100" onClick={() => removeItem(index)} disabled={items.length === 1} title="Satırı Sil"><Trash2 className="h-4 w-4 text-red-500" /></Button>
                          </div>
                        </div>

                      </div>

                      {/* --- KDV %0 İSTİSNA SEBEBİ (zorunlu, e-belge ise) --- */}
                      {Number(item.vatRate) === 0 && E_DOC_TYPES.has(effectiveInvoiceType) && (
                        <div
                          className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4 pt-4 border-t -mx-4 md:-mx-3 px-4 md:px-3 pb-3 rounded-b-xl md:rounded-b-none"
                          style={{ borderTopColor: BRAND_COLOR, backgroundColor: "rgba(20,61,107,0.05)" }}
                        >
                          <div className="space-y-1.5">
                            <Label className="text-[10px] font-bold uppercase tracking-widest" style={{ color: BRAND_COLOR }}>
                              KDV İstisna Kodu <span className="text-red-500">*</span>
                            </Label>
                            <Select
                              value={item.taxExemptionReasonCode || ""}
                              onValueChange={(v) => updateItem(index, "taxExemptionReasonCode", v)}
                            >
                              <SelectTrigger className="h-9 bg-white"><SelectValue placeholder="Seçiniz..." /></SelectTrigger>
                              <SelectContent>
                                {TAX_EXEMPTION_CODES.map((opt) => (
                                  <SelectItem key={opt.code} value={opt.code}>{opt.label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="md:col-span-2 space-y-1.5">
                            <Label className="text-[10px] font-bold uppercase tracking-widest" style={{ color: BRAND_COLOR }}>
                              İstisna Sebebi (açıklama) <span className="text-red-500">*</span>
                            </Label>
                            <Input
                              className="h-9 bg-white text-sm"
                              value={item.taxExemptionReason || ""}
                              onChange={(e) => updateItem(index, "taxExemptionReason", e.target.value)}
                              placeholder="Örn: KDV Kanunu 17/2-b kapsamında istisna"
                            />
                          </div>
                        </div>
                      )}

                      {/* --- SATIR EKLENTİLERİ (İskonto, Açıklama vb.) --- */}
                      {extras.length > 0 && (
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4 pt-4 border-t border-slate-100 bg-slate-50/50 -mx-4 md:-mx-3 px-4 md:px-3 pb-3 rounded-b-xl md:rounded-b-none">
                          {LINE_EXTRA_ORDER.filter((k) => extras.includes(k)).map((key) => {
                            const removable = (<button type="button" className="ml-auto inline-flex h-6 w-6 items-center justify-center rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-200 transition-colors" onClick={() => removeLineExtra(index, key)}><X className="h-3.5 w-3.5" /></button>)
                            
                            if (key === "description") {
                              return (
                                <div key={key} className="col-span-2 md:col-span-4 space-y-1.5">
                                  <div className="flex items-center"><Label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Satır Açıklaması</Label>{removable}</div>
                                  <Input className="h-9 text-sm" value={item.description} onChange={(e) => updateItem(index, "description", e.target.value)} placeholder="Müşterinin faturada göreceği satır notu..." />
                                </div>
                              )
                            }
                            if (key === "discountRate") {
                              const mode: DiscountMode =
                                item.discountMode ?? (Number(item.discountAmount || 0) > 0 ? "AMOUNT" : "PERCENT")
                              const isPercent = mode === "PERCENT"
                              const value = isPercent ? (item.discountRate || "") : (item.discountAmount || "")
                              return (
                                <div key={key} className="col-span-1 md:col-span-1 space-y-1.5">
                                  <div className="flex items-center">
                                    <Label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">İskonto</Label>
                                    {removable}
                                  </div>
                                  <div className="flex h-10 items-stretch overflow-hidden rounded-lg border-2 border-kobipo-blue/25 bg-white shadow-sm focus-within:border-kobipo-blue/60 dark:bg-card">
                                    <button
                                      type="button"
                                      className={`flex w-11 shrink-0 items-center justify-center text-base font-bold transition-all ${isPercent ? "bg-kobipo-navy text-white shadow-inner dark:bg-kobipo-blue" : "bg-kobipo-pale/60 text-kobipo-navy hover:bg-kobipo-pale"}`}
                                      aria-pressed={isPercent}
                                      onClick={() => setDiscountMode(index, "PERCENT")}
                                      title="Oran (%)"
                                    >
                                      %
                                    </button>
                                    <button
                                      type="button"
                                      className={`flex w-11 shrink-0 items-center justify-center border-l-2 border-kobipo-blue/25 text-sm font-bold tracking-wide transition-all ${!isPercent ? "bg-kobipo-navy text-white shadow-inner dark:bg-kobipo-blue" : "bg-kobipo-pale/60 text-kobipo-navy hover:bg-kobipo-pale"}`}
                                      aria-pressed={!isPercent}
                                      onClick={() => setDiscountMode(index, "AMOUNT")}
                                      title="Tutar (TL)"
                                    >
                                      TL
                                    </button>
                                    <input
                                      type="number"
                                      className="w-full min-w-0 border-0 bg-transparent px-3 text-sm font-medium outline-none focus:ring-0"
                                      min="0"
                                      step="0.01"
                                      value={value}
                                      onChange={(e) => {
                                        const v = e.target.value === "" ? 0 : parseFloat(e.target.value) || 0
                                        updateItem(index, isPercent ? "discountRate" : "discountAmount", v)
                                      }}
                                      placeholder={isPercent ? "0" : "0,00"}
                                    />
                                  </div>
                                </div>
                              )
                            }
                            if (key === "withholdingRate") {
                              return (
                                <div key={key} className="col-span-2 md:col-span-2 space-y-1.5">
                                  <div className="flex items-center"><Label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Tevkifat (KDV)</Label>{removable}</div>
                                  {withholdingTypes.length > 0 ? (
                                    <>
                                      <div className="flex gap-1.5">
                                        <WithholdingCombobox
                                          types={withholdingTypes}
                                          value={item.withholdingCode || ""}
                                          onChange={(code) => applyWithholdingCode(index, code)}
                                        />
                                        {(item.withholdingCode === "650" || (!!item.withholdingCode && !item.withholdingRate)) && (
                                          <div className="relative w-24 shrink-0">
                                            <Input
                                              type="number"
                                              className="h-9 pr-6 font-medium"
                                              min="0"
                                              step="0.01"
                                              placeholder="Oran"
                                              value={item.withholdingRate || ""}
                                              onChange={(e) => updateItem(index, "withholdingRate", e.target.value === "" ? 0 : parseFloat(e.target.value) || 0)}
                                            />
                                            <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
                                          </div>
                                        )}
                                      </div>
                                      {item.withholdingCode ? (
                                        item.withholdingRate ? (
                                          <p className="text-[10px] text-kobipo-blue">
                                            KDV'nin <span className="font-semibold">%{item.withholdingRate}</span>'i tevkif edilecek.
                                          </p>
                                        ) : (
                                          <p className="text-[10px] text-amber-600">
                                            Oran otomatik gelmedi — yandaki kutuya tevkifat oranını (KDV'nin %'si) girin.
                                          </p>
                                        )
                                      ) : null}
                                    </>
                                  ) : (
                                    <Input
                                      type="number"
                                      className="h-9 font-medium"
                                      min="0"
                                      step="0.01"
                                      placeholder="KDV'nin %'si"
                                      value={item.withholdingRate || ""}
                                      onChange={(e) => updateItem(index, "withholdingRate", e.target.value === "" ? 0 : parseFloat(e.target.value) || 0)}
                                    />
                                  )}
                                </div>
                              )
                            }
                            if (key === "otherTaxRate") {
                              return (
                                <div key={key} className="col-span-2 md:col-span-2 space-y-1.5">
                                  <div className="flex items-center"><Label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Diğer Vergi</Label>{removable}</div>
                                  <div className="flex gap-1.5">
                                    <Input
                                      type="text"
                                      className="h-9 flex-1 font-medium"
                                      placeholder="Vergi adı (ör. Konaklama Vergisi)"
                                      value={item.otherTaxName || ""}
                                      onChange={(e) => updateItem(index, "otherTaxName", e.target.value)}
                                    />
                                    <div className="relative w-24 shrink-0">
                                      <Input
                                        type="number"
                                        className="h-9 pr-6 font-medium"
                                        min="0"
                                        step="0.01"
                                        placeholder="Oran"
                                        value={item.otherTaxRate || ""}
                                        onChange={(e) => updateItem(index, "otherTaxRate", e.target.value === "" ? 0 : parseFloat(e.target.value) || 0)}
                                      />
                                      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
                                    </div>
                                  </div>
                                  {(item.otherTaxRate || 0) > 0 && (() => {
                                    const gross = (Number(item.quantity) || 0) * (Number(item.unitPrice) || 0)
                                    const net = gross - computeItemDiscount(item, gross)
                                    const amt = net * (Number(item.otherTaxRate) || 0) / 100
                                    return (
                                      <p className="text-[10px] text-kobipo-blue">
                                        <span className="font-semibold">{item.otherTaxName || "Diğer Vergi"}</span> · %{item.otherTaxRate} = ₺{amt.toLocaleString("tr-TR", { minimumFractionDigits: 2 })} matraha eklenir.
                                      </p>
                                    )
                                  })()}
                                </div>
                              )
                            }
                            const numericProps = { label: "ÖTV (%)", value: item.exciseRate || "", onChange: (v: string) => updateItem(index, "exciseRate", v === "" ? 0 : parseFloat(v) || 0) }
                            return (
                              <div key={key} className="col-span-1 md:col-span-1 space-y-1.5">
                                <div className="flex items-center"><Label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{numericProps.label}</Label>{removable}</div>
                                <Input type="number" className="h-9 font-medium" min="0" step="0.01" value={numericProps.value} onChange={(e) => numericProps.onChange(e.target.value)} />
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* YENİ SATIR EKLE BUTONU */}
              <div className="bg-slate-50 p-2 md:border-t flex justify-start border-slate-200">
                <Button type="button" variant="ghost" size="sm" onClick={addItem} style={{ color: BRAND_COLOR }} className="hover:bg-blue-50 font-semibold tracking-wide">
                  <Plus className="mr-1.5 h-4 w-4" /> YENİ SATIR EKLE
                </Button>
              </div>
            </div>
          </div>

          <div className="flex flex-col-reverse md:flex-row justify-between gap-6">
            <div className="flex-1 space-y-2 max-w-lg">
              <Label>Genel Notlar</Label>
              <Textarea value={formData.notes} onChange={(e) => setFormData({ ...formData, notes: e.target.value })} placeholder="Fatura altına eklenecek notlar..." rows={4} />
            </div>

            <div className="w-full md:w-80 bg-slate-50 rounded-lg p-4 border space-y-2">
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">Ara Toplam:</span><span className="font-medium">₺{(totals.grossNetAmount ?? totals.netAmount).toLocaleString("tr-TR", { minimumFractionDigits: 2 })}</span></div>
              {totals.discountAmount > 0 && <div className="flex justify-between text-sm text-red-600"><span>Satır İskontoları:</span><span>- ₺{totals.discountAmount.toLocaleString("tr-TR", { minimumFractionDigits: 2 })}</span></div>}

              {/* Fatura altı (genel) iskonto */}
              {!globalDiscountEnabled ? (
                <button
                  type="button"
                  onClick={() => setGlobalDiscountEnabled(true)}
                  className="flex w-full items-center gap-1.5 rounded-md border border-dashed border-slate-300 px-2.5 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:border-slate-400 hover:bg-white"
                >
                  <Plus className="h-3.5 w-3.5" /> Fatura İskontosu Ekle
                </button>
              ) : (
                <div className="rounded-lg border-2 border-kobipo-blue/25 bg-kobipo-pale/40 p-2.5 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-kobipo-navy">Fatura İskontosu</span>
                    <button
                      type="button"
                      className="inline-flex h-5 w-5 items-center justify-center rounded-full text-kobipo-navy/50 hover:bg-kobipo-pale hover:text-kobipo-navy"
                      onClick={() => {
                        setGlobalDiscountEnabled(false)
                        setGlobalDiscountInput("")
                      }}
                      aria-label="Kaldır"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="flex h-10 items-stretch overflow-hidden rounded-lg border-2 border-kobipo-blue/25 bg-white shadow-sm focus-within:border-kobipo-blue/60 dark:bg-card">
                    <button
                      type="button"
                      className={`flex w-11 shrink-0 items-center justify-center text-base font-bold transition-all ${globalDiscountMode === "PERCENT" ? "bg-kobipo-navy text-white shadow-inner dark:bg-kobipo-blue" : "bg-kobipo-pale/60 text-kobipo-navy hover:bg-kobipo-pale"}`}
                      aria-pressed={globalDiscountMode === "PERCENT"}
                      onClick={() => setGlobalDiscountMode("PERCENT")}
                      title="Oran (%)"
                    >
                      %
                    </button>
                    <button
                      type="button"
                      className={`flex w-11 shrink-0 items-center justify-center border-l-2 border-kobipo-blue/25 text-sm font-bold tracking-wide transition-all ${globalDiscountMode === "AMOUNT" ? "bg-kobipo-navy text-white shadow-inner dark:bg-kobipo-blue" : "bg-kobipo-pale/60 text-kobipo-navy hover:bg-kobipo-pale"}`}
                      aria-pressed={globalDiscountMode === "AMOUNT"}
                      onClick={() => setGlobalDiscountMode("AMOUNT")}
                      title="Tutar (TL)"
                    >
                      TL
                    </button>
                    <input
                      type="number"
                      className="w-full min-w-0 border-0 bg-transparent px-3 text-sm font-medium outline-none focus:ring-0"
                      min="0"
                      step="0.01"
                      value={globalDiscountInput}
                      onChange={(e) => setGlobalDiscountInput(e.target.value)}
                      placeholder={globalDiscountMode === "PERCENT" ? "0" : "0,00"}
                    />
                  </div>
                  {totals.globalDiscount > 0 && (
                    <div className="flex justify-between text-xs text-kobipo-navy">
                      <span>Düşülen:</span>
                      <span className="font-semibold">- ₺{totals.globalDiscount.toLocaleString("tr-TR", { minimumFractionDigits: 2 })}</span>
                    </div>
                  )}
                </div>
              )}

              <div className="flex justify-between text-sm border-t border-slate-200 pt-2"><span className="text-muted-foreground">Net Matrah:</span><span className="font-medium">₺{totals.netAmount.toLocaleString("tr-TR", { minimumFractionDigits: 2 })}</span></div>
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">KDV Toplam:</span><span className="font-medium">₺{totals.vatAmount.toLocaleString("tr-TR", { minimumFractionDigits: 2 })}</span></div>
              {totals.withholdingAmount > 0 && <div className="flex justify-between text-sm text-red-600"><span>Tevkifat:</span><span>- ₺{totals.withholdingAmount.toLocaleString("tr-TR", { minimumFractionDigits: 2 })}</span></div>}
              {totals.exciseAmount > 0 && <div className="flex justify-between text-sm text-blue-600"><span>ÖTV:</span><span>+ ₺{totals.exciseAmount.toLocaleString("tr-TR", { minimumFractionDigits: 2 })}</span></div>}
              {(totals.otherTaxAmount ?? 0) > 0 && <div className="flex justify-between text-sm text-blue-600"><span>{items.find((it) => (it.otherTaxRate || 0) > 0)?.otherTaxName || "Diğer Vergi"}:</span><span>+ ₺{(totals.otherTaxAmount ?? 0).toLocaleString("tr-TR", { minimumFractionDigits: 2 })}</span></div>}
              <div className="flex justify-between border-t border-slate-200 pt-3 mt-2 text-lg font-bold"><span>Genel Toplam:</span><span style={{ color: BRAND_COLOR }}>₺{totals.totalAmount.toLocaleString("tr-TR", { minimumFractionDigits: 2 })}</span></div>
            </div>
          </div>

          <div className="flex flex-wrap justify-end gap-3 border-t pt-6">
            <Button variant="outline" onClick={() => { resetForm(); goBack() }}>İptal</Button>
            <Button onClick={handlePreview} disabled={isPreviewLoading || isLoading} variant="outline">
              {isPreviewLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Eye className="mr-2 h-4 w-4" />}
              Önizle (GİB)
            </Button>
            <Button onClick={handleSubmit} disabled={isLoading} variant="success">
              {isLoading ? editingInvoiceId ? "Güncelleniyor..." : "Kaydediliyor..." : editingInvoiceId ? "Faturayı Güncelle" : "Taslak Olarak Kaydet"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ÖNCEKİ FİYATLAR MODALI */}
      <Dialog open={isPriceModalOpen} onOpenChange={setIsPriceModalOpen}>
        <DialogContent className="max-w-3xl border-0 p-0 overflow-hidden">
          {/* Fotoğraftaki gibi üst kısım renklendirildi */}
          <div className="bg-[#48c79c] text-white p-5 pb-4">
            <DialogTitle className="text-xl font-medium tracking-wide">Önceki Fiyatlar</DialogTitle>
            <DialogDescription className="text-white/90 mt-1">
              Bu ürünün son işlem gördüğü fiyatları burada inceleyebilirsiniz.
            </DialogDescription>
          </div>

          <div className="flex flex-col bg-[#fcfaf1]">
            {/* Sekmeler */}
            <div className="flex overflow-x-auto px-4 pt-3 border-b-2 border-[#48c79c]/30 gap-1">
              <button
                onClick={() => setActivePriceTab("sales")}
                className={`px-4 py-2 text-sm font-semibold tracking-wider rounded-t-md transition-colors whitespace-nowrap ${
                  activePriceTab === "sales" ? "bg-white text-[#48c79c] border-t border-l border-r border-[#48c79c]/30" : "bg-transparent text-[#48c79c] hover:bg-white/50"
                }`}
              >
                ÖNCEKİ SATIŞLAR
              </button>
              {formData.type === "PURCHASE" ? (
                <button
                  onClick={() => setActivePriceTab("supplierPurchases")}
                  className={`px-4 py-2 text-sm font-semibold tracking-wider rounded-t-md transition-colors whitespace-nowrap ${
                    activePriceTab === "supplierPurchases" ? "bg-white text-[#48c79c] border-t border-l border-r border-[#48c79c]/30" : "bg-transparent text-[#48c79c] hover:bg-white/50"
                  }`}
                >
                  BU TEDARİKÇİDEN ALIŞLAR
                </button>
              ) : (
                <button
                  onClick={() => setActivePriceTab("customerSales")}
                  className={`px-4 py-2 text-sm font-semibold tracking-wider rounded-t-md transition-colors whitespace-nowrap ${
                    activePriceTab === "customerSales" ? "bg-white text-[#48c79c] border-t border-l border-r border-[#48c79c]/30" : "bg-transparent text-[#48c79c] hover:bg-white/50"
                  }`}
                >
                  BU CARİYE SATIŞLAR
                </button>
              )}
              <button
                onClick={() => setActivePriceTab("purchases")}
                className={`px-4 py-2 text-sm font-semibold tracking-wider rounded-t-md transition-colors whitespace-nowrap ${
                  activePriceTab === "purchases" ? "bg-white text-[#48c79c] border-t border-l border-r border-[#48c79c]/30" : "bg-transparent text-[#48c79c] hover:bg-white/50"
                }`}
              >
                ÖNCEKİ ALIŞLAR
              </button>
              <button
                onClick={() => setActivePriceTab("quotes")}
                className={`px-4 py-2 text-sm font-semibold tracking-wider rounded-t-md transition-colors whitespace-nowrap ${
                  activePriceTab === "quotes" ? "bg-white text-[#48c79c] border-t border-l border-r border-[#48c79c]/30" : "bg-transparent text-[#48c79c] hover:bg-white/50"
                }`}
              >
                TEKLİFLER
              </button>
            </div>

            {/* Tablo İçeriği */}
            <div className="p-4 bg-white min-h-[300px] max-h-[500px] overflow-y-auto">
              {isPriceHistoryLoading ? (
                <div className="flex justify-center items-center h-40 text-muted-foreground">Yükleniyor...</div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-[#eaf4ed] text-[#555] font-semibold text-left">
                    <tr>
                      <th className="p-3 whitespace-nowrap">Tarih</th>
                      <th className="p-3">Cari</th>
                      <th className="p-3 text-right">Fiyat</th>
                      <th className="p-3 text-center">İşlem</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 text-[#666]">
                    {priceHistory[activePriceTab].length === 0 ? (
                      <tr>
                        <td colSpan={4} className="text-center p-8 text-muted-foreground">Bu sekmede kayıt bulunamadı.</td>
                      </tr>
                    ) : (
                      priceHistory[activePriceTab].map((row: any, i: number) => (
                        <tr key={i} className="hover:bg-slate-50 transition-colors">
                          <td className="p-3 whitespace-nowrap">{new Date(row.date).toLocaleDateString('tr-TR')}</td>
                          <td className="p-3 truncate max-w-[200px]" title={row.cariName}>{row.cariName}</td>
                          <td className="p-3 text-right font-medium text-[#48c79c]">
                            {row.price.toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL
                          </td>
                          <td className="p-3 text-center">
                            <Button 
                              size="sm" 
                              variant="outline" 
                              className="h-7 text-xs border-[#48c79c] text-[#48c79c] hover:bg-[#48c79c] hover:text-white"
                              onClick={() => applyPriceToLine(row.price)}
                            >
                              <Check className="w-3 h-3 mr-1" /> Seç
                            </Button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              )}
            </div>
            
            {/* Alt Kısım */}
            <div className="bg-slate-50 p-4 flex justify-end border-t">
              <Button variant="secondary" onClick={() => setIsPriceModalOpen(false)}>Kapat</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* GİB FORMATI TASLAK ÖNİZLEME MODALI */}
      <Dialog open={isPreviewOpen} onOpenChange={setIsPreviewOpen}>
        <DialogContent className="max-w-4xl p-0 overflow-hidden gap-0">
          <DialogHeader className="p-5 pb-3">
            <DialogTitle>Fatura Önizleme — GİB Formatı (TASLAK)</DialogTitle>
            <DialogDescription>
              Bu bir ön izlemedir; mali/yasal değeri yoktur. Resmî belge, faturayı
              resmileştirdikten sonra GİB tarafından üretilir.
            </DialogDescription>
          </DialogHeader>
          <div className="bg-slate-100 dark:bg-muted px-5">
            {previewUrl ? (
              <iframe
                src={previewUrl}
                title="Taslak fatura önizleme"
                className="h-[68vh] w-full rounded-md border bg-white"
              />
            ) : (
              <div className="flex h-[68vh] items-center justify-center text-muted-foreground">
                Önizleme yükleniyor…
              </div>
            )}
          </div>
          <div className="flex flex-wrap justify-end gap-3 border-t bg-slate-50 p-4 dark:bg-muted/40">
            <Button variant="outline" onClick={() => setIsPreviewOpen(false)}>Kapat</Button>
            <Button variant="outline" onClick={handleDownloadPreview} disabled={!previewUrl}>
              <Download className="mr-2 h-4 w-4" />
              Taslak PDF İndir
            </Button>
            <Button
              variant="success"
              disabled={isLoading}
              onClick={() => { setIsPreviewOpen(false); void handleSubmit() }}
            >
              {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Taslak Olarak Kaydet
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}