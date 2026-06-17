"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useToast } from "@/components/ui/use-toast"
import { ProductCombobox, type ComboboxProduct } from "@/components/e-donusum/product-combobox"
import { CounterpartyCombobox, type Counterparty } from "@/components/e-donusum/counterparty-combobox"
import { useDashboardCompany } from "@/components/dashboard/dashboard-company-provider"
import { Loader2, Trash2, Zap, ShoppingCart } from "lucide-react"

type CartLine = {
  key: string
  productId: string | null
  description: string
  unit: string
  quantity: number
  unitPrice: number
  vatRate: number
}

type FinancialAccount = {
  id: string
  name: string
  type: string
}

type PaymentMethod = "CASH" | "CREDIT_CARD" | "BANK_TRANSFER"

const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "CASH", label: "Nakit" },
  { value: "CREDIT_CARD", label: "Kredi Kartı" },
  { value: "BANK_TRANSFER", label: "Havale/EFT" },
]

const currency = (n: number) =>
  new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(n)

/** type="number" input'larda 0 değerini boş göster — baştaki "0" takılmasın. */
const numInput = (n: number) => (n === 0 ? "" : String(n))

function lineTotals(line: CartLine) {
  const net = line.quantity * line.unitPrice
  const vat = net * (line.vatRate / 100)
  return { net, vat, total: net + vat }
}

export function QuickSaleScreen() {
  const { selectedCompanyId, selectedCompany } = useDashboardCompany()
  const companyId = selectedCompanyId
  const isEDonusumEnabled = Boolean(selectedCompany?.isEDonusumEnabled)
  const { toast } = useToast()

  const [products, setProducts] = useState<ComboboxProduct[]>([])
  const [customers, setCustomers] = useState<Counterparty[]>([])
  const [accounts, setAccounts] = useState<FinancialAccount[]>([])
  const [warehouses, setWarehouses] = useState<{ id: string; name: string; isDefault?: boolean }[]>([])
  const [warehouseId, setWarehouseId] = useState<string>("")

  const [cart, setCart] = useState<CartLine[]>([])
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | undefined>(undefined)

  const [isCredit, setIsCredit] = useState(false) // Veresiye
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("CASH")
  const [accountId, setAccountId] = useState<string>("")
  const [eArsiv, setEArsiv] = useState(false)

  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (!companyId) return
    let cancelled = false

    const load = async () => {
      try {
        const [prodRes, custRes, accRes, whRes] = await Promise.all([
          fetch(`/api/stok/products?companyId=${companyId}`),
          fetch(`/api/cari/customers?companyId=${companyId}`),
          fetch(`/api/finans/accounts?companyId=${companyId}`),
          fetch(`/api/depolar?companyId=${companyId}`),
        ])

        if (!cancelled && whRes.ok) {
          const data = await whRes.json()
          const list = Array.isArray(data) ? data : []
          setWarehouses(list)
          const def = list.find((w: any) => w.isDefault) ?? list[0]
          if (def) setWarehouseId((prev) => prev || def.id)
        }

        if (!cancelled && prodRes.ok) {
          const data = await prodRes.json()
          setProducts(
            (Array.isArray(data) ? data : []).map((p: any) => ({
              id: p.id,
              name: p.name,
              code: p.code,
              salePrice: p.salePrice != null ? Number(p.salePrice) : null,
              vatRate: Number(p.vatRate) || 20,
              unit: p.unit,
            }))
          )
        }
        if (!cancelled && custRes.ok) {
          const data = await custRes.json()
          const items = Array.isArray(data) ? data : data?.items ?? []
          setCustomers(
            items.map((c: any) => ({ id: c.id, name: c.name, taxNumber: c.taxNumber }))
          )
        }
        if (!cancelled && accRes.ok) {
          const data = await accRes.json()
          const list: FinancialAccount[] = (Array.isArray(data) ? data : []).map((a: any) => ({
            id: a.id,
            name: a.name,
            type: a.type,
          }))
          setAccounts(list)
          // Varsayılan olarak ilk kasa (CASH) hesabını seç, yoksa ilk hesabı.
          const firstCash = list.find((a) => a.type === "CASH") ?? list[0]
          if (firstCash) setAccountId((prev) => prev || firstCash.id)
        }
      } catch (error) {
        console.error("Hızlı satış verileri yüklenemedi:", error)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [companyId])

  const addProductToCart = useCallback((product: ComboboxProduct) => {
    setCart((prev) => {
      // Aynı ürün zaten sepetteyse miktarı artır.
      if (product.id) {
        const existingIdx = prev.findIndex((l) => l.productId === product.id)
        if (existingIdx >= 0) {
          const next = [...prev]
          next[existingIdx] = { ...next[existingIdx], quantity: next[existingIdx].quantity + 1 }
          return next
        }
      }
      return [
        ...prev,
        {
          key:
            typeof crypto !== "undefined" && "randomUUID" in crypto
              ? crypto.randomUUID()
              : `${Date.now()}-${Math.random()}`,
          productId: product.id || null,
          description: product.name,
          unit: product.unit || "ADET",
          quantity: 1,
          unitPrice: product.salePrice != null ? Number(product.salePrice) : 0,
          vatRate: Number(product.vatRate) || 0,
        },
      ]
    })
  }, [])

  const updateLine = useCallback((key: string, patch: Partial<CartLine>) => {
    setCart((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  }, [])

  const removeLine = useCallback((key: string) => {
    setCart((prev) => prev.filter((l) => l.key !== key))
  }, [])

  const totals = useMemo(() => {
    return cart.reduce(
      (acc, line) => {
        const t = lineTotals(line)
        acc.net += t.net
        acc.vat += t.vat
        acc.total += t.total
        return acc
      },
      { net: 0, vat: 0, total: 0 }
    )
  }, [cart])

  const resetSale = useCallback(() => {
    setCart([])
    setSelectedCustomerId(undefined)
    setIsCredit(false)
    setEArsiv(false)
    setPaymentMethod("CASH")
  }, [])

  const handleComplete = useCallback(async () => {
    if (!companyId) {
      toast({ title: "Hata", description: "Firma seçili değil", variant: "destructive" })
      return
    }
    if (cart.length === 0) {
      toast({ title: "Sepet boş", description: "En az bir ürün ekleyin", variant: "destructive" })
      return
    }
    if (cart.some((l) => l.quantity <= 0)) {
      toast({ title: "Geçersiz miktar", description: "Tüm satırlarda miktar 0'dan büyük olmalı", variant: "destructive" })
      return
    }

    setIsSubmitting(true)
    try {
      const useEArsiv = eArsiv && isEDonusumEnabled
      const invoiceRes = await fetch("/api/e-donusum/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId,
          type: "SALES",
          invoiceType: useEArsiv ? "E_ARCHIVE" : "MANUAL",
          customerId: selectedCustomerId || null,
          warehouseId: warehouseId || undefined,
          date: new Date().toISOString(),
          currency: "TRY",
          sendInvoice: useEArsiv,
          items: cart.map((l) => ({
            productId: l.productId || undefined,
            description: l.description,
            unit: l.unit,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            vatRate: l.vatRate,
          })),
        }),
      })

      const invoice = await invoiceRes.json().catch(() => ({}))
      if (!invoiceRes.ok) {
        throw new Error(invoice?.error || "Satış faturası oluşturulamadı")
      }

      // Tahsilat (veresiye değilse ve tutar > 0)
      if (!isCredit && totals.total > 0) {
        const payRes = await fetch("/api/faturalar/odemeler", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            invoiceId: invoice.id,
            companyId,
            amount: totals.total,
            paymentMethod,
            accountId: accountId || undefined,
            paymentDate: new Date().toISOString(),
          }),
        })
        if (!payRes.ok) {
          const payErr = await payRes.json().catch(() => ({}))
          // Fatura oluştu ama tahsilat başarısız: kullanıcıyı uyar, ekranı sıfırlama.
          toast({
            title: "Fatura oluştu, tahsilat kaydedilemedi",
            description: payErr?.error || "Ödemeyi Satış Faturaları üzerinden tekrar deneyin",
            variant: "destructive",
          })
          setIsSubmitting(false)
          return
        }
      }

      toast({
        title: "Satış tamamlandı",
        description: `${invoice.invoiceNo ?? "Fatura"} oluşturuldu${
          isCredit ? " (veresiye)" : ` • ${currency(totals.total)} tahsil edildi`
        }`,
      })
      resetSale()
    } catch (error: any) {
      toast({
        title: "Hata",
        description: error?.message || "Satış tamamlanamadı",
        variant: "destructive",
      })
    } finally {
      setIsSubmitting(false)
    }
  }, [
    companyId,
    cart,
    eArsiv,
    isEDonusumEnabled,
    selectedCustomerId,
    warehouseId,
    isCredit,
    totals.total,
    paymentMethod,
    accountId,
    toast,
    resetSale,
  ])

  if (!companyId) {
    return (
      <div className="flex items-center justify-center p-8">
        <p className="text-muted-foreground">Lütfen bir firma seçin</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-kobipo-blue/10 text-kobipo-blue">
          <Zap className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Hızlı Satış</h1>
          <p className="text-sm text-muted-foreground">
            Ürün ekleyip tek ekranda satışı kapatın
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Sol: Sepet */}
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Ürün Ekle</CardTitle>
              <CardDescription>Ad veya kod ile ara; bulunmazsa anında yeni ürün oluştur</CardDescription>
            </CardHeader>
            <CardContent>
              <ProductCombobox
                companyId={companyId}
                products={products}
                defaults={{ unit: "ADET", vatRate: 20 }}
                priceContext="sale"
                onSelect={addProductToCart}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Sepet</CardTitle>
              <CardDescription>{cart.length} kalem</CardDescription>
            </CardHeader>
            <CardContent>
              {cart.length === 0 ? (
                <div className="py-8 text-center text-muted-foreground">
                  <ShoppingCart className="mx-auto mb-2 h-6 w-6 opacity-50" />
                  Sepet boş — yukarıdan ürün ekleyin
                </div>
              ) : (
                <>
                  {/* Masaüstü: tablo */}
                  <div className="hidden md:block">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Ürün/Açıklama</TableHead>
                          <TableHead className="w-24 text-right">Miktar</TableHead>
                          <TableHead className="w-32 text-right">Birim Fiyat</TableHead>
                          <TableHead className="w-20 text-right">KDV %</TableHead>
                          <TableHead className="w-32 text-right">Tutar</TableHead>
                          <TableHead className="w-12" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {cart.map((line) => {
                          const t = lineTotals(line)
                          return (
                            <TableRow key={line.key}>
                              <TableCell>
                                <Input
                                  value={line.description}
                                  onChange={(e) => updateLine(line.key, { description: e.target.value })}
                                  className="min-w-[160px]"
                                />
                              </TableCell>
                              <TableCell className="text-right">
                                <Input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  value={numInput(line.quantity)}
                                  placeholder="0"
                                  onChange={(e) =>
                                    updateLine(line.key, { quantity: parseFloat(e.target.value) || 0 })
                                  }
                                  className="w-20 text-right"
                                />
                              </TableCell>
                              <TableCell className="text-right">
                                <Input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  value={numInput(line.unitPrice)}
                                  placeholder="0"
                                  onChange={(e) =>
                                    updateLine(line.key, { unitPrice: parseFloat(e.target.value) || 0 })
                                  }
                                  className="w-28 text-right"
                                />
                              </TableCell>
                              <TableCell className="text-right">
                                <Input
                                  type="number"
                                  step="1"
                                  min="0"
                                  value={numInput(line.vatRate)}
                                  placeholder="0"
                                  onChange={(e) =>
                                    updateLine(line.key, { vatRate: parseFloat(e.target.value) || 0 })
                                  }
                                  className="w-16 text-right"
                                />
                              </TableCell>
                              <TableCell className="text-right font-semibold whitespace-nowrap">
                                {currency(t.total)}
                              </TableCell>
                              <TableCell>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => removeLine(line.key)}
                                  title="Satırı sil"
                                >
                                  <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                              </TableCell>
                            </TableRow>
                          )
                        })}
                      </TableBody>
                    </Table>
                  </div>

                  {/* Mobil: kart listesi */}
                  <div className="space-y-3 md:hidden">
                    {cart.map((line) => {
                      const t = lineTotals(line)
                      return (
                        <div key={line.key} className="rounded-lg border p-3">
                          <div className="flex items-start gap-2">
                            <Input
                              value={line.description}
                              onChange={(e) => updateLine(line.key, { description: e.target.value })}
                              className="flex-1"
                            />
                            <Button
                              variant="ghost"
                              size="icon"
                              className="shrink-0"
                              onClick={() => removeLine(line.key)}
                              title="Satırı sil"
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                          <div className="mt-3 grid grid-cols-3 gap-2">
                            <div className="space-y-1">
                              <Label className="text-xs text-muted-foreground">Miktar</Label>
                              <Input
                                type="number"
                                step="0.01"
                                min="0"
                                inputMode="decimal"
                                value={numInput(line.quantity)}
                                placeholder="0"
                                onChange={(e) =>
                                  updateLine(line.key, { quantity: parseFloat(e.target.value) || 0 })
                                }
                                className="text-right"
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs text-muted-foreground">Birim Fiyat</Label>
                              <Input
                                type="number"
                                step="0.01"
                                min="0"
                                inputMode="decimal"
                                value={numInput(line.unitPrice)}
                                placeholder="0"
                                onChange={(e) =>
                                  updateLine(line.key, { unitPrice: parseFloat(e.target.value) || 0 })
                                }
                                className="text-right"
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs text-muted-foreground">KDV %</Label>
                              <Input
                                type="number"
                                step="1"
                                min="0"
                                inputMode="decimal"
                                value={numInput(line.vatRate)}
                                placeholder="0"
                                onChange={(e) =>
                                  updateLine(line.key, { vatRate: parseFloat(e.target.value) || 0 })
                                }
                                className="text-right"
                              />
                            </div>
                          </div>
                          <div className="mt-3 flex justify-between border-t pt-2 text-sm">
                            <span className="text-muted-foreground">Satır Tutarı</span>
                            <span className="font-semibold">{currency(t.total)}</span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Sağ: Müşteri + Ödeme + Özet */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Müşteri</CardTitle>
              <CardDescription>Opsiyonel — boş bırakılırsa perakende satış</CardDescription>
            </CardHeader>
            <CardContent>
              <CounterpartyCombobox
                customers={customers}
                suppliers={[]}
                selectedCustomerId={selectedCustomerId}
                onSelect={(sel) =>
                  setSelectedCustomerId(sel && sel.kind === "customer" ? sel.id : undefined)
                }
                placeholder="Müşteri ara (opsiyonel)…"
              />
            </CardContent>
          </Card>

          {warehouses.length > 1 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Depo</CardTitle>
                <CardDescription>Stok bu depodan düşülecek</CardDescription>
              </CardHeader>
              <CardContent>
                <Select value={warehouseId} onValueChange={setWarehouseId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Depo seçin" />
                  </SelectTrigger>
                  <SelectContent>
                    {warehouses.map((w) => (
                      <SelectItem key={w.id} value={w.id}>
                        {w.name} {w.isDefault ? "(Ana)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Ödeme</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={isCredit}
                  onChange={(e) => setIsCredit(e.target.checked)}
                  className="rounded"
                />
                Veresiye (tahsilat alma)
              </label>

              {!isCredit && (
                <>
                  <div className="space-y-1.5">
                    <Label>Ödeme Yöntemi</Label>
                    <Select value={paymentMethod} onValueChange={(v) => setPaymentMethod(v as PaymentMethod)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PAYMENT_METHODS.map((m) => (
                          <SelectItem key={m.value} value={m.value}>
                            {m.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <Label>Kasa / Banka Hesabı</Label>
                    {accounts.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        Tanımlı hesap yok — tahsilat hesaba işlenmeyecek.
                      </p>
                    ) : (
                      <Select value={accountId} onValueChange={setAccountId}>
                        <SelectTrigger>
                          <SelectValue placeholder="Hesap seçin" />
                        </SelectTrigger>
                        <SelectContent>
                          {accounts.map((a) => (
                            <SelectItem key={a.id} value={a.id}>
                              {a.name} {a.type === "CASH" ? "(Kasa)" : "(Banka)"}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                </>
              )}

              {isEDonusumEnabled && (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={eArsiv}
                    onChange={(e) => setEArsiv(e.target.checked)}
                    className="rounded"
                  />
                  E-Arşiv olarak kes (GİB'e gönder)
                </label>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-2 pt-6">
              <div className="flex justify-between text-sm text-muted-foreground">
                <span>Ara Toplam</span>
                <span>{currency(totals.net)}</span>
              </div>
              <div className="flex justify-between text-sm text-muted-foreground">
                <span>KDV</span>
                <span>{currency(totals.vat)}</span>
              </div>
              <div className="flex justify-between border-t pt-2 text-lg font-bold">
                <span>Genel Toplam</span>
                <span>{currency(totals.total)}</span>
              </div>

              <Button
                className="mt-2 w-full"
                size="lg"
                onClick={handleComplete}
                disabled={isSubmitting || cart.length === 0}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    İşleniyor…
                  </>
                ) : (
                  "Satışı Tamamla"
                )}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
