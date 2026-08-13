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
// EKRANIN KURALI (SATIS-EKRANI.md K1/K8): kalemin işlemleri satırdaki "⋮"
// menüsünde toplanır. Depo seçici, KDV dökümü ve hammadde kartı servis
// akışından çıkarıldı — garsonun kararını değiştirmiyorlardı.
//
// 2026-08-06: hesabın işlemleri artık tepside DEĞİL, SAĞ SÜTUNDA — hesap
// panelinin toplamıyla ÖDEME düğmesinin arasında açık düğme olarak duruyor
// (K1 bu ekran için geri alındı). Sebep: iskonto / hesabı böl / masa değiştir
// servis sırasında sık kullanılıyor, tepsi hepsini iki dokunuş arkasına
// saklıyordu; kararlar da zaten hesaba bakarken veriliyor. "Hesap fişi" ayrıca
// eklenmedi — aynı blokta zaten kendi düğmesi var. İptal ÖDEME'nin de altında.
//
// Aynı gün "Hesap istendi" düğmesi de ŞİMDİLİK kaldırıldı. Dikkat: bayrağı
// (`billRequestedAt`) kuran başka bir ekran YOK — salon planındaki "BILL"
// (turuncu masa) durumu ve başlıktaki rozet artık yalnız birleştirmeden devralınan
// eski kayıtlarda görünür. Geri istenirse ya buraya ya masalar ekranına konmalı.

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  Clock,
  Loader2,
  MoveRight,
  Percent,
  Printer,
  Receipt,
  Split,
  StickyNote,
  Trash2,
  User,
  Users,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { FetchErrorText } from "@/components/ui/fetch-error"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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
  useCustomers,
  useEmployees,
  useProducts,
  useRecipes,
  useReceiptTemplate,
  useWarehouses,
  type RefProduct,
} from "@/lib/swr/use-company-data"
import {
  useDiscountLimit,
  useProductOptions,
  useTables,
  useTicket,
  type Ticket,
} from "@/lib/swr/use-restoran"
import { CounterpartyCombobox } from "@/components/e-donusum/counterparty-combobox"
import { cn } from "@/lib/utils"
import { currency, type ReceiptData } from "@/lib/fis/receipt-html"
import { printReceipt } from "@/lib/fis/print-receipt"
import {
  optionRecipeEffects,
  ticketDiscountLabel,
  TICKET_CANCEL_REASONS,
  type TicketItemStatus,
} from "@/lib/restoran/ticket-constants"
import {
  emptyPaymentState,
  newPortion,
  paymentLabelOf,
  paymentSummary,
  receiptParts,
  type PaymentState,
} from "@/lib/satis/payment"
import { submitReceiptSale } from "@/lib/satis/submit-receipt-sale"
import { describeExpandError, expandRecipeLines } from "@/lib/stock/recipe-expand"

type Shortage = { productId: string; name: string; unit: string; need: number; stock: number; after: number }

/** Stok Decimal(14,4) — karşılaştırmadaki float artıklarını temizler. */
const round4 = (n: number) => Math.round(n * 10_000) / 10_000

function elapsedLabel(fromIso: string, now: number): string {
  const mins = Math.max(0, Math.floor((now - new Date(fromIso).getTime()) / 60000))
  if (mins < 60) return `${mins} dk`
  return `${Math.floor(mins / 60)} sa ${mins % 60} dk`
}

/** Etiketin kendisi ortak dosyada: adisyon ekranı, detay sayfası ve fiş aynı
 *  metni basmalı (lib/restoran/ticket-constants.ts `ticketDiscountLabel`). */
const discountLabelOf = (ticket: Ticket | null) => ticketDiscountLabel(ticket)

export function TicketScreen({ ticketId }: { ticketId: string }) {
  const { selectedCompanyId: companyId, selectedCompany } = useDashboardCompany()
  const { toast } = useToast()
  const router = useRouter()

  const { ticket, error, isLoading, mutate } = useTicket(companyId, ticketId)
  const { products, isLoading: productsLoading, error: productsError } = useProducts(companyId, {
    isService: false,
  })
  const { recipeMap, recipeNoteOf } = useRecipes(companyId)
  const { accounts } = useAccounts(companyId)
  const { warehouses } = useWarehouses(companyId)
  const { employees } = useEmployees(companyId)
  const { template: receiptTemplate, company: receiptCompany } = useReceiptTemplate(companyId)
  const { groupsOf } = useProductOptions(companyId)
  // İşletmenin iskonto tavanı — diyalog sınırı gösterip "Uygula"yı kilitler.
  const { maxDiscountPercent } = useDiscountLimit(companyId)
  // Masa listesi yalnız "masayı değiştir" için; salon planındaki 20 sn'lik
  // tazeleme burada gereksiz — hesap ekranında masa dizilimi izlenmiyor.
  const { tables, mutate: mutateTables } = useTables(companyId, { refreshInterval: 0 })
  const { customers } = useCustomers(companyId)

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
  /** İptal sebebi ZORUNLU (uç 400 veriyor): dolu bir hesabı tek tıkla silmek
      kaçağın en klasik yoluydu. Kalem iptalindeki desenin aynısı. */
  const [cancelOpen, setCancelOpen] = useState<{ code: string; note: string } | null>(null)
  const [moveOpen, setMoveOpen] = useState(false)
  const [shortagesOpen, setShortagesOpen] = useState(false)
  const [lastSale, setLastSale] = useState<{ invoiceNo?: string | null; receipt: ReceiptData } | null>(
    null,
  )

  /** Çift kapanış kilidi — kahveci ekranındaki ile aynı gerekçe (İş 5). */
  const submitLock = useRef(false)

  /**
   * Bu adisyonun damgasını taşıyan, sahipsiz bir fiş bulundu: önceki kapanış
   * yarıda kalmış (ağ gitti, sekme kapandı). Kullanıcı "mevcut fişe bağla"
   * derse ikinci fiş kesilmez; "yeni fiş kes" derse bilerek devam eder.
   */
  const [orphanInvoice, setOrphanInvoice] = useState<{
    id: string
    invoiceNo: string | null
    total: number
  } | null>(null)
  const forceNewReceipt = useRef(false)

  /** Eksik tahsilat onayı — bir kez onaylanınca aynı satışta tekrar sorulmaz. */
  const [shortPayWarn, setShortPayWarn] = useState<number | null>(null)
  const shortPayAcked = useRef(false)

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
      // Adisyonda adet 0'a inmez (panelde alt sınır 1): kalem sunucuda kayıtlı
      // ve silinmesi iz bırakmıyordu. Yine de bu yola düşülürse uç kalemi
      // silmiyor, "yanlış girildi" sebebiyle VOID işaretliyor.
      if (quantity <= 0) {
        await callTicketApi(
          `/api/restoran/adisyonlar/${ticketId}/kalemler/${itemId}?companyId=${companyId}`,
          { method: "DELETE" },
          "Kalem iptal edilemedi",
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

  /**
   * Menü kartına SAĞ TIK — bir adet düşürür. Son eklenen NORMAL kalemden düşer
   * ("en son yaptığımı geri al").
   *
   * SON ADET DÜŞÜRÜLMEZ: adisyon kalemi sunucuda kayıtlıdır ve 0'a inmesi onu
   * sebepsiz VOID etmek demek — panelin adet çubuğunun alt sınırının 1 olma
   * gerekçesiyle aynısı (SATIS-EKRANI.md K2). Yanlış giren kalem sebebiyle
   * kaydedilmeli, sağ tık buna sessiz bir kaçış yolu açmamalı.
   */
  const unpickProduct = useCallback(
    async (product: RefProduct) => {
      if (!isOpen) return
      const items = ticket?.items ?? []
      let target: (typeof items)[number] | null = null
      for (let i = items.length - 1; i >= 0; i--) {
        if (items[i].productId === product.id && items[i].status === "NORMAL") {
          target = items[i]
          break
        }
      }
      if (!target) return
      if (target.quantity <= 1) {
        toast({
          title: `"${product.name}" tek adet kaldı`,
          description: 'Kaldırmak için kalemi hesap panelinden seçip "İptal" ile sebebiyle kaydedin.',
        })
        return
      }
      await setItemQty(target.id, target.quantity - 1)
    },
    [isOpen, setItemQty, ticket?.items, toast],
  )

  /**
   * Kapanıştan sonra ekrandan ÇIK.
   *
   * Kapanan adisyonun POS ekranı ölü bir sayfadır: ortada "Bu adisyon kapandı"
   * yazan boş bir kart kalır, yapılacak hiçbir şey yoktur. Kip dondurma (K1) bu
   * ekranı bilerek ayakta tutuyor — yoksa "Hesap kapatıldı" penceresi görünmeden
   * unmount olurdu — ama pencere kapandıktan sonra kullanıcıyı orada bırakmak
   * çıkmaz sokaktı.
   *
   * İKİ çağıranı var ve ikisi de şart: başarılı kapanış penceresinin her kapanma
   * yolu (düğme, X, Esc, dışarı tıklama) ve "fiş oluştu, tahsilat kaydedilemedi"
   * dalı — o dalda adisyon kapanıyor ama pencere HİÇ açılmıyor, kullanıcı doğruca
   * ölü ekranda kalıyordu.
   *
   * Hedef masaya göre: masalı hesap salon planına döner (bir sonraki iş orada),
   * paket/gel-al ise salon planında hiç görünmediği için adisyon listesine.
   */
  const leaveAfterClose = useCallback(() => {
    setLastSale(null)
    router.push(
      withCompanyHref(
        ticket?.tableId ? "/restoran/masalar" : "/restoran/adisyonlar",
        companyId,
      ),
    )
  }, [router, companyId, ticket?.tableId])

  /** İkram / zayi / iptal — kalem SİLİNMEZ, işaretlenir (SATIS-EKRANI.md K2). */
  const setItemStatus = useCallback(
    async (
      itemId: string,
      status: TicketItemStatus,
      reasonCode: string | null,
      reason: string | null,
      compEmployeeId?: string | null,
    ) => {
      await callTicketApi(
        `/api/restoran/adisyonlar/${ticketId}/kalemler/${itemId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ companyId, status, reasonCode, reason, compEmployeeId }),
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

  /**
   * Masa değiştirme. Sunucu tarafı baştan hazırdı (`PATCH tableId`, dolu masayı
   * 409 ile reddeder) ama ekranda girişi yoktu — "müşteri masa değiştirdi" kafede
   * günlük bir olay ve tek çare adisyonu iptal edip yeniden açmaktı.
   */
  const moveToTable = useCallback(
    async (tableId: string | null) => {
      const ok = await callTicketApi(
        `/api/restoran/adisyonlar/${ticketId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ companyId, tableId }),
        },
        "Masa değiştirilemedi",
      )
      if (ok) {
        setMoveOpen(false)
        // Eski masa boşaldı, yenisi doldu: salon planının önbelleği tazelenmeli.
        void mutateTables()
      }
    },
    [callTicketApi, companyId, mutateTables, ticketId],
  )

  /**
   * Adisyonun carisi. Veresiye kapanışta fatura bu müşteriye borç yazar;
   * seçilmezse fiş ödenmemiş kalır ve borç KİMSEYE yazılmaz (kahveci ekranındaki
   * uyarının aynısı). Adisyona yazılıyor, yerel state'te tutulmuyor: kapanış
   * gövdesini sunucu üretiyor ve sayfa yenilense de seçim kaybolmamalı.
   */
  const setCustomer = useCallback(
    async (customerId: string | null) =>
      callTicketApi(
        `/api/restoran/adisyonlar/${ticketId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ companyId, customerId }),
        },
        "Müşteri kaydedilemedi",
      ),
    [callTicketApi, companyId, ticketId],
  )

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
            discountReasonCode: value?.reasonCode,
            discountReason: value?.reason,
            discountEmployeeId: value?.employeeId,
          }),
        },
        "İskonto uygulanamadı",
      )
      if (ok) setDiscountOpen(false)
    },
    [callTicketApi, companyId, ticketId],
  )

  const cancelTicket = useCallback(async () => {
    if (!cancelOpen?.code) return
    try {
      const params = new URLSearchParams({
        companyId: companyId ?? "",
        reasonCode: cancelOpen.code,
      })
      if (cancelOpen.note.trim()) params.set("reason", cancelOpen.note.trim())
      const res = await fetch(`/api/restoran/adisyonlar/${ticketId}?${params.toString()}`, {
        method: "DELETE",
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || "İptal edilemedi")
      toast({ title: "Adisyon iptal edildi" })
      router.push(withCompanyHref("/restoran/masalar", companyId))
    } catch (e: any) {
      toast({ title: "İptal edilemedi", description: e.message, variant: "destructive" })
    }
  }, [cancelOpen, companyId, router, ticketId, toast])

  // ---- Yetersiz stok uyarısı ---------------------------------------------
  // Servis akışının ortasındaki büyük kart yerine TEK SATIRLIK şerit: bilgi
  // kaybolmuyor ama sipariş girerken göz önünde durmuyor (SATIS-EKRANI.md K8).

  const expansion = useMemo(
    () =>
      expandRecipeLines({
        lines: (ticket?.items ?? [])
          .filter((i) => i.productId && i.status !== "VOID")
          .map((i) => {
            // Seçenek etkileri uyarıya da girer: kapanışta fiilen düşecek olan
            // ne ise şerit onu göstermeli (soya sütü, ekstra shot, büyük boy).
            const { effects, recipeFactor } = optionRecipeEffects(i.options)
            return {
              productId: i.productId as string,
              quantity: i.quantity,
              effects,
              recipeFactor,
            }
          }),
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

  /**
   * Genişletme hataları (birim uyuşmazlığı, döngü). Yetersiz stoktan AYRI bir
   * şey: orada malzeme biter, burada reçete bozuktur ve bileşen hiç düşmez —
   * hızlı satış ekranı bunu zaten gösteriyordu, adisyon göstermiyordu.
   */
  const expandErrors = useMemo(
    () =>
      expansion.errors.map((e) =>
        describeExpandError(e, (id) => productById.get(id)?.name ?? id),
      ),
    [expansion.errors, productById],
  )

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
      if (!printReceipt(data, autoPrint, receiptTemplate)) {
        toast({
          title: "Açılır pencere engellendi",
          description: "Fiş için bu siteye açılır pencere izni verin.",
          variant: "destructive",
        })
      }
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
    // Tahsil edilmeyen tutar cariye yazılamıyorsa kimseye borç yazılmıyor demektir
    // (veresiyedeki uyarının parçalı/eksik ödeme karşılığı). Bir kez onaylanır.
    const pay = paymentSummary(payment, ticket.totals.total)
    if (!payment.isCredit && pay.remaining > 0.005 && !ticket.customerId && !shortPayAcked.current) {
      setShortPayWarn(pay.remaining)
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

      // Önceki kapanış yarıda kalmışsa fiş ZATEN var: ikinci fiş stoğu ikinci
      // kez düşürür, ciroyu ikiye katlar. Kullanıcı karar verene kadar durulur.
      if (prep.existingInvoice && !forceNewReceipt.current) {
        setOrphanInvoice(prep.existingInvoice)
        return
      }

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
          // Adisyon KAPANDI (yukarıda), yani bu ekranda yapılacak bir şey kalmadı.
          // Eksik tahsilat kaybolmuyor: adisyon listesinde ve detay sayfasında
          // "Kısmî tahsilat" rozetiyle görünür (docs/restoran/ADISYON-DETAY.md K3).
          leaveAfterClose()
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
      // Onaylar bu satışa aitti; kapanış bitti, bir sonraki için sıfırlanır.
      forceNewReceipt.current = false
      shortPayAcked.current = false
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
    leaveAfterClose,
    mutate,
    payment,
    receiptCompany,
    selectedCompany,
    ticket,
    ticketId,
    toast,
    warehouseId,
  ])

  /**
   * Sahipsiz fişe bağlanarak kapat: yeni fiş KESİLMEZ, tahsilat da denenmez
   * (o fiş için ödeme zaten girilmiş olabilir — Fişler ekranından tamamlanır).
   */
  const attachExistingInvoice = useCallback(async () => {
    if (!orphanInvoice) return
    setIsSubmitting(true)
    try {
      const res = await fetch(`/api/restoran/adisyonlar/${ticketId}/kapat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, invoiceId: orphanInvoice.id, warehouseId }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || "Adisyon kapatılamadı")
      applyTicket(body as Ticket)
      setOrphanInvoice(null)
      setPayOpen(false)
      toast({
        title: "Adisyon mevcut fişe bağlandı",
        description: orphanInvoice.invoiceNo ?? undefined,
      })
    } catch (e: any) {
      toast({ title: "Bağlanamadı", description: e.message, variant: "destructive" })
    } finally {
      setIsSubmitting(false)
    }
  }, [applyTicket, companyId, orphanInvoice, ticketId, toast, warehouseId])

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

  const afterCloseLabel = ticket.tableId ? "Masalara dön" : "Adisyonlara dön"

  return (
    <div className="space-y-4">
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
          {ticket.customerName ? (
            <span className="flex items-center gap-1">
              <User className="h-3.5 w-3.5" />
              {ticket.customerName}
            </span>
          ) : null}
          {ticket.note ? (
            <span className="flex items-center gap-1">
              <StickyNote className="h-3.5 w-3.5" />
              {ticket.note}
            </span>
          ) : null}
          {isOpen && ticket.billRequestedAt && (
            <span className="flex items-center gap-1 rounded-full bg-orange-100 px-2 py-0.5 font-semibold text-orange-900 dark:bg-orange-500/20 dark:text-orange-100">
              <Receipt className="h-3.5 w-3.5" />
              Hesap istendi · {elapsedLabel(ticket.billRequestedAt, now)}
            </span>
          )}
          {!isOpen && (
            <span className="rounded-full bg-muted px-2 py-0.5 font-semibold">
              {ticket.status === "CLOSED" ? `Kapandı · ${ticket.invoiceNo ?? ""}` : "İptal"}
            </span>
          )}
        </div>
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[1fr_400px]">
        {/* SOL: menü */}
        <div className="space-y-3">
          {isOpen ? (
            <MenuGrid
              products={products}
              recipeMap={recipeMap}
              noteOf={recipeNoteOf}
              onUnpick={(p) => void unpickProduct(p)}
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

          {/* Bozuk reçete: yetersiz stoktan farklı ve daha ciddi — katlanmıyor,
              çünkü kullanıcının görmediği sürece düzeltmesi mümkün değil. */}
          {expandErrors.length > 0 && (
            <div className="space-y-1 rounded-lg border border-red-300 bg-red-50/60 px-3 py-2 text-xs text-red-700 dark:border-red-700/60 dark:bg-red-950/20 dark:text-red-300">
              <div className="flex items-center gap-2 font-semibold">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                Reçete hatası — bu bileşenler stoktan düşmeyecek
              </div>
              {expandErrors.map((e) => (
                <p key={e} className="pl-5">
                  {e}
                </p>
              ))}
            </div>
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
          employees={employees}
          onQuantity={(id, q) => void setItemQty(id, q)}
          // Promise DÖNDÜRÜLÜR (void'lenmez): panel çoklu seçimde kalemleri
          // sırayla uygulayıp her birini bekliyor.
          onSetStatus={(id, status, code, reason, employeeId) =>
            setItemStatus(id, status, code, reason, employeeId)
          }
          onEditNote={(id) => {
            const item = ticket.items.find((i) => i.id === id)
            setNoteDialog({ itemId: id, note: item?.note ?? "" })
          }}
          footer={
            isOpen ? (
              <div className="space-y-2">
                {/* Hesabın işlemleri — tepsi yerine açık düğmeler, hesabın
                    KENDİ sütununda. Toplamın hemen altı: garson zaten oraya
                    bakarken iskonto/bölme/masa kararını veriyor. */}
                <div className="grid grid-cols-2 gap-2 border-t pt-2">
                  <Button variant="outline" size="sm" onClick={() => setDiscountOpen(true)}>
                    <Percent className="mr-1.5 h-4 w-4" />
                    İskonto
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setSplitOpen(true)}>
                    <Split className="mr-1.5 h-4 w-4" />
                    Hesabı böl
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setMoveOpen(true)}>
                    <MoveRight className="mr-1.5 h-4 w-4" />
                    Masayı değiştir
                  </Button>
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
                    Kişi sayısı / not
                  </Button>
                </div>

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

                {/* İptal en altta ve ÖDEME'nin ötesinde — yıkıcı olan tek işlem,
                    diğerlerinin arasında durursa yanlışlıkla değiliyor. */}
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-950/40 dark:hover:text-red-300"
                  onClick={() => setCancelOpen({ code: "", note: "" })}
                >
                  <Trash2 className="mr-1.5 h-4 w-4" />
                  Adisyonu iptal et
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
          {/* Veresiye: borcun YAZILACAĞI cari. Kahveci ekranında bu vardı, masa
              hesabında yoktu — oysa "hesabı defterime yaz" masada daha sık. */}
          {payment.isCredit && (
            <div>
              <Label className="text-xs text-muted-foreground">
                Müşteri — veresiye takibi için
              </Label>
              <div className="mt-1.5">
                <CounterpartyCombobox
                  customers={customers}
                  suppliers={[]}
                  selectedCustomerId={ticket.customerId ?? undefined}
                  onSelect={(sel) =>
                    void setCustomer(sel && sel.kind === "customer" ? sel.id : null)
                  }
                  placeholder="Müşteri ara…"
                />
              </div>
              {!ticket.customerId && (
                <p className="mt-1.5 text-xs text-amber-600 dark:text-amber-400">
                  Müşteri seçilmezse fiş ödenmemiş kalır ama kimseye borç yazılmaz.
                </p>
              )}
            </div>
          )}
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
      <Dialog open={!!lastSale} onOpenChange={(open) => !open && leaveAfterClose()}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-kobipo-green" />
              Hesap kapatıldı
            </DialogTitle>
            <DialogDescription>{lastSale?.invoiceNo ?? "Fiş oluşturuldu"}</DialogDescription>
          </DialogHeader>
          {/* Kahveci Satış'taki yerleşimin aynısı: iki ikincil eylem yan yana,
              birincil eylem tam genişlikte. Üçü tek satıra dizildiğinde toplam
              genişlikleri `sm:max-w-sm`in iç genişliğini (336px) aşıyor ve
              `DialogFooter`da `flex-wrap` olmadığı için son düğme kartın dışına
              taşıyordu. Tam genişlik ayrıca tablette dokunma hedefini büyütür. */}
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              onClick={() => lastSale && openPrintWindow(lastSale.receipt, false)}
            >
              <Receipt className="mr-2 h-4 w-4" />
              Fişi göster
            </Button>
            <Button
              variant="outline"
              onClick={() => lastSale && openPrintWindow(lastSale.receipt, true)}
            >
              <Printer className="mr-2 h-4 w-4" />
              Yazdır
            </Button>
          </div>
          <DialogFooter>
            <Button className="w-full" onClick={leaveAfterClose}>
              {afterCloseLabel}
            </Button>
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
        employees={employees}
        maxPercent={maxDiscountPercent}
        current={
          ticket.discountType
            ? {
                type: ticket.discountType,
                value: Number(ticket.discountValue ?? 0),
                reasonCode: ticket.discountReasonCode,
                reason: ticket.discountReason,
                employeeId: ticket.discountEmployeeId,
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

      {/* Yarıda kalmış kapanış: fiş var, adisyon açık kalmış. */}
      <Dialog open={!!orphanInvoice} onOpenChange={(open) => !open && setOrphanInvoice(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Bu adisyon için zaten fiş kesilmiş</DialogTitle>
            <DialogDescription>
              {orphanInvoice?.invoiceNo ?? "Fiş"} · {currency(orphanInvoice?.total ?? 0)} — önceki
              kapanış yarıda kalmış görünüyor. Yeni fiş keserseniz stok ikinci kez düşer ve ciro
              iki kez yazılır.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:justify-between">
            <Button
              variant="ghost"
              disabled={isSubmitting}
              onClick={() => {
                forceNewReceipt.current = true
                setOrphanInvoice(null)
                void handleClose()
              }}
            >
              Yine de yeni fiş kes
            </Button>
            <Button disabled={isSubmitting} onClick={() => void attachExistingInvoice()}>
              Mevcut fişe bağla ve kapat
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Eksik tahsilat: kalan tutar cariye yazılamıyorsa kimseye borç yazılmaz. */}
      <Dialog open={shortPayWarn !== null} onOpenChange={(open) => !open && setShortPayWarn(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Tahsil edilmeyen tutar var</DialogTitle>
            <DialogDescription>
              {currency(shortPayWarn ?? 0)} açık kalıyor ve müşteri seçilmediği için bu tutar
              kimseye borç yazılmayacak. Veresiye takibi için önce müşteri seçin.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:justify-between">
            <Button variant="outline" onClick={() => setShortPayWarn(null)}>
              Geri dön
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                shortPayAcked.current = true
                setShortPayWarn(null)
                void handleClose()
              }}
            >
              Yine de kapat
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Adisyon iptali — sebep zorunlu (kalem iptaliyle aynı kural). */}
      <Dialog open={!!cancelOpen} onOpenChange={(open) => !open && setCancelOpen(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Adisyon iptal edilsin mi?</DialogTitle>
            <DialogDescription>
              Kalemler iptal kaydı olarak kalır; stok ve cari etkilenmez.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-1.5">
              {TICKET_CANCEL_REASONS.map((r) => (
                <button
                  key={r.code}
                  type="button"
                  onClick={() => setCancelOpen((c) => (c ? { ...c, code: r.code } : c))}
                  className={cn(
                    "rounded-lg border p-2.5 text-left text-sm font-medium transition-colors",
                    cancelOpen?.code === r.code
                      ? "border-kobipo-blue bg-kobipo-blue/10 text-kobipo-blue dark:border-primary dark:bg-primary/15 dark:text-primary"
                      : "hover:bg-muted",
                  )}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Açıklama (isteğe bağlı)</Label>
              <Input
                value={cancelOpen?.note ?? ""}
                onChange={(e) => setCancelOpen((c) => (c ? { ...c, note: e.target.value } : c))}
                placeholder="Kısa not"
                className="mt-1.5"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelOpen(null)}>
              Vazgeç
            </Button>
            <Button
              variant="destructive"
              disabled={!cancelOpen?.code}
              onClick={() => void cancelTicket()}
            >
              Adisyonu iptal et
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Masayı değiştir — dolu masalar listede ama SEÇİLEMEZ; sunucu da 409
          veriyor ("bir masada tek açık adisyon"). Masasız (paket) seçeneği en
          üstte: gel-al'a dönen bir hesap için tek yol buydu. */}
      <Dialog open={moveOpen} onOpenChange={setMoveOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Masayı değiştir</DialogTitle>
            <DialogDescription>
              {ticket.tableName ? `Şu an: Masa ${ticket.tableName}` : "Şu an: Paket / Gel-al"}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[50vh] space-y-1.5 overflow-y-auto pr-1">
            {ticket.tableId && (
              <button
                type="button"
                onClick={() => void moveToTable(null)}
                className="w-full rounded-lg border px-3 py-2 text-left text-sm font-medium hover:bg-muted"
              >
                Paket / Gel-al (masasız)
              </button>
            )}
            {tables
              .filter((t) => t.isActive && t.id !== ticket.tableId)
              .map((t) => {
                const busy = !!t.openTicket
                return (
                  <button
                    key={t.id}
                    type="button"
                    disabled={busy}
                    onClick={() => void moveToTable(t.id)}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm",
                      busy ? "cursor-not-allowed opacity-50" : "font-medium hover:bg-muted",
                    )}
                  >
                    <span>
                      {t.name}
                      {t.areaName ? (
                        <span className="ml-1.5 text-xs text-muted-foreground">{t.areaName}</span>
                      ) : null}
                    </span>
                    {busy && <span className="text-xs text-muted-foreground">dolu</span>}
                  </button>
                )
              })}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMoveOpen(false)}>
              Vazgeç
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
