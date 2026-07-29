"use client"

// Adisyon ekranı — masanın açık hesabı. Kararlar: docs/restoran/ASAMA2.md (Faz C)
//
// Kahveci Satış ekranından farkı: sepet TARAYICIDA değil, SUNUCUDA yaşıyor.
// Adisyon saatlerce açık kalır ve başka bir cihazdan (garson tablet, kasa) da
// görülür; bu yüzden her kalem işlemi anında uca gider ve dönen adisyon ekranı
// tazeler. Menü ızgarası ve fiş/tahsilat akışı satış ekranıyla ORTAK.
//
// Stok, kalem eklerken DEĞİL adisyon kapanırken düşer (ASAMA2.md). Yetersiz stok
// uyarısı yine canlı gösterilir ve ENGELLEMEZ — PLAN.md "Adım 4".

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  Loader2,
  Printer,
  Receipt,
  StickyNote,
  Trash2,
  Users,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { QuantityStepper } from "@/components/ui/quantity-stepper"
import { MenuGrid } from "@/components/restoran/menu-grid"
import { PaymentPanel } from "@/components/satis/payment-panel"
import { useToast } from "@/components/ui/use-toast"
import { useDashboardCompany } from "@/components/dashboard/dashboard-company-provider"
import {
  useAccounts,
  useProducts,
  useRecipes,
  useReceiptTemplate,
  useWarehouses,
  type RefProduct,
} from "@/lib/swr/use-company-data"
import { useTicket, type Ticket } from "@/lib/swr/use-restoran"
import { buildReceiptHtml, currency, type ReceiptData } from "@/lib/fis/receipt-html"
import { qty } from "@/lib/format"
import {
  emptyPaymentState,
  paymentSummary,
  receiptParts,
  PAYMENT_METHOD_LABELS,
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

  const [pendingProductId, setPendingProductId] = useState<string | null>(null)
  const [warehouseId, setWarehouseId] = useState("")
  const [payment, setPayment] = useState<PaymentState>(() => emptyPaymentState())
  const [payOpen, setPayOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [infoDialog, setInfoDialog] = useState<{ guestCount: string; note: string } | null>(null)
  const [cancelOpen, setCancelOpen] = useState(false)
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

  const addProduct = useCallback(
    async (product: RefProduct) => {
      if (!isOpen) return
      setPendingProductId(product.id)
      await callTicketApi(
        `/api/restoran/adisyonlar/${ticketId}/kalemler`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ companyId, productId: product.id, quantity: 1 }),
        },
        "Kalem eklenemedi",
      )
      setPendingProductId(null)
    },
    [callTicketApi, companyId, isOpen, ticketId],
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

  const cancelTicket = useCallback(async () => {
    try {
      const res = await fetch(`/api/restoran/adisyonlar/${ticketId}?companyId=${companyId}`, {
        method: "DELETE",
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || "İptal edilemedi")
      toast({ title: "Adisyon iptal edildi" })
      router.push("/restoran/masalar")
    } catch (e: any) {
      toast({ title: "İptal edilemedi", description: e.message, variant: "destructive" })
    }
  }, [companyId, router, ticketId, toast])

  // ---- Yetersiz stok uyarısı ---------------------------------------------

  const expansion = useMemo(
    () =>
      expandRecipeLines({
        lines: (ticket?.items ?? [])
          .filter((i) => i.productId)
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
      // 1) Fiş gövdesini SUNUCU hazırlar (kalem eşlemesi tek yerde durur).
      const prepRes = await fetch(
        `/api/restoran/adisyonlar/${ticketId}/kapat?companyId=${companyId}`,
      )
      const prep = await prepRes.json().catch(() => ({}))
      if (!prepRes.ok) throw new Error(prep?.error || "Kapanış hazırlanamadı")

      // 2) Fiş + tahsilat (Kahveci Satış ile ortak akış).
      const result = await submitReceiptSale({
        companyId,
        items: prep.invoicePayload.items,
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
            body: JSON.stringify({ companyId, invoiceId: result.invoice.id }),
          })
          void mutate()
          setPayOpen(false)
          setIsSubmitting(false)
          return
        }
        throw new Error(result.error)
      }

      // 3) Adisyonu fişe bağla ve kapat.
      const closeRes = await fetch(`/api/restoran/adisyonlar/${ticketId}/kapat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, invoiceId: result.invoice.id }),
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
        items: ticket.items.map((l) => ({
          description: l.note ? `${l.description} (${l.note})` : l.description,
          quantity: l.quantity,
          unit: l.unit,
          unitPrice: l.unitPrice,
          vatRate: l.vatRate,
          total: l.quantity * l.unitPrice * (1 + l.vatRate / 100),
        })),
        net: result.invoice?.netAmount != null ? Number(result.invoice.netAmount) : ticket.totals.net,
        vat: result.invoice?.vatAmount != null ? Number(result.invoice.vatAmount) : ticket.totals.vat,
        total: result.total,
        paymentLabel: payment.isCredit ? "Veresiye" : PAYMENT_METHOD_LABELS[payment.method],
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

  const openReceipt = (autoPrint: boolean) => {
    if (!lastSale) return
    const w = window.open("", "_blank", "width=420,height=720")
    if (!w) {
      toast({
        title: "Açılır pencere engellendi",
        description: "Fiş için bu siteye açılır pencere izni verin.",
        variant: "destructive",
      })
      return
    }
    w.document.write(buildReceiptHtml(lastSale.receipt, autoPrint, receiptTemplate))
    w.document.close()
    w.focus()
  }

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
            Adisyon yüklenemedi. Bağlantınızı kontrol edip sayfayı yenileyin.
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
  const itemCount = ticket.items.reduce((s, i) => s + i.quantity, 0)

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <BackLink />
          <h1 className="text-3xl font-bold">
            {ticket.tableName ? `Masa ${ticket.tableName}` : "Adisyon"}
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
        {isOpen && (
          <div className="flex flex-wrap items-center gap-2">
            {warehouses.length > 1 && (
              <Select value={warehouseId} onValueChange={setWarehouseId}>
                <SelectTrigger className="w-44">
                  <SelectValue placeholder="Depo" />
                </SelectTrigger>
                <SelectContent>
                  {warehouses.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.name} {w.isDefault ? "(Ana)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setInfoDialog({
                  guestCount: ticket.guestCount != null ? String(ticket.guestCount) : "",
                  note: ticket.note ?? "",
                })
              }
            >
              <Users className="mr-1.5 h-4 w-4" />
              Kişi / Not
            </Button>
            <Button variant="outline" size="sm" onClick={() => setCancelOpen(true)}>
              <Trash2 className="mr-1.5 h-4 w-4" />
              Adisyonu iptal et
            </Button>
          </div>
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
                  .filter((i) => i.productId === productId)
                  .reduce((s, i) => s + i.quantity, 0) || null
              }
              onPick={addProduct}
            />
          ) : (
            <Card>
              <CardContent className="py-12 text-center text-sm text-muted-foreground">
                Bu adisyon kapandı. Yeni sipariş için masadan yeni adisyon açın.
              </CardContent>
            </Card>
          )}

          {shortages.length > 0 && (
            <Card className="border-amber-300 dark:border-amber-700/60">
              <CardContent className="space-y-2 p-3">
                <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="h-4 w-4" />
                  <span className="text-sm font-semibold">
                    Yetersiz hammadde ({shortages.length}) — satış engellenmez
                  </span>
                </div>
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {shortages.map((s) => (
                    <div
                      key={s.productId}
                      className="flex items-center justify-between gap-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs dark:bg-amber-950/30"
                    >
                      <span className="truncate font-medium">{s.name}</span>
                      <span className="shrink-0 tabular-nums text-amber-700 dark:text-amber-400">
                        {qty(s.stock)} → {qty(s.after)} {s.unit}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* SAĞ: adisyon */}
        <Card className="xl:sticky xl:top-4">
          <CardContent className="space-y-3 p-3">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-sm font-semibold">
                <Receipt className="h-4 w-4 text-kobipo-blue dark:text-primary" />
                Adisyon
              </span>
              <span className="text-xs text-muted-foreground">{qty(itemCount)} adet</span>
            </div>

            {ticket.items.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                Menüden ürün seçin
              </p>
            ) : (
              <div className="max-h-[46vh] space-y-1.5 overflow-y-auto pr-1">
                {ticket.items.map((item) => (
                  <div key={item.id} className="rounded-lg border p-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{item.description}</p>
                        {item.note && (
                          <p className="truncate text-xs text-muted-foreground">{item.note}</p>
                        )}
                        <p className="text-xs text-muted-foreground">
                          {currency(item.unitPrice * (1 + item.vatRate / 100))} × {qty(item.quantity)}
                        </p>
                      </div>
                      <span className="shrink-0 text-sm font-semibold tabular-nums">
                        {currency(item.quantity * item.unitPrice * (1 + item.vatRate / 100))}
                      </span>
                    </div>
                    {isOpen && (
                      <div className="mt-1.5 flex items-center justify-between">
                        <QuantityStepper
                          value={item.quantity}
                          onChange={(v) => void setItemQty(item.id, v)}
                          min={0}
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void setItemQty(item.id, 0)}
                          aria-label="Kalemi sil"
                        >
                          <Trash2 className="h-4 w-4 text-muted-foreground" />
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="space-y-1 border-t pt-2 text-sm">
              <div className="flex justify-between text-muted-foreground">
                <span>Ara toplam</span>
                <span className="tabular-nums">{currency(totals.net)}</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>KDV</span>
                <span className="tabular-nums">{currency(totals.vat)}</span>
              </div>
              <div className="flex justify-between text-lg font-bold">
                <span>Toplam</span>
                <span className="tabular-nums">{currency(totals.total)}</span>
              </div>
            </div>

            {isOpen && (
              <Button
                className="h-12 w-full text-base"
                disabled={ticket.items.length === 0}
                onClick={() => setPayOpen(true)}
              >
                Hesabı Kapat
              </Button>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Ödeme */}
      <Dialog open={payOpen} onOpenChange={(o) => !isSubmitting && setPayOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Hesabı kapat</DialogTitle>
            <DialogDescription>
              {ticket.tableName ? `Masa ${ticket.tableName} · ` : ""}
              {ticket.code} · {currency(totals.total)}
            </DialogDescription>
          </DialogHeader>
          <PaymentPanel
            state={payment}
            onChange={(patch) => setPayment((p) => ({ ...p, ...patch }))}
            total={totals.total}
            accounts={accounts}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayOpen(false)} disabled={isSubmitting}>
              Vazgeç
            </Button>
            <Button onClick={handleClose} disabled={isSubmitting}>
              {isSubmitting ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="mr-1.5 h-4 w-4" />
              )}
              Satışı Tamamla
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Kapanış sonrası fiş */}
      <Dialog open={lastSale !== null} onOpenChange={(o) => !o && setLastSale(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              Hesap kapatıldı
            </DialogTitle>
            <DialogDescription>{lastSale?.invoiceNo} oluşturuldu.</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:justify-between">
            <Button variant="outline" onClick={() => openReceipt(false)}>
              <Receipt className="mr-1.5 h-4 w-4" />
              Fişi göster
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => openReceipt(true)}>
                <Printer className="mr-1.5 h-4 w-4" />
                Yazdır
              </Button>
              <Button onClick={() => router.push("/restoran/masalar")}>Masalara dön</Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Kişi / not */}
      <Dialog open={infoDialog !== null} onOpenChange={(o) => !o && setInfoDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Adisyon bilgisi</DialogTitle>
            <DialogDescription>Kişi sayısı ve not fişe de yazılır.</DialogDescription>
          </DialogHeader>
          {infoDialog && (
            <div className="space-y-3">
              <div>
                <Label>Kişi sayısı</Label>
                <Input
                  type="number"
                  min={0}
                  value={infoDialog.guestCount}
                  onChange={(e) => setInfoDialog({ ...infoDialog, guestCount: e.target.value })}
                  className="mt-1.5"
                />
              </div>
              <div>
                <Label>Not</Label>
                <Input
                  value={infoDialog.note}
                  onChange={(e) => setInfoDialog({ ...infoDialog, note: e.target.value })}
                  placeholder="Doğum günü, ikram…"
                  className="mt-1.5"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setInfoDialog(null)}>
              Vazgeç
            </Button>
            <Button onClick={saveInfo}>Kaydet</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* İptal onayı */}
      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Adisyon iptal edilsin mi?</DialogTitle>
            <DialogDescription>
              Stok ve cari etkilenmez — açık adisyon henüz hiçbirine dokunmadı. Kalemi olan
              adisyon iptal kaydı olarak saklanır.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelOpen(false)}>
              Vazgeç
            </Button>
            <Button variant="destructive" onClick={cancelTicket}>
              İptal et
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function BackLink() {
  return (
    <Link
      href="/restoran/masalar"
      className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" />
      Masalar
    </Link>
  )
}
