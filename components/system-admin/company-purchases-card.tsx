"use client"

// Bir hesabın SATIN ALMA GEÇMİŞİ — destek ekibinin "bu müşteri neyi ne kadara aldı"
// sorusuna baktığı tek ekran.
//
// Tasarım kararı: her sipariş AÇILABİLİR ve açıldığında tutarın kalem dökümünü basar
// (`PackageOrder.priceLines`). Tek başına toplam tutar bir fiyat şikâyetini çözmeye
// yetmiyor — "1.500 TL çekilmiş" bilgisi, hangi modülün kaç lira yazıldığını
// söylemiyor. Döküm kaydedilmemişse bu AÇIKÇA yazılır; katalogdan yeniden hesaplayıp
// bugünün fiyatını geçmişe yazmak, cevapsızlıktan daha kötü olurdu.

import { useState } from "react"
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Coins,
  CreditCard,
  History,
  Receipt,
  ShoppingBag,
} from "lucide-react"
import type {
  AccountPurchaseHistory,
  KontorPurchase,
  PackagePurchase,
} from "@/lib/billing/purchase-history"

const tl = new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" })
const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString("tr-TR") : "—")
const fmtDateTime = (d: string | null) => (d ? new Date(d).toLocaleString("tr-TR") : "—")

const CYCLE_LABEL: Record<string, string> = { MONTHLY: "Aylık", YEARLY: "Yıllık" }

const PACKAGE_STATUS: Record<string, { label: string; cls: string }> = {
  PENDING_PAYMENT: { label: "Ödeme bekliyor", cls: "bg-amber-500/15 text-amber-300 border-amber-500/30" },
  ACTIVE: { label: "Ödendi", cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" },
  FAILED: { label: "Başarısız", cls: "bg-red-500/15 text-red-300 border-red-500/30" },
  CANCELLED: { label: "İptal", cls: "bg-slate-500/15 text-slate-400 border-slate-600/40" },
}

const KONTOR_STATUS: Record<string, { label: string; cls: string }> = {
  PENDING_PAYMENT: { label: "Ödeme bekliyor", cls: "bg-amber-500/15 text-amber-300 border-amber-500/30" },
  PAYMENT_REVIEW: { label: "Dekont incelemede", cls: "bg-sky-500/15 text-sky-300 border-sky-500/30" },
  LOADED: { label: "Yüklendi", cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" },
  REJECTED: { label: "Reddedildi", cls: "bg-red-500/15 text-red-300 border-red-500/30" },
  FAILED: { label: "Başarısız", cls: "bg-red-500/15 text-red-300 border-red-500/30" },
}

function Badge({ label, cls }: { label: string; cls?: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${
        cls ?? "bg-slate-700/40 text-slate-300 border-slate-600/40"
      }`}
    >
      {label}
    </span>
  )
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-slate-500">{label}</p>
      <p className="text-sm text-slate-200 break-words">{value || "—"}</p>
    </div>
  )
}

/**
 * Satın alma fişi + içerik.
 *
 * Birim fiyat KAYNAĞI: sipariş anında yazılmış `priceLines` (ödeme ekranındaki döküm).
 * Yoksa kesilen faturanın kalemleri. Katalogdaki GÜNCEL fiyat asla buraya girmez —
 * fiyat değişince geçmiş siparişin fişi değişmesin diye.
 */
function PriceLines({ order }: { order: PackagePurchase }) {
  if (order.lines) {
    return (
      <div className="overflow-x-auto rounded-lg border border-slate-700/60">
        <table className="w-full text-sm">
          <thead className="bg-slate-800/60 text-xs text-slate-400">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Kalem</th>
              <th className="px-3 py-2 text-right font-medium">Adet</th>
              <th className="px-3 py-2 text-right font-medium">Birim fiyat</th>
              <th className="px-3 py-2 text-right font-medium">Tutar</th>
            </tr>
          </thead>
          <tbody>
            {order.lines.map((l, i) => (
              <tr key={`${l.key}-${i}`} className="border-t border-slate-800">
                <td className="px-3 py-2 text-slate-200">{l.label}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-300">{l.qty}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-300">
                  {tl.format(l.unitPrice)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums font-medium text-slate-100">
                  {tl.format(l.total)}
                </td>
              </tr>
            ))}
            <tr className="border-t border-slate-700 bg-slate-800/40">
              <td className="px-3 py-2 text-slate-400" colSpan={3}>
                Liste tutarı
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-slate-200">
                {tl.format(order.listAmount)}
              </td>
            </tr>
            {order.discountAmount > 0 && (
              <tr className="bg-slate-800/40">
                <td className="px-3 py-2 text-emerald-300" colSpan={3}>
                  İndirim {order.discountCode ? `(${order.discountCode})` : ""}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-emerald-300">
                  −{tl.format(order.discountAmount)}
                </td>
              </tr>
            )}
            <tr className="border-t border-slate-700 bg-slate-800/60">
              <td className="px-3 py-2 font-medium text-slate-300" colSpan={3}>
                Tahsil edilen
              </td>
              <td className="px-3 py-2 text-right tabular-nums font-bold text-white">
                {tl.format(order.amount)}
              </td>
            </tr>
          </tbody>
        </table>
        {order.linesMismatch && (
          <p className="flex items-start gap-2 border-t border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Kalem toplamı liste tutarını tutmuyor. Sipariş fiyatlaması ile kaydedilen döküm
            ayrışmış — bu siparişi elden geçirin.
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {order.invoiceLines.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-slate-700/60">
          <table className="w-full text-sm">
            <thead className="bg-slate-800/60 text-xs text-slate-400">
              <tr>
                <th className="px-3 py-2 text-left font-medium">
                  Fiş kalemi{order.invoiceNo ? ` · ${order.invoiceNo}` : ""}
                </th>
                <th className="px-3 py-2 text-right font-medium">Adet</th>
                <th className="px-3 py-2 text-right font-medium">Birim fiyat</th>
                <th className="px-3 py-2 text-right font-medium">Tutar</th>
              </tr>
            </thead>
            <tbody>
              {order.invoiceLines.map((l, i) => (
                <tr key={i} className="border-t border-slate-800">
                  <td className="px-3 py-2 text-slate-200">{l.description}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-300">{l.qty}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-300">
                    {tl.format(l.unitPrice)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium text-slate-100">
                    {tl.format(l.total)}
                  </td>
                </tr>
              ))}
              <tr className="border-t border-slate-700 bg-slate-800/60">
                <td className="px-3 py-2 font-medium text-slate-300" colSpan={3}>
                  Tahsil edilen
                </td>
                <td className="px-3 py-2 text-right tabular-nums font-bold text-white">
                  {tl.format(order.amount)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded-lg border border-slate-700/60 bg-slate-800/40 p-3 text-sm text-slate-300">
          Fiş henüz yok. Tahsil edilen tutar:{" "}
          <span className="font-semibold text-white">{tl.format(order.amount)}</span>
        </div>
      )}

      {order.contentLines.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-slate-700/60">
          <table className="w-full text-sm">
            <thead className="bg-slate-800/60 text-xs text-slate-400">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Açılan içerik</th>
                <th className="px-3 py-2 text-right font-medium">Adet</th>
              </tr>
            </thead>
            <tbody>
              {order.contentLines.map((l, i) => (
                <tr key={`${l.key}-${i}`} className="border-t border-slate-800">
                  <td className="px-3 py-2 text-slate-200">{l.label}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-300">{l.qty}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-slate-500">
        Bu siparişin fişi tek satır kesilmiş; kalem birim fiyatı fişte yok, katalogdan da
        doldurulmuyor (o günkü fiyat bugünkü fiyat değildir). Bundan sonraki satın almalarda
        ödeme anındaki döküm fişle birlikte saklanır.
      </p>
    </div>
  )
}

function PackageRow({ order }: { order: PackagePurchase }) {
  const [open, setOpen] = useState(false)
  const status = PACKAGE_STATUS[order.status] ?? { label: order.status, cls: undefined }

  return (
    <div className="border-b border-slate-800 last:border-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-800/40"
      >
        {open ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-slate-500" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-slate-500" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-white">{order.title}</span>
            <span className="text-xs text-slate-500">
              {CYCLE_LABEL[order.billingCycle] ?? order.billingCycle}
            </span>
            <Badge label={status.label} cls={status.cls} />
            {order.isTest && (
              <Badge label="TEST" cls="bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30" />
            )}
          </div>
          <p className="mt-0.5 truncate text-xs text-slate-500">
            {fmtDate(order.paidAt || order.createdAt)}
            {order.modules.length > 0 && ` · ${order.modules.join(", ")}`}
            {order.branchQuota > 0 && ` · ${order.branchQuota} şube`}
            {order.companyQuota > 0 && ` · ${order.companyQuota} ek firma`}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-semibold tabular-nums text-white">{tl.format(order.amount)}</p>
          {order.discountAmount > 0 && (
            <p className="text-xs text-emerald-400">−{tl.format(order.discountAmount)}</p>
          )}
        </div>
      </button>

      {open && (
        <div className="space-y-4 bg-slate-950/40 px-4 pb-4 pt-1">
          <PriceLines order={order} />

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Detail label="Sipariş tarihi" value={fmtDateTime(order.createdAt)} />
            <Detail label="Ödeme tarihi" value={fmtDateTime(order.paidAt)} />
            <Detail label="Ödeme yöntemi" value={order.paymentProvider} />
            <Detail label="Ödeme referansı" value={order.paymentRef} />
            <Detail label="Açılan modüller" value={order.modules.join(", ")} />
            <Detail
              label="Kota"
              value={`${order.branchQuota} şube · ${order.companyQuota} ek firma`}
            />
            <Detail label="Otomatik yenileme" value={order.autoRenew ? "Açık" : "Kapalı"} />
            <Detail label="Siparişi açan" value={order.createdByName} />
            <Detail label="Fatura" value={order.invoiceNo} />
            <Detail label="Sipariş no" value={<span className="font-mono text-xs">{order.id}</span>} />
          </div>

          {order.paymentError && (
            <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              Ödeme hatası: {order.paymentError}
            </p>
          )}
          {order.invoiceError && (
            <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
              Fatura hatası: {order.invoiceError}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function KontorRow({ order }: { order: KontorPurchase }) {
  const [open, setOpen] = useState(false)
  const status = KONTOR_STATUS[order.status] ?? { label: order.status, cls: undefined }

  return (
    <div className="border-b border-slate-800 last:border-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-800/40"
      >
        {open ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-slate-500" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-slate-500" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-white">{order.packageName}</span>
            <span className="text-xs text-slate-500">{order.creditQty} kontör</span>
            <Badge label={status.label} cls={status.cls} />
            {order.isTest && (
              <Badge label="TEST" cls="bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30" />
            )}
          </div>
          <p className="mt-0.5 truncate text-xs text-slate-500">
            {fmtDate(order.paidAt || order.createdAt)} · {order.companyName} · VKN {order.targetVkn}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-semibold tabular-nums text-white">{tl.format(order.amount)}</p>
          {order.discountAmount > 0 && (
            <p className="text-xs text-emerald-400">−{tl.format(order.discountAmount)}</p>
          )}
        </div>
      </button>

      {open && (
        <div className="space-y-4 bg-slate-950/40 px-4 pb-4 pt-1">
          <div className="overflow-x-auto rounded-lg border border-slate-700/60">
            <table className="w-full text-sm">
              <thead className="bg-slate-800/60 text-xs text-slate-400">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Kalem</th>
                  <th className="px-3 py-2 text-right font-medium">Adet</th>
                  <th className="px-3 py-2 text-right font-medium">Birim fiyat</th>
                  <th className="px-3 py-2 text-right font-medium">Tutar</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-slate-800">
                  <td className="px-3 py-2 text-slate-200">{order.packageName}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-300">
                    {order.creditQty}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-300">
                    {tl.format(order.unitPrice)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium text-slate-100">
                    {tl.format(order.listAmount)}
                  </td>
                </tr>
                {order.discountAmount > 0 && (
                  <tr className="bg-slate-800/40">
                    <td className="px-3 py-2 text-emerald-300" colSpan={3}>
                      İndirim {order.discountCode ? `(${order.discountCode})` : ""}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-emerald-300">
                      −{tl.format(order.discountAmount)}
                    </td>
                  </tr>
                )}
                <tr className="border-t border-slate-700 bg-slate-800/60">
                  <td className="px-3 py-2 font-medium text-slate-300" colSpan={3}>
                    Tahsil edilen
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums font-bold text-white">
                    {tl.format(order.amount)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Detail label="Sipariş tarihi" value={fmtDateTime(order.createdAt)} />
            <Detail label="Ödeme tarihi" value={fmtDateTime(order.paidAt)} />
            <Detail
              label="Ödeme yöntemi"
              value={order.paymentMethod === "CARD" ? "Kredi kartı" : "Havale/EFT"}
            />
            <Detail label="Ödeme referansı" value={order.paymentRef} />
            <Detail label="Satın alan firma" value={order.companyName} />
            <Detail label="Yüklenen VKN" value={order.targetVkn} />
            <Detail label="Fatura" value={order.invoiceNo} />
            <Detail label="Sipariş no" value={<span className="font-mono text-xs">{order.id}</span>} />
          </div>

          {order.paymentError && (
            <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              Ödeme hatası: {order.paymentError}
            </p>
          )}
          {order.invoiceError && (
            <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
              Fatura hatası: {order.invoiceError}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

type Tab = "package" | "kontor" | "events"

export function CompanyPurchasesCard({
  history,
  companyName,
}: {
  history: AccountPurchaseHistory
  companyName: string
}) {
  const { totals, packageOrders, kontorOrders, events } = history
  const [tab, setTab] = useState<Tab>("package")

  const tabs: { id: Tab; label: string; count: number; icon: typeof CreditCard }[] = [
    { id: "package", label: "Paket & abonelik", count: packageOrders.length, icon: CreditCard },
    { id: "kontor", label: "Kontör", count: kontorOrders.length, icon: Coins },
    { id: "events", label: "Hesap hareketleri", count: events.length, icon: History },
  ]

  const summary = [
    { label: "Toplam ödenen", value: tl.format(totals.grandTotal), cls: "text-white" },
    { label: "Paket & abonelik", value: tl.format(totals.packagePaid), cls: "text-blue-300" },
    { label: "Kontör", value: tl.format(totals.kontorPaid), cls: "text-amber-300" },
    { label: "Kullanılan indirim", value: tl.format(totals.discountTotal), cls: "text-emerald-300" },
    { label: "Ödenmiş sipariş", value: String(totals.paidOrderCount), cls: "text-slate-200" },
    { label: "Başarısız sipariş", value: String(totals.failedOrderCount), cls: "text-red-300" },
  ]

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50">
      <div className="border-b border-slate-800 p-5">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
          <ShoppingBag className="h-5 w-5 text-emerald-400" />
          Satın alma geçmişi
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          {history.isAccountRoot ? (
            <>Bu hesabın bugüne kadarki tüm ödemeleri, kalem kalem dökümüyle.</>
          ) : (
            <>
              <span className="font-medium text-slate-300">{companyName}</span>{" "}
              <span className="font-medium text-slate-300">{history.rootCompanyName}</span>{" "}
              hesabına bağlı; satın alımlar hesap düzeyinde tutulduğu için burada o hesabın
              geçmişi görünür.
            </>
          )}
        </p>

        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {summary.map((s) => (
            <div key={s.label} className="rounded-lg bg-slate-800/50 p-3">
              <p className="text-xs text-slate-500">{s.label}</p>
              <p className={`text-lg font-bold tabular-nums ${s.cls}`}>{s.value}</p>
            </div>
          ))}
        </div>

        {/* Test siparişinde PayTR para ÇEKMEZ ama callback başarılı döner. Toplama
            katmak cirosu şişirirdi; sessizce elemek de "eksik para" şüphesi doğurur. */}
        {totals.testExcluded > 0 && (
          <p className="mt-3 flex items-start gap-2 rounded-lg border border-fuchsia-500/30 bg-fuchsia-500/10 px-3 py-2 text-xs text-fuchsia-300">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {tl.format(totals.testExcluded)} tutarında TEST siparişi toplamların dışında
            tutuldu: test ödemesinde karttan para çekilmez.
          </p>
        )}
      </div>

      <div className="flex gap-1 border-b border-slate-800 px-3 pt-3">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 rounded-t-lg px-3 py-2 text-sm font-medium transition-colors ${
              tab === t.id
                ? "bg-slate-800/70 text-white"
                : "text-slate-400 hover:bg-slate-800/40 hover:text-slate-200"
            }`}
          >
            <t.icon className="h-4 w-4" />
            {t.label}
            <span className="rounded-full bg-slate-700/60 px-1.5 text-xs text-slate-300">
              {t.count}
            </span>
          </button>
        ))}
      </div>

      {tab === "package" &&
        (packageOrders.length === 0 ? (
          <p className="p-5 text-sm text-slate-500">
            Bu hesapta paket/abonelik siparişi yok.
          </p>
        ) : (
          <div>
            {packageOrders.map((o) => (
              <PackageRow key={o.id} order={o} />
            ))}
          </div>
        ))}

      {tab === "kontor" &&
        (kontorOrders.length === 0 ? (
          <p className="p-5 text-sm text-slate-500">Bu hesapta kontör siparişi yok.</p>
        ) : (
          <div>
            {kontorOrders.map((o) => (
              <KontorRow key={o.id} order={o} />
            ))}
          </div>
        ))}

      {/* "Modüllerim neden kapandı / kim açtı" sorusunun cevabı. Müşteri panelinde
          vardı, sistem-admin tarafında yoktu. */}
      {tab === "events" &&
        (events.length === 0 ? (
          <p className="p-5 text-sm text-slate-500">Bu hesapta kayıtlı abonelik hareketi yok.</p>
        ) : (
          <ol className="space-y-3 p-5">
            {events.map((e) => (
              <li key={e.id} className="flex gap-3 text-sm">
                <Receipt className="mt-0.5 h-4 w-4 shrink-0 text-slate-600" />
                <div className="min-w-0">
                  <p className="font-medium text-slate-200">
                    {e.label}
                    <span className="ml-2 text-xs font-normal text-slate-500">{e.actor}</span>
                  </p>
                  <p className="text-slate-400">{e.summary}</p>
                  <p className="text-xs text-slate-600">{fmtDateTime(e.createdAt)}</p>
                </div>
              </li>
            ))}
          </ol>
        ))}
    </div>
  )
}
