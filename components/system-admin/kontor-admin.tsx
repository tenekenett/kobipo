"use client"

import { useEffect, useState } from "react"
import { Loader2, RefreshCw, Plus, Trash2, CheckCircle2, XCircle, Paperclip, Receipt } from "lucide-react"
import { useToast } from "@/components/ui/use-toast"
import { useConfirm } from "@/components/ui/confirm-dialog-provider"

interface Tariff {
  tariffCode?: string
  tariffName?: string
  validityMonth?: number
  invoiceDescription?: string
}

interface KontorPackage {
  id: string
  name: string
  description: string | null
  creditQty: number
  price: string | number
  currency: string
  mysoftTariffCode: string
  validityMonths: number | null
  /** NULL = sistem varsayılanı (%20). Fiyat KDV DAHİL'dir. */
  vatRate: string | number | null
  isActive: boolean
  sortOrder: number
}

interface KontorOrder {
  id: string
  companyId: string
  company?: { id: string; name: string }
  packageName: string
  creditQty: number
  totalPrice: string | number
  currency: string
  mysoftTariffCode: string
  targetVkn: string
  status: string
  loadError: string | null
  mysoftCreditId: string | null
  createdAt: string
  // Havale akışı: müşteri kodu açıklamaya yazar, dekontu yükler, burada onaylanır.
  paymentMethod?: string
  paymentCode?: string | null
  paymentNote?: string | null
  receiptFileName?: string | null
  receiptUploadedAt?: string | null
  // Otomatik faturalandırma (docs/faturalandirma/PLAN.md)
  invoiceId?: string | null
  invoicedAt?: string | null
  invoiceError?: string | null
  isTest?: boolean
}

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  PENDING_PAYMENT: { text: "Ödeme bekliyor", cls: "bg-amber-500/15 text-amber-300" },
  PAYMENT_REVIEW: { text: "Onay bekliyor", cls: "bg-blue-500/15 text-blue-300" },
  LOADED: { text: "Yüklendi", cls: "bg-emerald-500/15 text-emerald-300" },
  REJECTED: { text: "Reddedildi", cls: "bg-slate-500/15 text-slate-300" },
  FAILED: { text: "Başarısız", cls: "bg-red-500/15 text-red-300" },
}

const emptyForm = {
  name: "",
  creditQty: "",
  price: "",
  mysoftTariffCode: "",
  validityMonths: "",
  vatRate: "",
}

export function KontorAdmin() {
  const { toast } = useToast()
  const { confirm } = useConfirm()
  const [loading, setLoading] = useState(true)
  const [tariffs, setTariffs] = useState<Tariff[]>([])
  const [tariffsError, setTariffsError] = useState<string | null>(null)
  const [packages, setPackages] = useState<KontorPackage[]>([])
  const [orders, setOrders] = useState<KontorOrder[]>([])
  const [form, setForm] = useState({ ...emptyForm })
  const [saving, setSaving] = useState(false)
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null)

  const loadAll = async () => {
    setLoading(true)
    try {
      const [tRes, pRes, oRes] = await Promise.all([
        fetch("/api/kontor/tariffs"),
        fetch("/api/kontor/packages?all=1"),
        fetch("/api/kontor/orders?all=1"),
      ])
      const tData = await tRes.json().catch(() => ({}))
      if (tRes.ok) {
        setTariffs(Array.isArray(tData?.data) ? tData.data : [])
        setTariffsError(null)
      } else {
        setTariffs([])
        setTariffsError(tData?.error || "Tarife listesi alınamadı")
      }
      const pData = await pRes.json().catch(() => ({}))
      setPackages(pRes.ok && Array.isArray(pData?.data) ? pData.data : [])
      const oData = await oRes.json().catch(() => ({}))
      setOrders(oRes.ok && Array.isArray(oData?.data) ? oData.data : [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const createPackage = async () => {
    setSaving(true)
    try {
      const res = await fetch("/api/kontor/packages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          creditQty: Number(form.creditQty),
          price: Number(form.price),
          mysoftTariffCode: form.mysoftTariffCode,
          validityMonths: form.validityMonths ? Number(form.validityMonths) : null,
          vatRate: form.vatRate === "" ? null : Number(form.vatRate),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || "Paket oluşturulamadı")
      toast({ title: "Paket eklendi", description: form.name })
      setForm({ ...emptyForm })
      loadAll()
    } catch (e) {
      toast({
        title: "Hata",
        description: e instanceof Error ? e.message : "Bir hata oluştu",
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  const togglePackage = async (pkg: KontorPackage) => {
    const res = await fetch(`/api/kontor/packages/${pkg.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !pkg.isActive }),
    })
    if (res.ok) loadAll()
  }

  const deletePackage = async (pkg: KontorPackage) => {
    if (!(await confirm({ title: "Paketi sil", description: `"${pkg.name}" paketi silinsin mi?`, confirmLabel: "Sil", variant: "destructive" }))) return
    const res = await fetch(`/api/kontor/packages/${pkg.id}`, { method: "DELETE" })
    if (res.ok) {
      toast({ title: "Paket silindi" })
      loadAll()
    }
  }

  const confirmOrder = async (order: KontorOrder, action: "approve" | "reject") => {
    setBusyOrderId(order.id)
    try {
      const res = await fetch(`/api/kontor/orders/${order.id}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || "İşlem başarısız")
      toast({
        title: action === "approve" ? "Kontör yüklendi" : "Sipariş reddedildi",
        description: action === "approve" ? `${order.creditQty} kontör → ${order.targetVkn}` : undefined,
      })
    } catch (e) {
      toast({
        title: "Hata",
        description: e instanceof Error ? e.message : "Bir hata oluştu",
        variant: "destructive",
      })
    } finally {
      setBusyOrderId(null)
      // Başarılı/başarısız fark etmez — sipariş durumunu (LOADED/FAILED) tazele.
      loadAll()
    }
  }

  /**
   * Faturayı elle kes ya da geri al. Kapılar servisin İÇİNDE olduğu için elle
   * tetiklemek de test siparişine belge kestirmez — 409 ile "atlandı" döner.
   */
  const invoiceAction = async (order: KontorOrder, action: "issue" | "void") => {
    if (action === "void" && !(await confirm({
      title: "Faturayı geri al",
      description:
        `${order.company?.name || order.companyId} siparişinin faturası iptal edilecek. ` +
        "e-Arşiv yalnız 24 saat içinde iptal edilebilir; e-Fatura hiç iptal edilemez " +
        "(iade faturası gerekir).",
      confirmLabel: "Geri al",
      variant: "destructive",
    }))) return

    setBusyOrderId(order.id)
    try {
      const res = await fetch(`/api/kontor/orders/${order.id}/invoice`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || "İşlem başarısız")
      toast({
        title: action === "issue" ? "Fatura kesildi" : "Fatura geri alındı",
        description: action === "issue" ? data?.invoiceNo || undefined : undefined,
      })
    } catch (e) {
      toast({
        title: action === "issue" ? "Fatura kesilemedi" : "Fatura geri alınamadı",
        description: e instanceof Error ? e.message : "Bir hata oluştu",
        variant: "destructive",
      })
    } finally {
      setBusyOrderId(null)
      loadAll()
    }
  }

  // Dekontu yüklenmiş siparişler admin'in iş kuyruğudur → en üstte ve sayaçta.
  // Sıralama stabil olduğu için grup içinde API'nin createdAt DESC düzeni korunur.
  const pendingReviewCount = orders.filter((o) => o.status === "PAYMENT_REVIEW").length
  const statusRank = (s: string) => (s === "PAYMENT_REVIEW" ? 0 : s === "PENDING_PAYMENT" ? 1 : 2)
  const sortedOrders = [...orders].sort((a, b) => statusRank(a.status) - statusRank(b.status))

  const formValid =
    form.name.trim() &&
    Number(form.creditQty) > 0 &&
    Number(form.price) >= 0 &&
    form.mysoftTariffCode.trim()

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <button
          onClick={loadAll}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg bg-slate-800 px-3 py-2 text-sm text-slate-200 hover:bg-slate-700 disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Yenile
        </button>
      </div>

      {/* Tarifeler */}
      <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-5">
        <h2 className="text-lg font-semibold text-white">Bayi Tarifeleri</h2>
        <p className="text-sm text-slate-500">
          Mysoft İş Ortağı tarifeleri. Paket tanımlarken <code className="text-slate-300">tariffCode</code> buradan alınır.
        </p>
        <div className="mt-4">
          {tariffsError ? (
            <div className="rounded-lg bg-red-500/10 p-3 text-sm text-red-300">{tariffsError}</div>
          ) : tariffs.length === 0 ? (
            <p className="text-sm text-slate-500">
              Tarife bulunamadı. Mysoft bayi panelinizden tarife tanımlayın.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-slate-500">
                  <tr className="text-left">
                    <th className="py-2 pr-4">Tarife Kodu</th>
                    <th className="py-2 pr-4">Ad</th>
                    <th className="py-2 pr-4">Geçerlilik (ay)</th>
                  </tr>
                </thead>
                <tbody className="text-slate-200">
                  {tariffs.map((t, i) => (
                    <tr key={i} className="border-t border-slate-800">
                      <td className="py-2 pr-4 font-mono text-orange-300">{t.tariffCode || "-"}</td>
                      <td className="py-2 pr-4">{t.tariffName || "-"}</td>
                      <td className="py-2 pr-4">{t.validityMonth ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {/* Paketler */}
      <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-5">
        <h2 className="text-lg font-semibold text-white">Satılabilir Paketler</h2>
        <p className="text-sm text-slate-500">Müşteriye gösterilen Kobipo paketleri (fiyat Kobipo'ya aittir).</p>

        {/* Yeni paket formu */}
        <div className="mt-4 grid gap-2 sm:grid-cols-[1.5fr_1fr_1fr_1fr_0.8fr_auto]">
          <input
            placeholder="Paket adı (1000 E-Belge)"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="rounded-lg bg-slate-800 px-3 py-2 text-sm text-white placeholder:text-slate-500"
          />
          <input
            placeholder="Adet"
            inputMode="numeric"
            value={form.creditQty}
            onChange={(e) => setForm({ ...form, creditQty: e.target.value.replace(/\D/g, "") })}
            className="rounded-lg bg-slate-800 px-3 py-2 text-sm text-white placeholder:text-slate-500"
          />
          <input
            placeholder="Fiyat (TL)"
            inputMode="decimal"
            value={form.price}
            onChange={(e) => setForm({ ...form, price: e.target.value })}
            className="rounded-lg bg-slate-800 px-3 py-2 text-sm text-white placeholder:text-slate-500"
          />
          {tariffs.length === 0 ? (
            // Mysoft'ta tarife yokken test amaçlı kod elle girilebilir.
            <input
              placeholder="Tarife kodu (test: TEST)"
              value={form.mysoftTariffCode}
              onChange={(e) => setForm({ ...form, mysoftTariffCode: e.target.value })}
              className="rounded-lg bg-slate-800 px-3 py-2 text-sm text-white placeholder:text-slate-500 font-mono"
            />
          ) : (
            <select
              value={form.mysoftTariffCode}
              onChange={(e) => {
                const code = e.target.value
                const t = tariffs.find((x) => x.tariffCode === code)
                setForm({
                  ...form,
                  mysoftTariffCode: code,
                  validityMonths: t?.validityMonth ? String(t.validityMonth) : form.validityMonths,
                  name: form.name || t?.tariffName || "",
                })
              }}
              className="rounded-lg bg-slate-800 px-3 py-2 text-sm text-white"
            >
              <option value="">Tarife seç…</option>
              {tariffs.map((t, i) => (
                <option key={i} value={t.tariffCode}>
                  {(t.tariffName || t.tariffCode) + " · " + t.tariffCode}
                </option>
              ))}
            </select>
          )}
          <input
            placeholder="Ay"
            inputMode="numeric"
            value={form.validityMonths}
            onChange={(e) => setForm({ ...form, validityMonths: e.target.value.replace(/\D/g, "") })}
            className="rounded-lg bg-slate-800 px-3 py-2 text-sm text-white placeholder:text-slate-500"
          />
          {/* Fiyat KDV DAHİL'dir; bu oran yalnız faturadaki matrah/KDV ayrışmasını
              belirler, müşterinin ödediği tutarı değiştirmez. Boş = %20. */}
          <input
            placeholder="KDV % (boş=20)"
            inputMode="numeric"
            value={form.vatRate}
            onChange={(e) => setForm({ ...form, vatRate: e.target.value.replace(/[^\d.]/g, "") })}
            className="rounded-lg bg-slate-800 px-3 py-2 text-sm text-white placeholder:text-slate-500"
          />
          <button
            onClick={createPackage}
            disabled={!formValid || saving}
            className="inline-flex items-center justify-center gap-1 rounded-lg bg-orange-500 px-3 py-2 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Ekle
          </button>
        </div>
        {tariffs.length === 0 && (
          <p className="mt-2 text-xs text-amber-400">
            Mysoft'ta tanımlı tarife yok. Test için kodu elle girebilirsiniz (ör. <span className="font-mono">TEST</span>) —
            müşteri akışını denersiniz, ama "Onayla & Yükle" gerçek yükleme yapmaz (geçersiz tarife). Gerçek tarife
            tanımlanınca alan otomatik seçmeli menüye döner.
          </p>
        )}

        <div className="mt-4">
          {packages.length === 0 ? (
            <p className="text-sm text-slate-500">Henüz paket yok.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-slate-500">
                  <tr className="text-left">
                    <th className="py-2 pr-4">Ad</th>
                    <th className="py-2 pr-4">Adet</th>
                    <th className="py-2 pr-4">Fiyat</th>
                    <th className="py-2 pr-4">Tarife</th>
                    <th className="py-2 pr-4">KDV</th>
                    <th className="py-2 pr-4">Durum</th>
                    <th className="py-2 pr-4"></th>
                  </tr>
                </thead>
                <tbody className="text-slate-200">
                  {packages.map((p) => (
                    <tr key={p.id} className="border-t border-slate-800">
                      <td className="py-2 pr-4">{p.name}</td>
                      <td className="py-2 pr-4">{p.creditQty.toLocaleString("tr-TR")}</td>
                      <td className="py-2 pr-4">
                        {Number(p.price).toLocaleString("tr-TR")} {p.currency}
                      </td>
                      <td className="py-2 pr-4 font-mono text-orange-300">{p.mysoftTariffCode}</td>
                      <td className="py-2 pr-4 text-slate-400">
                        %{p.vatRate != null ? Number(p.vatRate) : 20}
                      </td>
                      <td className="py-2 pr-4">
                        <button
                          onClick={() => togglePackage(p)}
                          className={`rounded-full px-2 py-0.5 text-xs ${
                            p.isActive ? "bg-emerald-500/15 text-emerald-300" : "bg-slate-600/30 text-slate-400"
                          }`}
                        >
                          {p.isActive ? "Aktif" : "Pasif"}
                        </button>
                      </td>
                      <td className="py-2 pr-4">
                        <button
                          onClick={() => deletePackage(p)}
                          className="text-slate-500 hover:text-red-400"
                          title="Sil"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {/* Siparişler */}
      <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-white">Kontör Siparişleri</h2>
          {pendingReviewCount > 0 && (
            <span className="rounded-full bg-blue-500/15 px-2.5 py-0.5 text-xs font-medium text-blue-300">
              {pendingReviewCount} dekont onay bekliyor
            </span>
          )}
        </div>
        <p className="text-sm text-slate-500">
          Müşteri havaleyi yapıp dekontu yükleyince sipariş "Onay bekliyor"a düşer. Dekontu ve
          açıklama kodunu hesap hareketiyle karşılaştırın; uygunsa "Onayla & Yükle" kontörü
          müşterinin Mysoft hesabına yükler.
        </p>
        <div className="mt-4">
          {orders.length === 0 ? (
            <p className="text-sm text-slate-500">Sipariş yok.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-slate-500">
                  <tr className="text-left">
                    <th className="py-2 pr-4">Firma</th>
                    <th className="py-2 pr-4">Paket</th>
                    <th className="py-2 pr-4">Tutar</th>
                    <th className="py-2 pr-4">Ödeme</th>
                    <th className="py-2 pr-4">Hedef VKN</th>
                    <th className="py-2 pr-4">Durum</th>
                    <th className="py-2 pr-4">Fatura</th>
                    <th className="py-2 pr-4">İşlem</th>
                  </tr>
                </thead>
                <tbody className="text-slate-200">
                  {sortedOrders.map((o) => {
                    const st = STATUS_LABEL[o.status] || { text: o.status, cls: "bg-slate-600/30 text-slate-300" }
                    const canAct = o.status !== "LOADED" && o.status !== "REJECTED"
                    const busy = busyOrderId === o.id
                    return (
                      <tr key={o.id} className="border-t border-slate-800 align-top">
                        <td className="py-2 pr-4">{o.company?.name || o.companyId}</td>
                        <td className="py-2 pr-4">
                          {o.packageName}
                          <span className="block text-xs text-slate-500">
                            {o.creditQty.toLocaleString("tr-TR")} kontör · {o.mysoftTariffCode}
                          </span>
                        </td>
                        <td className="py-2 pr-4">
                          {Number(o.totalPrice).toLocaleString("tr-TR")} {o.currency}
                        </td>
                        {/* Ödeme: havalede açıklama kodu + dekont — eşleştirme bu ikisiyle yapılır. */}
                        <td className="py-2 pr-4">
                          <span className="text-xs text-slate-400">
                            {o.paymentMethod === "CARD" ? "Kart (PayTR)" : "Havale/EFT"}
                          </span>
                          {o.paymentCode && (
                            <span className="block font-mono text-xs text-orange-300">
                              {o.paymentCode}
                            </span>
                          )}
                          {o.receiptFileName ? (
                            <a
                              href={`/api/kontor/orders/${o.id}/receipt`}
                              target="_blank"
                              rel="noreferrer"
                              className="mt-0.5 inline-flex items-center gap-1 text-xs text-blue-300 underline underline-offset-2 hover:text-blue-200"
                            >
                              <Paperclip className="h-3 w-3" />
                              Dekont
                            </a>
                          ) : (
                            o.paymentMethod !== "CARD" && (
                              <span className="block text-xs text-slate-600">dekont yok</span>
                            )
                          )}
                          {o.paymentNote && (
                            <span className="mt-0.5 block max-w-[200px] text-xs text-slate-400">
                              “{o.paymentNote}”
                            </span>
                          )}
                        </td>
                        <td className="py-2 pr-4 font-mono">{o.targetVkn}</td>
                        <td className="py-2 pr-4">
                          <span className={`rounded-full px-2 py-0.5 text-xs ${st.cls}`}>{st.text}</span>
                          {o.status === "FAILED" && o.loadError && (
                            <span className="block max-w-[220px] text-xs text-red-400">{o.loadError}</span>
                          )}
                        </td>
                        <td className="py-2 pr-4">
                          {o.isTest ? (
                            <span className="text-xs text-slate-500">Test — kesilmez</span>
                          ) : o.invoiceId ? (
                            <span className="inline-flex items-center gap-1 text-xs text-emerald-400">
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              Kesildi
                            </span>
                          ) : o.status === "LOADED" ? (
                            <span className="text-xs text-amber-400">Yok</span>
                          ) : (
                            <span className="text-xs text-slate-500">—</span>
                          )}
                          {o.invoiceError && (
                            <span className="block max-w-[220px] text-xs text-red-400">{o.invoiceError}</span>
                          )}
                        </td>
                        <td className="py-2 pr-4">
                          {/* Fatura eylemleri: yüklenmiş siparişte kesme, kesilmişte geri alma. */}
                          {!o.isTest && o.status === "LOADED" && (
                            <div className="mb-1 flex gap-2">
                              {o.invoiceId ? (
                                <button
                                  onClick={() => invoiceAction(o, "void")}
                                  disabled={busy}
                                  className="inline-flex items-center gap-1 rounded-lg bg-slate-700 px-2.5 py-1.5 text-xs text-slate-200 hover:bg-slate-600 disabled:opacity-50"
                                >
                                  <XCircle className="h-3.5 w-3.5" />
                                  Faturayı geri al
                                </button>
                              ) : (
                                <button
                                  onClick={() => invoiceAction(o, "issue")}
                                  disabled={busy}
                                  className="inline-flex items-center gap-1 rounded-lg bg-orange-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-orange-700 disabled:opacity-50"
                                >
                                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Receipt className="h-3.5 w-3.5" />}
                                  Faturayı kes
                                </button>
                              )}
                            </div>
                          )}
                          {canAct && (
                            <div className="flex gap-2">
                              <button
                                onClick={() => confirmOrder(o, "approve")}
                                disabled={busy}
                                className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                              >
                                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                                Onayla & Yükle
                              </button>
                              <button
                                onClick={() => confirmOrder(o, "reject")}
                                disabled={busy}
                                className="inline-flex items-center gap-1 rounded-lg bg-slate-700 px-2.5 py-1.5 text-xs text-slate-200 hover:bg-slate-600 disabled:opacity-50"
                              >
                                <XCircle className="h-3.5 w-3.5" />
                                Reddet
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
