"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { Check, XCircle, Clock, Copy, CreditCard, FileUp, Loader2, Paperclip } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/use-toast"

// Havale/EFT ödeme bilgileri.
export const HAVALE_INFO = {
  unvan: "REYPO BİLİŞİM SANAYİ VE TİCARET LİMİTED ŞİRKETİ",
  iban: "TR80 0004 6006 9988 8000 1626 97",
}

interface KontorOrder {
  id: string
  packageName: string
  totalPrice: string | number
  currency: string
  status: string
  paymentMethod?: string
  /** Havale açıklamasına yazılacak referans kodu (havale siparişlerinde dolu). */
  paymentCode?: string | null
  paymentNote?: string | null
  receiptFileName?: string | null
  receiptUploadedAt?: string | null
}

const HAVALE_STEPS = ["Sipariş", "Havale", "Onay", "Yüklendi"]
const CARD_STEPS = ["Sipariş", "Ödeme", "Yüklendi"]

function statusToStep(status: string, isCard: boolean): { current: number; failed: boolean } {
  if (isCard) {
    switch (status) {
      case "PENDING_PAYMENT":
        return { current: 1, failed: false } // Ödeme
      case "LOADED":
        return { current: 3, failed: false }
      case "FAILED":
        return { current: 2, failed: true } // ödeme alındı, yükleme başarısız
      default:
        return { current: 0, failed: false }
    }
  }
  switch (status) {
    case "PENDING_PAYMENT":
      return { current: 1, failed: false }
    case "PAYMENT_REVIEW":
      return { current: 2, failed: false }
    case "LOADED":
      return { current: 4, failed: false }
    case "FAILED":
      return { current: 3, failed: true }
    default:
      return { current: 0, failed: false }
  }
}

export function OrderStepper({
  status,
  paymentMethod,
}: {
  status: string
  paymentMethod?: string
}) {
  const isCard = paymentMethod === "CARD"
  const steps = isCard ? CARD_STEPS : HAVALE_STEPS
  const { current, failed } = statusToStep(status, isCard)
  return (
    <div className="flex items-center">
      {steps.map((label, i) => {
        const done = i < current
        const active = i === current && !failed
        const isFail = failed && i === current
        return (
          <div key={label} className="flex flex-1 items-center last:flex-none">
            <div className="flex flex-col items-center">
              <div
                className={[
                  "flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold",
                  done
                    ? "bg-emerald-500 text-white"
                    : isFail
                      ? "bg-red-500 text-white"
                      : active
                        ? "bg-kobipo-blue text-white dark:bg-primary"
                        : "bg-muted text-muted-foreground",
                ].join(" ")}
              >
                {done ? <Check className="h-4 w-4" /> : isFail ? <XCircle className="h-4 w-4" /> : i + 1}
              </div>
              <span
                className={[
                  "mt-1 text-[10px]",
                  done || active ? "font-medium text-foreground" : "text-muted-foreground",
                ].join(" ")}
              >
                {label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div className={`mx-1 h-0.5 flex-1 ${i < current ? "bg-emerald-500" : "bg-muted"}`} />
            )}
          </div>
        )
      })}
    </div>
  )
}

/**
 * Havale siparişinin ödeme kutusu: IBAN + açıklamaya yazılacak KOD + dekont yükleme.
 *
 * Kod neden önemli: hesap hareketini siparişle eşleştiren tek alan bu. Dekont
 * yüklenince sipariş PAYMENT_REVIEW'a geçer ve sistem-admin onay kuyruğuna düşer
 * ([[app/api/kontor/orders/[id]/receipt]]).
 */
function HavalePaymentBox({
  order,
  onUploaded,
}: {
  order: KontorOrder
  onUploaded: () => void
}) {
  const { toast } = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)

  const copy = (text: string, title: string) => {
    navigator.clipboard?.writeText(text)
    toast({ title })
  }

  const upload = async () => {
    if (!file) return
    setBusy(true)
    try {
      const fd = new FormData()
      fd.append("file", file)
      if (note.trim()) fd.append("note", note.trim())
      const res = await fetch(`/api/kontor/orders/${order.id}/receipt`, {
        method: "POST",
        body: fd,
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || "Dekont yüklenemedi")
      toast({
        title: "Dekont alındı",
        description: "Ödemeniz kontrol edilip onaylanınca kontör otomatik yüklenecek.",
      })
      setFile(null)
      setNote("")
      if (fileRef.current) fileRef.current.value = ""
      onUploaded()
    } catch (e) {
      toast({
        title: "Hata",
        description: e instanceof Error ? e.message : "Dekont yüklenemedi",
        variant: "destructive",
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-4 space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-900/40 dark:bg-amber-950/30">
      <p className="flex items-center gap-1.5 font-semibold text-amber-900 dark:text-amber-200">
        <Clock className="h-4 w-4" /> Havale / EFT yapın
      </p>

      <div className="space-y-1">
        <p className="text-amber-900/90 dark:text-amber-200/90">{HAVALE_INFO.unvan}</p>
        <div className="flex items-center gap-2">
          <span className="font-mono text-amber-900 dark:text-amber-200">{HAVALE_INFO.iban}</span>
          <button
            type="button"
            onClick={() => copy(HAVALE_INFO.iban.replace(/\s/g, ""), "IBAN kopyalandı")}
            className="text-amber-700 hover:text-amber-900 dark:text-amber-300"
            aria-label="IBAN'ı kopyala"
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Açıklama kodu — eşleştirmenin anahtarı, bu yüzden vurgulu. */}
      <div className="rounded-md border border-amber-300 bg-white/70 p-2.5 dark:border-amber-800 dark:bg-amber-900/20">
        <p className="text-xs text-amber-900/80 dark:text-amber-200/80">
          Havale <span className="font-semibold">açıklamasına</span> bu kodu yazın:
        </p>
        <div className="mt-1 flex items-center gap-2">
          <span className="font-mono text-lg font-bold tracking-wider text-amber-900 dark:text-amber-100">
            {order.paymentCode || order.id}
          </span>
          <button
            type="button"
            onClick={() => copy(order.paymentCode || order.id, "Kod kopyalandı")}
            className="text-amber-700 hover:text-amber-900 dark:text-amber-300"
            aria-label="Kodu kopyala"
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Dekont yükleme */}
      <div className="space-y-2 border-t border-amber-200 pt-3 dark:border-amber-900/40">
        <p className="text-xs font-semibold text-amber-900 dark:text-amber-200">
          Parayı gönderdiyseniz dekontu yükleyin
        </p>
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.png,.jpg,.jpeg,.webp"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="block w-full text-xs text-amber-900 file:mr-2 file:rounded-md file:border-0 file:bg-amber-200 file:px-2.5 file:py-1.5 file:text-xs file:font-medium file:text-amber-900 hover:file:bg-amber-300 dark:text-amber-200 dark:file:bg-amber-900/50 dark:file:text-amber-100"
        />
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value.slice(0, 500))}
          placeholder="Not (isteğe bağlı): gönderen ad, tarih…"
          className="w-full rounded-md border border-amber-200 bg-white/70 px-2.5 py-1.5 text-xs text-amber-900 placeholder:text-amber-700/50 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-100 dark:placeholder:text-amber-200/40"
        />
        <Button type="button" size="sm" onClick={upload} disabled={!file || busy}>
          {busy ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          ) : (
            <FileUp className="mr-1.5 h-4 w-4" />
          )}
          Dekontu gönder
        </Button>
        <p className="text-[11px] text-amber-800/80 dark:text-amber-300/80">
          PDF veya görsel, en fazla 10 MB.
        </p>
      </div>
    </div>
  )
}

/**
 * Firmanın devam eden (ödeme/onay bekleyen) kontör siparişlerini adım çubuğu ile gösterir.
 * Kart siparişlerinde "Ödemeye devam et" linki, havale siparişlerinde IBAN + açıklama kodu
 * ve dekont yükleme çıkar. Aktif sipariş yoksa hiçbir şey render etmez. `refreshKey`
 * değişince yeniden çeker.
 */
export function KontorActiveOrders({
  companyId,
  refreshKey,
}: {
  companyId: string
  refreshKey?: number
}) {
  const [orders, setOrders] = useState<KontorOrder[]>([])
  // Dekont yüklendikten sonra listeyi tazelemek için (durum PAYMENT_REVIEW'a geçer).
  const [localRefresh, setLocalRefresh] = useState(0)

  const reload = useCallback(() => setLocalRefresh((n) => n + 1), [])

  useEffect(() => {
    let cancelled = false
    fetch(`/api/kontor/orders?companyId=${companyId}`, { cache: "no-store" })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}))
        if (!cancelled && r.ok && Array.isArray(d?.data)) setOrders(d.data)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [companyId, refreshKey, localRefresh])

  const active = orders.filter(
    (o) => o.status === "PENDING_PAYMENT" || o.status === "PAYMENT_REVIEW",
  )
  if (active.length === 0) return null

  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Devam eden siparişiniz
      </p>
      {active.map((o) => {
        const isCard = o.paymentMethod === "CARD"
        return (
          <div key={o.id} className="rounded-xl border bg-muted/30 p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="font-semibold">{o.packageName}</span>
              <span className="text-sm text-muted-foreground">
                {Number(o.totalPrice).toLocaleString("tr-TR")} {o.currency}
              </span>
            </div>
            <OrderStepper status={o.status} paymentMethod={o.paymentMethod} />

            {/* Kart siparişi, ödeme tamamlanmamış → checkout'a dön */}
            {o.status === "PENDING_PAYMENT" && isCard && (
              <div className="mt-4 space-y-2 rounded-lg border border-kobipo-blue/30 bg-kobipo-blue/5 p-3 text-sm dark:border-primary/30 dark:bg-primary/10">
                <p className="flex items-center gap-1.5 font-semibold text-kobipo-navy dark:text-foreground">
                  <CreditCard className="h-4 w-4" /> Kart ödemesi bekleniyor
                </p>
                <p className="text-muted-foreground">
                  Ödemeniz henüz tamamlanmadı. Aşağıdan güvenli ödeme ekranına dönüp tamamlayabilirsiniz.
                </p>
                <Button asChild size="sm" className="mt-1">
                  <Link href={`/e-donusum/kontor/odeme/${o.id}?company=${encodeURIComponent(companyId)}`}>
                    Ödemeye devam et
                  </Link>
                </Button>
              </div>
            )}

            {/* Havale siparişi → IBAN + açıklama kodu + dekont yükleme */}
            {o.status === "PENDING_PAYMENT" && !isCard && (
              <HavalePaymentBox order={o} onUploaded={reload} />
            )}

            {/* Dekont yüklendi → onay kuyruğunda. Yanlış dosya yüklendiyse değiştirilebilir. */}
            {o.status === "PAYMENT_REVIEW" && (
              <div className="mt-4 space-y-2 rounded-lg border bg-background p-3 text-sm">
                <p className="font-semibold">Dekontunuz alındı, onay bekleniyor</p>
                <p className="text-xs text-muted-foreground">
                  Ödeme kontrol edilip onaylanınca kontör hesabınıza otomatik yüklenecek.
                </p>
                {o.receiptFileName && (
                  <a
                    href={`/api/kontor/orders/${o.id}/receipt`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-kobipo-blue underline underline-offset-2 dark:text-primary"
                  >
                    <Paperclip className="h-3.5 w-3.5" />
                    {o.receiptFileName}
                  </a>
                )}
                <details className="text-xs">
                  <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                    Yanlış dekont mu yüklediniz? Değiştirin
                  </summary>
                  <HavalePaymentBox order={o} onUploaded={reload} />
                </details>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
