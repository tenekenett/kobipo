"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/components/ui/use-toast"
import { Loader2, CreditCard, Banknote, CheckCircle2, AlertTriangle, Receipt } from "lucide-react"
import {
  BillingInfoForm,
  EMPTY_BILLING,
  missingBillingFields,
  type BillingFormValue,
} from "@/components/invoicing/billing-info-form"

interface KontorPackage {
  id: string
  name: string
  description: string | null
  creditQty: number
  price: string | number
  currency: string
}

interface KontorOrder {
  id: string
  packageName: string
  creditQty: number
  totalPrice: string | number
  currency: string
  status: string
  paymentMethod?: string
  createdAt: string
  /** Kesilen satış faturası — dolu ise müşteri PDF'i indirebilir. */
  invoiceId?: string | null
}

const STATUS_LABEL: Record<string, { text: string; variant: "secondary" | "default" | "destructive" }> = {
  PENDING_PAYMENT: { text: "Havale bekleniyor", variant: "secondary" },
  PAYMENT_REVIEW: { text: "Onay bekleniyor", variant: "secondary" },
  LOADED: { text: "Yüklendi", variant: "default" },
  REJECTED: { text: "Reddedildi", variant: "destructive" },
  FAILED: { text: "Başarısız", variant: "destructive" },
}

export function KontorPurchaseDialog({
  companyId,
  onPurchased,
  trigger,
}: {
  companyId: string
  onPurchased?: () => void
  trigger: React.ReactNode
}) {
  const { toast } = useToast()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [packages, setPackages] = useState<KontorPackage[]>([])
  const [orders, setOrders] = useState<KontorOrder[]>([])
  const [paytrEnabled, setPaytrEnabled] = useState(false)
  const [loading, setLoading] = useState(false)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  // FATURA BİLGİSİ: satış faturası ödeme sonrası otomatik kesilir, o yüzden bilgi
  // ödeme ÖNCESİ tam olmalı. Kartı zaten dolu olan müşteri formu hiç açmaz.
  const [billing, setBilling] = useState<BillingFormValue>(EMPTY_BILLING)
  const [billingOpen, setBillingOpen] = useState(false)
  const [invalidFields, setInvalidFields] = useState<string[]>([])

  const load = async () => {
    setLoading(true)
    try {
      const [pRes, oRes, bRes] = await Promise.all([
        fetch("/api/kontor/packages"),
        fetch(`/api/kontor/orders?companyId=${companyId}`),
        fetch(`/api/invoicing/billing-info?companyId=${encodeURIComponent(companyId)}`),
      ])
      const pData = await pRes.json().catch(() => ({}))
      setPackages(pRes.ok && Array.isArray(pData?.data) ? pData.data : [])
      setPaytrEnabled(pRes.ok && Boolean(pData?.paytrEnabled))
      const oData = await oRes.json().catch(() => ({}))
      setOrders(oRes.ok && Array.isArray(oData?.data) ? oData.data : [])

      const bData = await bRes.json().catch(() => ({}))
      if (bRes.ok && bData?.billing) {
        setBilling({ ...EMPTY_BILLING, ...bData.billing })
        // Eksikse formu baştan açık göster: kullanıcı ödemeye kadar gidip 412
        // yemesin, eksiği burada görsün.
        setBillingOpen(!bData.complete)
        setInvalidFields(Array.isArray(bData.missing) ? bData.missing : [])
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const buy = async (pkg: KontorPackage, paymentMethod: "CARD" | "HAVALE") => {
    // Ödemeye gitmeden önce eksikleri göster — sunucu zaten 412 döner, ama kullanıcıyı
    // hataya çarptırmaktansa formu açıp işaretlemek daha doğru.
    const missing = missingBillingFields(billing)
    if (missing.length > 0) {
      setInvalidFields(missing)
      setBillingOpen(true)
      toast({
        title: "Fatura bilgileri eksik",
        description: "Satışınız için fatura düzenlenebilmesi adına işaretli alanları doldurun.",
        variant: "destructive",
      })
      return
    }

    setBusyKey(`${pkg.id}:${paymentMethod}`)
    try {
      const res = await fetch("/api/kontor/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, packageId: pkg.id, paymentMethod, billing }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.status === 412) {
        setInvalidFields(Array.isArray(data?.fields) ? data.fields : [])
        setBillingOpen(true)
      }
      if (!res.ok) throw new Error(data?.error || "Sipariş oluşturulamadı")
      setInvalidFields([])

      if (paymentMethod === "CARD") {
        // Kart ödemesi → PayTR checkout sayfasına geç (company poll için gerekli).
        setOpen(false)
        router.push(`/e-donusum/kontor/odeme/${data.id}?company=${encodeURIComponent(companyId)}`)
        return
      }

      toast({
        title: "Sipariş oluşturuldu",
        description:
          "IBAN, açıklamaya yazacağınız kod ve dekont yükleme, Kontör kartındaki " +
          "'Devam eden siparişiniz' bölümünde.",
      })
      await load()
      onPurchased?.()
    } catch (e) {
      toast({
        title: "Hata",
        description: e instanceof Error ? e.message : "Bir hata oluştu",
        variant: "destructive",
      })
    } finally {
      setBusyKey(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Kontör Satın Al</DialogTitle>
          <DialogDescription>
            {paytrEnabled
              ? "Paket seçin → kart ile anında ödeyin (veya havale + dekont) → kontör hesabınıza yüklenir."
              : "Paket seçin → kodu açıklamaya yazıp havale edin → dekontu yükleyin → onaylanınca kontör otomatik yüklenir."}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Yükleniyor…
          </div>
        ) : (
          <div className="space-y-5">
            {/* Fatura bilgileri — ödeme sonrası fatura otomatik kesildiği için zorunlu. */}
            <div className="space-y-2 rounded-lg border p-3">
              <button
                type="button"
                onClick={() => setBillingOpen((v) => !v)}
                className="flex w-full items-center justify-between gap-2 text-left"
              >
                <span className="flex items-center gap-2 text-sm font-semibold">
                  <Receipt className="h-4 w-4" />
                  Fatura Bilgileri
                </span>
                <span className="text-xs text-muted-foreground">
                  {invalidFields.length > 0
                    ? "Eksik — doldurun"
                    : billingOpen
                      ? "Gizle"
                      : "Düzenle"}
                </span>
              </button>
              {billingOpen ? (
                <BillingInfoForm
                  value={billing}
                  onChange={(v) => {
                    setBilling(v)
                    if (invalidFields.length > 0) setInvalidFields(missingBillingFields(v))
                  }}
                  invalidFields={invalidFields}
                />
              ) : (
                <p className="text-xs text-muted-foreground">
                  {billing.name} · {billing.taxNumber}
                </p>
              )}
            </div>

            {/* Paketler */}
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Paketler
              </p>
              {packages.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Şu an satışta paket yok. Lütfen daha sonra tekrar deneyin.
                </p>
              ) : (
                packages.map((p) => (
                  <div key={p.id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                    <div className="min-w-0">
                      <p className="font-semibold">{p.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {p.creditQty.toLocaleString("tr-TR")} kontör
                        {p.description ? ` · ${p.description}` : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-2">
                      <span className="font-bold text-kobipo-navy dark:text-foreground">
                        {Number(p.price).toLocaleString("tr-TR")} {p.currency}
                      </span>
                      <div className="flex flex-wrap justify-end gap-2">
                        {paytrEnabled && (
                          <Button
                            size="sm"
                            onClick={() => buy(p, "CARD")}
                            disabled={busyKey !== null}
                          >
                            {busyKey === `${p.id}:CARD` ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <CreditCard className="h-4 w-4" />
                            )}
                            <span className="ml-1">Kart ile Öde</span>
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant={paytrEnabled ? "outline" : "default"}
                          onClick={() => buy(p, "HAVALE")}
                          disabled={busyKey !== null}
                        >
                          {busyKey === `${p.id}:HAVALE` ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Banknote className="h-4 w-4" />
                          )}
                          <span className="ml-1">Havale/EFT</span>
                        </Button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Siparişlerim (sade liste; süreç/havale Kontör kartında) */}
            {orders.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Siparişlerim
                </p>
                {orders.map((o) => {
                  // PENDING_PAYMENT etiketi ödeme yöntemine göre: kart → "Ödeme bekleniyor".
                  const st =
                    o.status === "PENDING_PAYMENT" && o.paymentMethod === "CARD"
                      ? { text: "Ödeme bekleniyor", variant: "secondary" as const }
                      : STATUS_LABEL[o.status] || { text: o.status, variant: "secondary" as const }
                  return (
                    <div key={o.id} className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm">
                      <span className="flex items-center gap-2">
                        {o.status === "LOADED" ? (
                          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                        ) : o.status === "REJECTED" || o.status === "FAILED" ? (
                          <AlertTriangle className="h-4 w-4 text-muted-foreground" />
                        ) : null}
                        {o.packageName}
                        <span className="text-xs text-muted-foreground">
                          {Number(o.totalPrice).toLocaleString("tr-TR")} {o.currency}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        {/* Fatura satıcı firmanın kayıtlarında durur; bu uç yetkiyi
                            siparişin sahipliğine bakarak verir. */}
                        {o.invoiceId && (
                          <a
                            href={`/api/kontor/orders/${o.id}/invoice-pdf`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-xs font-medium text-kobipo-blue underline underline-offset-2 dark:text-primary"
                          >
                            <Receipt className="h-3.5 w-3.5" />
                            Fatura
                          </a>
                        )}
                        <Badge variant={st.variant}>{st.text}</Badge>
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
