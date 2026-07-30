"use client"

// Adisyon ekranı — masanın açık hesabı.
// Kararlar: docs/restoran/ASAMA2.md (Faz C) · docs/restoran/SATIS-EKRANI.md
//
// Kahveci Satış ekranından farkı: sepet TARAYICIDA değil, SUNUCUDA yaşıyor.
// Adisyon saatlerce açık kalır ve başka bir cihazdan (garson tablet, kasa) da
// görülür; bu yüzden her kalem işlemi anında uca gider ve dönen adisyon ekranı
// tazeler. Menü ızgarası, hesap paneli ve fiş/tahsilat akışı satış ekranıyla ORTAK.
//
// Stok, kalem eklerken DEĞİL adisyon kapanırken düşer (ASAMA2.md). Yetersiz stok
// uyarısı yine canlı gösterilir ve ENGELLEMEZ — PLAN.md "Adım 4".
//
// EKRANIN KURALI (SATIS-EKRANI.md K1/K8): yeni yetenekler düğme olarak eklenmez.
// Kalemin işlemleri satırdaki "⋮" menüsünde, hesabın işlemleri üstteki tek
// "İşlemler" tepsisinde toplanır. Depo seçici, KDV dökümü ve hammadde kartı
// servis akışından çıkarıldı — garsonun kararını değiştirmiyorlardı.

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  Clock,
  Loader2,
  Percent,
  Printer,
  Receipt,
  Split,
  StickyNote,
  Trash2,
  Users,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { FetchErrorText } from "@/components/ui/fetch-error"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { MenuGrid } from "@/components/restoran/menu-grid"
import { TicketPanel } from "@/components/restoran/ticket-panel"
import { OptionDialog } from "@/components/restoran/option-dialog"
import { DiscountDialog, type DiscountValue } from "@/components/restoran/discount-dialog"
import { SplitDialog } from "@/components/restoran/split-dialog"
import { PaymentPanel } from "@/components/satis/payment-panel"
import { useToast } from "@/components/ui/use-toast"
import { useDashboardCompany } from "@/components/dashboard/dashboard-company-provider"
import { CompanyLink } from "@/components/dashboard/company-link"
import { withCompanyHref } from "@/lib/company/href"
import {
  useAccounts,
  useProducts,
  useRecipes,
  useReceiptTemplate,
  useWarehouses,
  type RefProduct,
} from "@/lib/swr/use-company-data"
import { useProductOptions, useTicket, type Ticket } from "@/lib/swr/use-restoran"
import { buildReceiptHtml, currency, type ReceiptData } from "@/lib/fis/receipt-html"
import type { TicketItemStatus } from "@/lib/restoran/ticket-constants"
import {
  emptyPaymentState,
  newPortion,
  paymentLabelOf,
  paymentSummary,
  receiptParts,
  type PaymentState,
} from "@/lib/satis/payment"
import { submitReceiptSale } from "@/lib/satis/submit-receipt-sale"
import { expandRecipeLines } from "@/lib/stock/recipe-expand"

type Shortage = { productId: string; name: string; unit: string; need: number; stock: number; after: number }

/** Stok Decimal(14,4) — karşılaştırmadaki float artıklarını temizler. */
const round4 = (n: number) => Math.round(n * 10_000) / 10_000

function elapsedLabel(fromIso: string, now: number): string {
  const mins = Math.max(0, Math.floor((now - new Date(fromIso).getTime()) / 60000))
  if (mins < 60) return `${mins} dk`
  return `${Math.floor(mins / 60)} sa ${mins % 60} dk`
}

const discountLabelOf = (ticket: Ticket | null) => {
  if (!ticket?.discountType) return null
  const base = ticket.discountType === "PERCENT" ? `İskonto %${ticket.discountValue}` : "İskonto"
  return ticket.discountReason ? `${base} · ${ticket.discountReason}` : base
}

export function TicketScreen({ ticketId }: { ticketId: string }) {
  const { selectedCompanyId: companyId, selectedCompany } = useDashboardCompany()
  const { toast } = useToast()
  const router = useRouter()

  const { ticket, error, isLoading, mutate } = useTicket(companyId, ticketId)
  const { products, isLoading: productsLoading, error: productsError } = useProducts(companyId, {
    isService: false,
  })
  const { recipeMap } = useRecipes(companyId)
  const { accounts } = useAccounts(companyId)
  const { warehouses } = useWarehouses(companyId)
  const { template: receiptTemplate, company: receiptCompany } = useReceiptTemplate(companyId)
  const { groupsOf } = useProductOptions(companyId)

  const [pendingProductId, setPendingProductId] = useState<string | null>(null)
  const [warehouseId, setWarehouseId] = useState("")
  const [payment, setPayment] = useState<PaymentState>(() => emptyPaymentState())
  const [payOpen, setPayOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [infoDialog, setInfoDialog] = useState<{ guestCount: string; note: string } | null>(null)
  const [noteDialog, setNoteDialog] = useState<{ itemId: string; note: string } | null>(null)
  const [discountOpen, setDiscountOpen] = useState(false)
  const [splitOpen, setSplitOpen] = useState(false)
  const [optionFor, setOptionFor] = useState<RefProduct | null>(null)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [shortagesOpen, setShortagesOpen] = useState(false)
  const [lastSale, setLastSale] = useState<{ invoiceNo?: string | null; receipt: ReceiptData } | null>(
    null,
  )

  /** Çift kapanış kilidi — kahveci ekranındaki ile aynı gerekçe (İş 5). */
  const submitLock = useRef(false)

  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60000)
    return () => clearInterval(t)
  }, [])

  // Depo artık ekranda SORULMUYOR (garson servis sırasında depo değiştirmez);
  // varsayılan depo sessizce seçilir ve kapanışta kullanılır.
  useEffect(() => {
    if (warehouseId || warehouses.length === 0) return
    const def = warehouses.find((w) => w.isDefault) ?? warehouses[0]
    if (def) setWarehouseId(def.id)
  }, [warehouses, warehouseId])

  useEffect(() => {
    if (payment.accountId || accounts.length === 0) return
    const firstCash = accounts.find((a) => a.type === "CASH") ?? accounts[0]
    if (firstCash) setPayment((p) => ({ ...p, accountId: firstCash.id }))
  }, [accounts, payment.accountId])

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products])
  const unitOf = useCallback(
    (productId: string) => productById.get(productId)?.unit ?? null,
    [productById],
  )

  const isOpen = ticket?.status === "OPEN"

  // ---- Kalem işlemleri ----------------------------------------------------
  // Her işlem sunucuya gider ve DÖNEN adisyonla ekran tazelenir: iki cihaz aynı
  // adisyonu düzenlediğinde ekranda daima sunucunun gerçeği durur.

  const applyTicket = useCallback(
    (next: Ticket) => {
      void mutate(next, { revalidate: false })
    },
    [mutate],
  )

  const callTicketApi = useCallback(
    async (path: string, init: RequestInit, failTitle: string) => {
      try {
        const res = await fetch(path, init)
        const body = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(body?.error || failTitle)
        applyTicket(body as Ticket)
        return true
      } catch (e: any) {
        toast({ title: failTitle, description: e.message, variant: "destructive" })
        void mutate()
        return false
      }
    },
    [applyTicket, mutate, toast],
  )

  const addLine = useCallback(
    async (productId: string, extra?: { optionIds?: string[]; note?: string | null }) => {
      setPendingProductId(productId)
      await callTicketApi(
        `/api/restoran/adisyonlar/${ticketId}/kalemler`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            companyId,
            productId,
            quantity: 1,
            optionIds: extra?.optionIds,
            note: extra?.note ?? undefined,
          }),
        },
        "Kalem eklenemedi",
      )
      setPendingProductId(null)
    },
    [callTicketApi, companyId, ticketId],
  )

  /**
   * Menüden ürün seçimi. Seçeneği OLAN ürün diyalog açar, olmayan TEK DOKUNUŞTA
   * sepete girer — kahveciyi yavaşlatacak tek şey her üründe açılan diyalogdur.
   */
  const pickProduct = useCallback(
    async (product: RefProduct) => {
      if (!isOpen) return
      if (groupsOf(product.id).length > 0) {
        setOptionFor(product)
        return
      }
      await addLine(product.id)
    },
    [addLine, groupsOf, isOpen],
  )

  const setItemQty = useCallback(
    async (itemId: string, quantity: number) => {
      if (quantity <= 0) {
        await callTicketApi(
          `/api/restoran/adisyonlar/${ticketId}/kalemler/${itemId}?companyId=${companyId}`,
          { method: "DELETE" },
          "Kalem silinemedi",
        )
        return
      }
      await callTicketApi(
        `/api/restoran/adisyonlar/${ticketId}/kalemler/${itemId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ companyId, quantity }),
        },
        "Adet güncellenemedi",
      )
    },
    [callTicketApi, companyId, ticketId],
  )

  /** İkram / zayi / iptal — kalem SİLİNMEZ, işaretlenir (SATIS-EKRANI.md K2). */
  const setItemStatus = useCallback(
    async (
      itemId: string,
      status: TicketItemStatus,
      reasonCode: string | null,
      reason: string | null,
    ) => {
      await callTicketApi(
        `/api/restoran/adisyonlar/${ticketId}/kalemler/${itemId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ companyId, status, reasonCode, reason }),
        },
        "Kalem güncellenemedi",
      )
    },
    [callTicketApi, companyId, ticketId],
  )

  const saveNote = useCallback(async () => {
    if (!noteDialog) return
    const ok = await callTicketApi(
      `/api/restoran/adisyonlar/${ticketId}/kalemler/${noteDialog.itemId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, note: noteDialog.note }),
      },
      "Not kaydedilemedi",
    )
    if (ok) setNoteDialog(null)
  }, [callTicketApi, companyId, noteDialog, ticketId])

  const saveInfo = useCallback(async () => {
    if (!infoDialog) return
    const ok = await callTicketApi(
      `/api/restoran/adisyonlar/${ticketId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId,
          guestCount: infoDialog.guestCount ? Number(infoDialog.guestCount) : null,
          note: infoDialog.note,
        }),
      },
      "Kaydedilemedi",
    )
    if (ok) setInfoDialog(null)
  }, [callTicketApi, companyId, infoDialog, ticketId])

  const applyDiscount = useCallback(
    async (value: DiscountValue) => {
      const ok = await callTicketApi(
        `/api/restoran/adisyonlar/${ticketId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            companyId,
            discountType: value?.type ?? null,
            discountValue: value?.value,
            discountReason: value?.reason,
          }),
        },
        "İskonto uygulanamadı",
      )
      if (ok) setDiscountOpen(false)
    },
    [callTicketApi, companyId, ticketId],
  )

  const cancelTicket = useCallback(async () => {
    try {
      const res = await fetch(`/api/restoran/adisyonlar/${ticketId}?companyId=${companyId}`, {
        method: "DELETE",
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || "İptal edilemedi")
      toast({ title: "Adisyon iptal edildi" })
      router.push(withCompanyHref("/restoran/masalar", companyId))
    } catch (e: any) {
      toast({ title: "İptal edilemedi", description: e.message, variant: "destructive" })
    }
  }, [companyId, router, ticketId, toast])

  // ---- Yetersiz stok uyarısı ---------------------------------------------
  // Servis akışının ortasındaki büyük kart yerine TEK SATIRLIK şerit: bilgi
  // kaybolmuyor ama sipariş girerken göz önünde durmuyor (SATIS-EKRANI.md K8).

  const expansion = useMemo(
    () =>
      expandRecipeLines({
        lines: (ticket?.items ?? [])
          .filter((i) => i.productId && i.status !== "VOID")
          .map((i) => ({ productId: i.productId as string, quantity: i.quantity })),
        recipes: recipeMap,
        unitOf,
      }),
    [ticket?.items, recipeMap, unitOf],
  )

  const shortages = useMemo<Shortage[]>(() => {
    const rows: Shortage[] = []
    const push = (productId: string, need: number) => {
      const p = productById.get(productId)
      if (!p) return
      const stock = Number(p.stockQuantity ?? 0)
      const after = round4(stock - need)
      if (after >= 0) return
      rows.push({ productId, name: p.name, unit: p.unit || "", need: round4(need), stock, after })
    }
    for (const c of expansion.components) push(c.productId, c.quantity)
    for (const d of expansion.direct) push(d.productId, d.quantity)
    return rows.sort((a, b) => a.after - b.after)
  }, [expansion, productById])

  // ---- Hesap fişi (ödeme öncesi döküm) ------------------------------------

  const buildPrebill = useCallback((): ReceiptData | null => {
    if (!ticket) return null
    const billable = ticket.items.filter((i) => i.status === "NORMAL" || i.status === "COMP")
    return {
      direction: "outgoing",
      prebill: true,
      date: new Date().toISOString(),
      companyName: selectedCompany?.name ?? "",
      company: receiptCompany,
      counterpartyName: ticket.customerName,
      reference: [ticket.code, ticket.tableName ? `Masa ${ticket.tableName}` : null]
        .filter(Boolean)
        .join(" · "),
      items: billable.map((l) => ({
        description: [l.description, l.options.map((o) => o.optionName).join(" · "), l.note]
          .filter(Boolean)
          .join(" · "),
        quantity: l.quantity,
        unit: l.unit,
        unitPrice: l.status === "COMP" ? 0 : l.unitPrice,
        vatRate: l.vatRate,
        total: l.status === "COMP" ? 0 : l.quantity * l.unitPrice * (1 + l.vatRate / 100),
      })),
      net: ticket.totals.net,
      vat: ticket.totals.vat,
      total: ticket.totals.total,
      discount:
        ticket.totals.discount > 0
          ? { label: discountLabelOf(ticket) ?? "İskonto", amount: ticket.totals.discount }
          : null,
      paymentLabel: "",
      tendered: 0,
      isCredit: false,
    }
  }, [receiptCompany, selectedCompany, ticket])

  const openPrintWindow = useCallback(
    (data: ReceiptData, autoPrint: boolean) => {
      const w = window.open("", "_blank", "width=420,height=720")
      if (!w) {
        toast({
          title: "Açılır pencere engellendi",
          description: "Fiş için bu siteye açılır pencere izni verin.",
          variant: "destructive",
        })
        return
      }
      w.document.write(buildReceiptHtml(data, autoPrint, receiptTemplate))
      w.document.close()
      w.focus()
    },
    [receiptTemplate, toast],
  )

  // ---- Kapanış ------------------------------------------------------------

  const handleClose = useCallback(async () => {
    if (!companyId || !ticket || !isOpen || submitLock.current) return
    if (ticket.items.length === 0) {
      toast({ title: "Adisyon boş", description: "Önce kalem ekleyin", variant: "destructive" })
      return
    }
    submitLock.current = true
    setIsSubmitting(true)
    try {
      // 1) Fiş gövdesini SUNUCU hazırlar (kalem eşlemesi ve iskonto tek yerde).
      const prepRes = await fetch(
        `/api/restoran/adisyonlar/${ticketId}/kapat?companyId=${companyId}`,
      )
      const prep = await prepRes.json().catch(() => ({}))
      if (!prepRes.ok) throw new Error(prep?.error || "Kapanış hazırlanamadı")

      // 2) Fiş + tahsilat (Kahveci Satış ile ortak akış).
      const result = await submitReceiptSale({
        companyId,
        items: prep.invoicePayload.items,
        globalDiscountAmount: prep.invoicePayload.globalDiscountAmount,
        payment,
        accounts,
        customerId: prep.invoicePayload.customerId,
        warehouseId,
        notes: prep.invoicePayload.notes,
        fallbackTotal: ticket.totals.total,
      })
      if (!result.ok) {
        if (result.stage === "payment") {
          toast({
            title: "Fiş oluştu, tahsilat kaydedilemedi",
            description: result.error,
            variant: "destructive",
          })
          // Fiş oluştuğu için adisyonu YİNE DE bağlayıp kapatıyoruz: aksi halde
          // masa açık görünür ve ikinci bir fiş kesilebilirdi. Tahsilat Fişler
          // ekranından tamamlanır.
          await fetch(`/api/restoran/adisyonlar/${ticketId}/kapat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ companyId, invoiceId: result.invoice.id, warehouseId }),
          })
          void mutate()
          setPayOpen(false)
          setIsSubmitting(false)
          return
        }
        throw new Error(result.error)
      }

      // 3) Adisyonu fişe bağla ve kapat (ikram/zayi stok düzeltmesi de burada).
      const closeRes = await fetch(`/api/restoran/adisyonlar/${ticketId}/kapat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, invoiceId: result.invoice.id, warehouseId }),
      })
      const closed = await closeRes.json().catch(() => ({}))
      if (!closeRes.ok) {
        // Fiş kesildi ama bağ kurulamadı: kullanıcı fişi görebilsin diye numarayı
        // veriyoruz; masa hâlâ açık görünecek ve tekrar kapatılabilecek.
        toast({
          title: "Fiş kesildi, adisyon kapatılamadı",
          description: `${result.invoice?.invoiceNo ?? ""} — ${closed?.error ?? ""}`.trim(),
          variant: "destructive",
        })
      } else {
        applyTicket(closed as Ticket)
      }

      const done = paymentSummary(payment, result.total)
      const receipt: ReceiptData = {
        direction: "outgoing",
        invoiceNo: result.invoice.invoiceNo ?? null,
        date: new Date().toISOString(),
        companyName: selectedCompany?.name ?? "",
        company: receiptCompany,
        counterpartyName: ticket.customerName,
        notes: [ticket.tableName ? `Masa ${ticket.tableName}` : null, ticket.code]
          .filter(Boolean)
          .join(" · "),
        // Fişte yalnız ÖDENEN kalemler: ikram/zayi/iptal müşterinin hesabı değil.
        items: ticket.items
          .filter((l) => l.status === "NORMAL")
          .map((l) => ({
            description: [l.description, l.options.map((o) => o.optionName).join(" · "), l.note]
              .filter(Boolean)
              .join(" · "),
            quantity: l.quantity,
            unit: l.unit,
            unitPrice: l.unitPrice,
            vatRate: l.vatRate,
            total: l.quantity * l.unitPrice * (1 + l.vatRate / 100),
          })),
        net: result.invoice?.netAmount != null ? Number(result.invoice.netAmount) : ticket.totals.net,
        vat: result.invoice?.vatAmount != null ? Number(result.invoice.vatAmount) : ticket.totals.vat,
        total: result.total,
        discount:
          ticket.totals.discount > 0
            ? { label: discountLabelOf(ticket) ?? "İskonto", amount: ticket.totals.discount }
            : null,
        paymentLabel: payment.isCredit
          ? "Veresiye"
          : paymentLabelOf(payment.method, payment.provider),
        tendered: done.tendered,
        change: done.change,
        isCredit: payment.isCredit,
        parts: payment.splitMode && !payment.isCredit ? receiptParts(result.parts) : undefined,
      }

      setPayOpen(false)
      setLastSale({ invoiceNo: result.invoice.invoiceNo, receipt })
      toast({
        title: "Hesap kapatıldı",
        description: `${result.invoice.invoiceNo ?? "Fiş"} · ${currency(result.paidSum)} tahsil edildi`,
      })
    } catch (e: any) {
      toast({ title: "Hesap kapatılamadı", description: e.message, variant: "destructive" })
    } finally {
      submitLock.current = false
      setIsSubmitting(false)
    }
  }, [
    accounts,
    applyTicket,
    companyId,
    isOpen,
    mutate,
    payment,
    receiptCompany,
    selectedCompany,
    ticket,
    ticketId,
    toast,
    warehouseId,
  ])

  if (!companyId) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <p className="text-muted-foreground">Lütfen bir firma seçin</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-4">
        <BackLink />
        <Card>
          <CardContent className="py-16 text-center text-sm text-red-600 dark:text-red-400">
            <FetchErrorText error={error} subject="Adisyon" />
          </CardContent>
        </Card>
      </div>
    )
  }

  if (isLoading && !ticket) {
    return (
      <div className="space-y-4">
        <BackLink />
        <Card>
          <CardContent className="py-16 text-center text-sm text-muted-foreground">
            Adisyon yükleniyor…
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!ticket) return null

  const totals = ticket.totals
  const hasBillable = ticket.items.some((i) => i.status === "NORMAL")

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <BackLink />
          <h1 className="text-3xl font-bold">
            {ticket.tableName ? `Masa ${ticket.tableName}` : "Paket / Gel-al"}
          </h1>
          <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            <span>{ticket.code}</span>
            <span className="flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" />
              {elapsedLabel(ticket.openedAt, now)}
            </span>
            {ticket.guestCount ? (
              <span className="flex items-center gap-1">
                <Users className="h-3.5 w-3.5" />
                {ticket.guestCount} kişi
              </span>
            ) : null}
            {ticket.note ? (
              <span className="flex items-center gap-1">
                <StickyNote className="h-3.5 w-3.5" />
                {ticket.note}
              </span>
            ) : null}
            {!isOpen && (
              <span className="rounded-full bg-muted px-2 py-0.5 font-semibold">
                {ticket.status === "CLOSED" ? `Kapandı · ${ticket.invoiceNo ?? ""}` : "İptal"}
              </span>
            )}
          </div>
        </div>

        {/* Hesabın TÜM işlemleri tek tepside — üst barda tek kontrol. */}
        {isOpen && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">
                İşlemler
                <ChevronDown className="ml-1.5 h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem
                onClick={() => {
                  const data = buildPrebill()
                  if (data) openPrintWindow(data, true)
                }}
              >
                <Printer className="mr-2 h-4 w-4" />
                Hesap fişi
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setDiscountOpen(true)}>
                <Percent className="mr-2 h-4 w-4" />
                İskonto
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSplitOpen(true)}>
                <Split className="mr-2 h-4 w-4" />
                Hesabı böl
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  setInfoDialog({
                    guestCount: ticket.guestCount != null ? String(ticket.guestCount) : "",
                    note: ticket.note ?? "",
                  })
                }
              >
                <Users className="mr-2 h-4 w-4" />
                Kişi sayısı / not
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-red-600 dark:text-red-400"
                onClick={() => setCancelOpen(true)}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Adisyonu iptal et
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[1fr_400px]">
        {/* SOL: menü */}
        <div className="space-y-3">
          {isOpen ? (
            <MenuGrid
              products={products}
              recipeMap={recipeMap}
              isLoading={productsLoading || pendingProductId !== null}
              error={productsError}
              badgeOf={(productId) =>
                ticket.items
                  .filter((i) => i.productId === productId && i.status === "NORMAL")
                  .reduce((s, i) => s + i.quantity, 0) || null
              }
              onPick={pickProduct}
            />
          ) : (
            <Card>
              <CardContent className="py-12 text-center text-sm text-muted-foreground">
                Bu adisyon kapandı. Yeni sipariş için masadan yeni adisyon açın.
              </CardContent>
            </Card>
          )}

          {shortages.length > 0 && (
            <div className="rounded-lg border border-amber-300 bg-amber-50/60 text-xs dark:border-amber-700/60 dark:bg-amber-950/20">
              <button
                type="button"
                onClick={() => setShortagesOpen((v) => !v)}
                className="flex w-full items-center gap-2 px-3 py-2 text-amber-700 dark:text-amber-400"
              >
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                <span className="font-semibold">
                  {shortages.length} üründe hammadde yetersiz — satış engellenmez
                </span>
                <ChevronDown
                  className={`ml-auto h-3.5 w-3.5 transition-transform ${shortagesOpen ? "rotate-180" : ""}`}
                />
              </button>
              {shortagesOpen && (
                <div className="grid gap-1 px-3 pb-2 sm:grid-cols-2">
                  {shortages.map((s) => (
                    <div key={s.productId} className="flex items-center justify-between gap-2">
                      <span className="truncate">{s.name}</span>
                      <span className="shrink-0 tabular-nums text-amber-700 dark:text-amber-400">
                        {s.stock} → {s.after} {s.unit}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* SAĞ: hesap (ortak panel) */}
        <TicketPanel
          items={ticket.items}
          totals={totals}
          discountLabel={discountLabelOf(ticket)}
          readOnly={!isOpen}
          onQuantity={(id, q) => void setItemQty(id, q)}
          onSetStatus={(id, status, code, reason) => void setItemStatus(id, status, code, reason)}
          onEditNote={(id) => {
            const item = ticket.items.find((i) => i.id === id)
            setNoteDialog({ itemId: id, note: item?.note ?? "" })
          }}
          footer={
            isOpen ? (
              <div className="grid grid-cols-[auto_1fr] gap-2">
                <Button
                  variant="outline"
                  className="h-12"
                  disabled={ticket.items.length === 0}
                  onClick={() => {
                    const data = buildPrebill()
                    if (data) openPrintWindow(data, true)
                  }}
                >
                  <Printer className="mr-1.5 h-4 w-4" />
                  Hesap Fişi
                </Button>
                <Button
                  className="h-12 text-base"
                  disabled={!hasBillable}
                  onClick={() => setPayOpen(true)}
                >
                  ÖDEME
                </Button>
              </div>
            ) : null
          }
        />
      </div>

      {/* Ödeme */}
      <Dialog open={payOpen} onOpenChange={(open) => !isSubmitting && setPayOpen(open)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Hesabı kapat</DialogTitle>
            <DialogDescription>
              {ticket.tableName ? `Masa ${ticket.tableName}` : "Paket / Gel-al"} ·{" "}
              {currency(totals.total)}
            </DialogDescription>
          </DialogHeader>
          <PaymentPanel
            total={totals.total}
            state={payment}
            onChange={(patch) => setPayment((p) => ({ ...p, ...patch }))}
            accounts={accounts}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayOpen(false)} disabled={isSubmitting}>
              Vazgeç
            </Button>
            <Button onClick={handleClose} disabled={isSubmitting}>
              {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Tahsil Et
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Satış sonrası */}
      <Dialog open={!!lastSale} onOpenChange={(open) => !open && setLastSale(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-kobipo-green" />
              Hesap kapatıldı
            </DialogTitle>
            <DialogDescription>{lastSale?.invoiceNo ?? "Fiş oluşturuldu"}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:justify-between">
            <Button
              variant="outline"
              onClick={() => lastSale && openPrintWindow(lastSale.receipt, false)}
            >
              <Receipt className="mr-1.5 h-4 w-4" />
              Fişi göster
            </Button>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => lastSale && openPrintWindow(lastSale.receipt, true)}
              >
                <Printer className="mr-1.5 h-4 w-4" />
                Yazdır
              </Button>
              <Button onClick={() => router.push(withCompanyHref("/restoran/masalar", companyId))}>
                Masalara dön
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Seçenek / porsiyon */}
      <OptionDialog
        open={!!optionFor}
        productName={optionFor?.name ?? ""}
        basePrice={
          optionFor ? Number(optionFor.salePrice ?? 0) * (1 + Number(optionFor.vatRate ?? 20) / 100) : 0
        }
        groups={optionFor ? groupsOf(optionFor.id) : []}
        onCancel={() => setOptionFor(null)}
        onConfirm={(pick) => {
          const product = optionFor
          setOptionFor(null)
          if (product) void addLine(product.id, { optionIds: pick.optionIds, note: pick.note })
        }}
      />

      {/* İskonto */}
      <DiscountDialog
        open={discountOpen}
        gross={totals.gross}
        current={
          ticket.discountType
            ? {
                type: ticket.discountType,
                value: Number(ticket.discountValue ?? 0),
                reason: ticket.discountReason,
              }
            : null
        }
        onClose={() => setDiscountOpen(false)}
        onApply={(v) => void applyDiscount(v)}
      />

      {/* Hesabı böl — kalemler parçalara dağıtılır, ödeme parçalı yazılır */}
      <SplitDialog
        open={splitOpen}
        factor={totals.gross > 0 ? totals.total / totals.gross : 1}
        items={ticket.items
          .filter((i) => i.status === "NORMAL")
          .map((i) => ({
            id: i.id,
            description: i.description,
            quantity: i.quantity,
            lineGross: i.quantity * i.unitPrice * (1 + i.vatRate / 100),
          }))}
        onClose={() => setSplitOpen(false)}
        onConfirm={(amounts) => {
          setSplitOpen(false)
          setPayment((p) => ({
            ...p,
            splitMode: true,
            isCredit: false,
            portions: amounts.map((a) => ({ ...newPortion("CREDIT_CARD"), amount: a.toFixed(2) })),
          }))
          setPayOpen(true)
        }}
      />

      {/* Kalem notu */}
      <Dialog open={!!noteDialog} onOpenChange={(open) => !open && setNoteDialog(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Kalem notu</DialogTitle>
            <DialogDescription>Not fişte kalemin yanında görünür.</DialogDescription>
          </DialogHeader>
          <Input
            value={noteDialog?.note ?? ""}
            onChange={(e) => setNoteDialog((d) => (d ? { ...d, note: e.target.value } : d))}
            placeholder="az şekerli, buzsuz…"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setNoteDialog(null)}>
              Vazgeç
            </Button>
            <Button onClick={() => void saveNote()}>Kaydet</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Kişi / not */}
      <Dialog open={!!infoDialog} onOpenChange={(open) => !open && setInfoDialog(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Adisyon bilgisi</DialogTitle>
            <DialogDescription>Kişi sayısı ve not fişe de yazılır.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Kişi sayısı</Label>
              <Input
                value={infoDialog?.guestCount ?? ""}
                onChange={(e) =>
                  setInfoDialog((d) => (d ? { ...d, guestCount: e.target.value } : d))
                }
                inputMode="numeric"
                placeholder="2"
                className="mt-1.5"
              />
            </div>
            <div>
              <Label>Not</Label>
              <Input
                value={infoDialog?.note ?? ""}
                onChange={(e) => setInfoDialog((d) => (d ? { ...d, note: e.target.value } : d))}
                placeholder="Doğum günü, ikram…"
                className="mt-1.5"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInfoDialog(null)}>
              Vazgeç
            </Button>
            <Button onClick={() => void saveInfo()}>Kaydet</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Adisyon iptali */}
      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Adisyon iptal edilsin mi?</DialogTitle>
            <DialogDescription>
              Kalemler iptal kaydı olarak kalır; stok ve cari etkilenmez.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelOpen(false)}>
              Vazgeç
            </Button>
            <Button variant="destructive" onClick={() => void cancelTicket()}>
              Adisyonu iptal et
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function BackLink() {
  return (
    <CompanyLink
      href="/restoran/masalar"
      className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" />
      Masalar
    </CompanyLink>
  )
}
