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
import { Plus, Trash2, X, Clock, Check } from "lucide-react"
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


type LineExtraKey = "description" | "discountRate" | "withholdingRate" | "exciseRate"

const LINE_EXTRA_LABEL: Record<LineExtraKey, string> = {
  description: "Satır açıklaması",
  discountRate: "İskonto (%)",
  withholdingRate: "Tevkifat (%)",
  exciseRate: "ÖTV (%)",
}

const LINE_EXTRA_ORDER: LineExtraKey[] = [
  "description",
  "discountRate",
  "withholdingRate",
  "exciseRate",
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
export interface InvoiceItem { productId?: string; description: string; unit?: string; quantity: number; unitPrice: number; discountRate?: number; vatRate: number; withholdingRate?: number; exciseRate?: number; taxExemptionReasonCode?: string; taxExemptionReason?: string; salePrice?: number }
interface CompanySettings { id: string; name?: string; taxNumber?: string | null; taxOffice?: string | null; address?: string | null; isEDonusumEnabled?: boolean }

export type InvoiceEditorMode = "create" | "edit"

export type InvoiceEditorProps = {
  companyId: string
  mode: InvoiceEditorMode
  invoiceId?: string
  defaultManual?: boolean
  defaultType?: "SALES" | "PURCHASE" | "RETURN"
  backHref?: string
  fromIncomingUuid?: string
}

export function InvoiceEditor({ companyId, mode, invoiceId, defaultManual, defaultType, backHref, fromIncomingUuid }: InvoiceEditorProps) {
  const router = useRouter()
  const { toast } = useToast()

  const [customers, setCustomers] = useState<Customer[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [bootstrappingEdit, setBootstrappingEdit] = useState(mode === "edit")
  const [companySettings, setCompanySettings] = useState<CompanySettings | null>(null)
  const [editingInvoiceId, setEditingInvoiceId] = useState<string | null>(null)

  // Gelen e-faturadan dönüştürme akışı için
  const [incomingPrefillError, setIncomingPrefillError] = useState<string | null>(null)
  const [incomingSupplierCandidate, setIncomingSupplierCandidate] = useState<{
    name: string | null
    taxNumber: string | null
    address: string | null
  } | null>(null)
  const [isCreatingSupplier, setIsCreatingSupplier] = useState(false)
  // useRef: state'ten farklı olarak senkron güncellenir, effect re-run'larda race olmaz.
  // Aynı prefill mantığını birden çok kez çalıştırırsak notlar ve kalemler tekrar eder.
  const prefilledFromIncomingRef = useRef(false)
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

  const listHref = backHref || `/e-donusum?company=${encodeURIComponent(companyId)}`
  const goBack = () => router.push(listHref)

  useEffect(() => {
    if (!companyId) return
    fetchCustomers()
    fetchSuppliers()
    fetchProducts()
    fetchCompanySettings()
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
            address: data.model?.sender?.address || null,
          })
        }

        const modelLines: any[] = Array.isArray(data.model?.lines) ? data.model.lines : []
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
                return {
                  productId: matchedProduct?.id,
                  description: desc || (matchedProduct?.name ?? ""),
                  unit: (ln.unit as string) || matchedProduct?.unit || "ADET",
                  quantity: qty > 0 ? qty : 1,
                  unitPrice,
                  discountRate: discRate,
                  vatRate: Number.isFinite(vat) ? vat : 20,
                  withholdingRate: 0,
                  exciseRate: 0,
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

        const sourceNote = `Kaynak gelen e-fatura: ${data.invoiceNo || ""} (ETTN ${fromIncomingUuid})`
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
            if ((it.discountRate || 0) > 0) extras.push("discountRate")
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
          address: incomingSupplierCandidate.address,
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

      const editItems = Array.isArray(data.items)
        ? data.items.map((item: any) => ({
            productId: item.productId || undefined,
            description: item.description || "",
            unit: (item.unit as string) || item.product?.unit || "ADET",
            quantity: Number(item.quantity) || 1,
            unitPrice: Number(item.unitPrice) || 0,
            discountRate: Number(item.discountRate) || 0,
            vatRate: Number(item.vatRate) || 20,
            withholdingRate: Number(item.withholdingRate) || 0,
            exciseRate: Number(item.exciseRate) || 0,
            taxExemptionReasonCode: item.taxExemptionReasonCode || undefined,
            taxExemptionReason: item.taxExemptionReason || undefined,
          })) : []

      const finalItems: InvoiceItem[] = editItems.length > 0 ? editItems : [{ description: "", unit: "ADET", quantity: 1, unitPrice: 0, discountRate: 0, vatRate: 20, withholdingRate: 0, exciseRate: 0 }]
      setItems(finalItems)
      setLineExtras(finalItems.map((it) => {
        const extras: LineExtraKey[] = []
        if (it.description) extras.push("description")
        if ((it.discountRate || 0) > 0) extras.push("discountRate")
        if ((it.withholdingRate || 0) > 0) extras.push("withholdingRate")
        if ((it.exciseRate || 0) > 0) extras.push("exciseRate")
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
    if (key === "discountRate") updateItem(index, "discountRate", 0)
    if (key === "withholdingRate") updateItem(index, "withholdingRate", 0)
    if (key === "exciseRate") updateItem(index, "exciseRate", 0)
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

  const calculateTotals = () => {
    let netAmount = 0, discountAmount = 0, vatAmount = 0, withholdingAmount = 0, exciseAmount = 0
    items.forEach((item) => {
      const itemGross = item.quantity * item.unitPrice
      const itemDiscount = itemGross * ((item.discountRate || 0) / 100)
      const itemNet = itemGross - itemDiscount
      const itemVat = itemNet * (item.vatRate / 100)
      const itemWithholding = itemNet * ((item.withholdingRate || 0) / 100)
      const itemExcise = itemNet * ((item.exciseRate || 0) / 100)
      netAmount += itemNet; discountAmount += itemDiscount; vatAmount += itemVat; withholdingAmount += itemWithholding; exciseAmount += itemExcise
    })
    return { netAmount, discountAmount, vatAmount, withholdingAmount, exciseAmount, totalAmount: netAmount + vatAmount + exciseAmount - withholdingAmount }
  }

  const resetForm = () => {
    setEditingInvoiceId(null)
    setFormData({ type: "SALES", invoiceType: companySettings?.isEDonusumEnabled ? "E_ARCHIVE" : "MANUAL", invoiceNo: "", customerId: "", supplierId: "", date: new Date().toISOString().split("T")[0], dueDate: "", currency: "TRY", exchangeRate: "", exchangeRateDate: "", notes: "" })
    setItems([{ description: "", unit: "ADET", quantity: 1, unitPrice: 0, discountRate: 0, vatRate: 20, withholdingRate: 0, exciseRate: 0 }])
    setLineExtras([[]])
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
                <Button variant="outline" size="sm" asChild><Link href={`/ayarlar/firma?company=${encodeURIComponent(companyId)}`}>Firma ayarları</Link></Button>
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
                      ? "border-sky-300 bg-sky-50 text-sky-900"
                      : type === "E_ARCHIVE"
                        ? "border-emerald-300 bg-emerald-50 text-emerald-900"
                        : "border-slate-300 bg-slate-50 text-slate-800"
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
                          <Input type="number" min="0" step="0.01" className="text-right font-medium" value={item.unitPrice || ""} onChange={(e) => updateItem(index, "unitPrice", e.target.value === "" ? 0 : parseFloat(e.target.value) || 0)} onFocus={(e) => (e.target as HTMLInputElement).select()} />
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

                        {/* 6. TUTAR */}
                        <div className="col-span-8 md:col-span-2">
                          <Label className="md:hidden text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block">Toplam Tutar</Label>
                          <div 
                            className="flex h-10 items-center justify-end px-3 md:px-0 bg-slate-100/70 md:bg-transparent rounded-md md:rounded-none font-bold tabular-nums text-right text-[15px] md:text-sm"
                            style={{ color: BRAND_COLOR }}
                          >
                            ₺{(item.quantity * item.unitPrice * (1 - (item.discountRate || 0) / 100) * (1 + item.vatRate / 100 + (item.exciseRate || 0) / 100 - (item.withholdingRate || 0) / 100)).toLocaleString("tr-TR", { minimumFractionDigits: 2 })}
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
                            const numericProps = key === "discountRate" ? { label: "İskonto (%)", value: item.discountRate || "", onChange: (v: string) => updateItem(index, "discountRate", v === "" ? 0 : parseFloat(v) || 0) } : key === "withholdingRate" ? { label: "Tevkifat (%)", value: item.withholdingRate || "", onChange: (v: string) => updateItem(index, "withholdingRate", v === "" ? 0 : parseFloat(v) || 0) } : { label: "ÖTV (%)", value: item.exciseRate || "", onChange: (v: string) => updateItem(index, "exciseRate", v === "" ? 0 : parseFloat(v) || 0) }
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

            <div className="w-full md:w-72 bg-slate-50 rounded-lg p-4 border space-y-2">
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">Ara Toplam:</span><span className="font-medium">₺{totals.netAmount.toLocaleString("tr-TR", { minimumFractionDigits: 2 })}</span></div>
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">KDV Toplam:</span><span className="font-medium">₺{totals.vatAmount.toLocaleString("tr-TR", { minimumFractionDigits: 2 })}</span></div>
              {totals.discountAmount > 0 && <div className="flex justify-between text-sm text-red-600"><span>İskonto:</span><span>- ₺{totals.discountAmount.toLocaleString("tr-TR", { minimumFractionDigits: 2 })}</span></div>}
              {totals.withholdingAmount > 0 && <div className="flex justify-between text-sm text-red-600"><span>Tevkifat:</span><span>- ₺{totals.withholdingAmount.toLocaleString("tr-TR", { minimumFractionDigits: 2 })}</span></div>}
              {totals.exciseAmount > 0 && <div className="flex justify-between text-sm text-blue-600"><span>ÖTV:</span><span>+ ₺{totals.exciseAmount.toLocaleString("tr-TR", { minimumFractionDigits: 2 })}</span></div>}
              <div className="flex justify-between border-t border-slate-200 pt-3 mt-2 text-lg font-bold"><span>Genel Toplam:</span><span style={{ color: BRAND_COLOR }}>₺{totals.totalAmount.toLocaleString("tr-TR", { minimumFractionDigits: 2 })}</span></div>
            </div>
          </div>

          <div className="flex flex-wrap justify-end gap-3 border-t pt-6">
            <Button variant="outline" onClick={() => { resetForm(); goBack() }}>İptal</Button>
            <Button onClick={handleSubmit} disabled={isLoading} style={{ backgroundColor: BRAND_COLOR, color: "white" }} className="hover:opacity-90">
              {isLoading ? editingInvoiceId ? "Güncelleniyor..." : "Oluşturuluyor..." : editingInvoiceId ? "Faturayı Güncelle" : "Faturayı Kaydet"}
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
    </>
  )
}