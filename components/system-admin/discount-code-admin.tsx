"use client"

import { useEffect, useRef, useState } from "react"
import { Loader2, RefreshCw, Plus, Trash2, Pencil, Save, X } from "lucide-react"
import { useToast } from "@/components/ui/use-toast"
import { useConfirm } from "@/components/ui/confirm-dialog-provider"
import { normalizeDiscountCode } from "@/lib/billing/discount-code"

interface DiscountCode {
  id: string
  code: string
  description: string | null
  type: "PERCENT" | "AMOUNT" | string
  value: string | number
  scope: "ALL" | "KONTOR" | "PACKAGE" | string
  maxDiscount: string | number | null
  minAmount: string | number | null
  startsAt: string | null
  endsAt: string | null
  maxRedemptions: number | null
  maxPerCompany: number | null
  appliesToRenewals: boolean
  isActive: boolean
  redemptionCount: number
}

const emptyForm = {
  code: "",
  description: "",
  type: "PERCENT",
  value: "",
  scope: "ALL",
  maxDiscount: "",
  minAmount: "",
  startsAt: "",
  endsAt: "",
  maxRedemptions: "",
  maxPerCompany: "1",
  appliesToRenewals: false,
  isActive: true,
}

const SCOPE_LABEL: Record<string, string> = {
  ALL: "Kontör + Abonelik",
  KONTOR: "Yalnız kontör",
  PACKAGE: "Yalnız abonelik",
}

/** YYYY-MM-DD (date input'u bunu bekler); boş/null güvenli. */
function toDateInput(iso: string | null): string {
  if (!iso) return ""
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10)
}

function fmtMoney(v: string | number | null): string {
  if (v == null) return "—"
  return `${Number(v).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL`
}

/**
 * İndirim kodu yönetimi (sistem-admin).
 *
 * Ekleme ve düzenleme AYNI formu paylaşır — iki ayrı form iki ayrı doğrulama demek
 * olurdu ve sunucudaki kural (lib/billing/discount-input.ts) tek. Kod METNİ
 * düzenlenemez: kod siparişlere snapshot olarak yazılıyor ve müşteriye duyurulmuş
 * oluyor; değişmesi gerekiyorsa yenisi açılır, eskisi pasife alınır.
 */
export function DiscountCodeAdmin() {
  const { toast } = useToast()
  const { confirm } = useConfirm()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [codes, setCodes] = useState<DiscountCode[]>([])
  const [form, setForm] = useState({ ...emptyForm })
  const [editingId, setEditingId] = useState<string | null>(null)
  const formRef = useRef<HTMLDivElement>(null)

  const load = async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/admin/discount-codes")
      const data = await res.json().catch(() => ({}))
      setCodes(res.ok && Array.isArray(data?.data) ? data.data : [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const save = async () => {
    setSaving(true)
    try {
      const payload = {
        code: form.code,
        description: form.description.trim() || null,
        type: form.type,
        value: Number(form.value),
        scope: form.scope,
        maxDiscount: form.type === "PERCENT" ? form.maxDiscount : "",
        minAmount: form.minAmount,
        startsAt: form.startsAt || null,
        endsAt: form.endsAt || null,
        maxRedemptions: form.maxRedemptions,
        maxPerCompany: form.maxPerCompany,
        appliesToRenewals: form.appliesToRenewals,
        isActive: form.isActive,
      }
      const res = await fetch(
        editingId ? `/api/admin/discount-codes/${editingId}` : "/api/admin/discount-codes",
        {
          method: editingId ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || "Kaydedilemedi")
      toast({ title: editingId ? "Kod güncellendi" : "Kod eklendi", description: payload.code })
      setForm({ ...emptyForm })
      setEditingId(null)
      load()
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

  const startEdit = (c: DiscountCode) => {
    setEditingId(c.id)
    setForm({
      code: c.code,
      description: c.description ?? "",
      type: String(c.type),
      value: String(Number(c.value)),
      scope: String(c.scope),
      maxDiscount: c.maxDiscount != null ? String(Number(c.maxDiscount)) : "",
      minAmount: c.minAmount != null ? String(Number(c.minAmount)) : "",
      startsAt: toDateInput(c.startsAt),
      endsAt: toDateInput(c.endsAt),
      maxRedemptions: c.maxRedemptions != null ? String(c.maxRedemptions) : "",
      maxPerCompany: c.maxPerCompany != null ? String(c.maxPerCompany) : "",
      appliesToRenewals: c.appliesToRenewals,
      isActive: c.isActive,
    })
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })
  }

  const cancelEdit = () => {
    setEditingId(null)
    setForm({ ...emptyForm })
  }

  const toggleActive = async (c: DiscountCode) => {
    const res = await fetch(`/api/admin/discount-codes/${c.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      // PUT tüm alanları ister (kural tek yerde); mevcut değerler geri gönderilir.
      body: JSON.stringify({
        description: c.description,
        type: c.type,
        value: Number(c.value),
        scope: c.scope,
        maxDiscount: c.maxDiscount != null ? Number(c.maxDiscount) : "",
        minAmount: c.minAmount != null ? Number(c.minAmount) : "",
        startsAt: c.startsAt,
        endsAt: c.endsAt,
        maxRedemptions: c.maxRedemptions ?? "",
        maxPerCompany: c.maxPerCompany ?? "",
        appliesToRenewals: c.appliesToRenewals,
        isActive: !c.isActive,
      }),
    })
    if (res.ok) load()
  }

  const remove = async (c: DiscountCode) => {
    if (
      !(await confirm({
        title: "Kodu sil",
        description: `"${c.code}" kodu silinsin mi?`,
        confirmLabel: "Sil",
        variant: "destructive",
      }))
    )
      return
    const res = await fetch(`/api/admin/discount-codes/${c.id}`, { method: "DELETE" })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      toast({ title: "Silinemedi", description: data?.error, variant: "destructive" })
      return
    }
    toast({ title: "Kod silindi" })
    if (editingId === c.id) cancelEdit()
    load()
  }

  const formValid = form.code.trim().length > 0 && Number(form.value) > 0

  const input =
    "rounded-lg bg-slate-800 px-3 py-2 text-sm text-white placeholder:text-slate-500"

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <button
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg bg-slate-800 px-3 py-2 text-sm text-slate-200 hover:bg-slate-700 disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Yenile
        </button>
      </div>

      <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-5">
        <h2 className="text-lg font-semibold text-white">
          {editingId ? "Kodu Düzenle" : "Yeni İndirim Kodu"}
        </h2>
        <p className="text-sm text-slate-500">
          Kod, kontör ve abonelik satın alma ekranlarındaki &quot;İndirim kodu&quot; kutusuna
          girilir. İndirim her zaman sunucuda yeniden hesaplanır.
        </p>

        <div ref={formRef} className="mt-4 space-y-2">
          <div className="grid gap-2 sm:grid-cols-[1fr_2fr_1fr_1fr]">
            <input
              placeholder="KOD (ör. YAZ25)"
              value={form.code}
              // Panelde ne yazılırsa yazılsın sunucudaki normalizasyonla AYNI sonuç
              // görünsün: kullanıcı "min1000" yazdığında bulunacak kod budur.
              onChange={(e) => setForm({ ...form, code: normalizeDiscountCode(e.target.value) })}
              disabled={Boolean(editingId)}
              title={editingId ? "Kod metni değiştirilemez — yeni kod açın" : undefined}
              className={`${input} font-mono disabled:opacity-60`}
            />
            <input
              placeholder="Açıklama (yalnız panelde görünür)"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className={input}
            />
            <select
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value })}
              className="rounded-lg bg-slate-800 px-3 py-2 text-sm text-white"
            >
              <option value="PERCENT">Yüzde (%)</option>
              <option value="AMOUNT">Sabit tutar (TL)</option>
            </select>
            <input
              placeholder={form.type === "PERCENT" ? "Oran (10)" : "Tutar (100)"}
              inputMode="decimal"
              value={form.value}
              onChange={(e) => setForm({ ...form, value: e.target.value.replace(/[^\d.]/g, "") })}
              className={input}
            />
          </div>

          <div className="grid gap-2 sm:grid-cols-[1.2fr_1fr_1fr_1fr_1fr]">
            <select
              value={form.scope}
              onChange={(e) => setForm({ ...form, scope: e.target.value })}
              className="rounded-lg bg-slate-800 px-3 py-2 text-sm text-white"
            >
              <option value="ALL">Kontör + Abonelik</option>
              <option value="KONTOR">Yalnız kontör</option>
              <option value="PACKAGE">Yalnız abonelik</option>
            </select>
            {/* Tavan yalnız yüzde indirimde anlamlı; sabit tutarda değerin kendisi tavandır. */}
            <input
              placeholder="Tavan (TL)"
              inputMode="decimal"
              value={form.maxDiscount}
              onChange={(e) => setForm({ ...form, maxDiscount: e.target.value.replace(/[^\d.]/g, "") })}
              disabled={form.type !== "PERCENT"}
              className={`${input} disabled:opacity-40`}
            />
            <input
              placeholder="Asgari tutar (TL)"
              inputMode="decimal"
              value={form.minAmount}
              onChange={(e) => setForm({ ...form, minAmount: e.target.value.replace(/[^\d.]/g, "") })}
              className={input}
            />
            <input
              placeholder="Toplam hak"
              inputMode="numeric"
              value={form.maxRedemptions}
              onChange={(e) =>
                setForm({ ...form, maxRedemptions: e.target.value.replace(/\D/g, "") })
              }
              className={input}
            />
            <input
              placeholder="Firma başına"
              inputMode="numeric"
              value={form.maxPerCompany}
              onChange={(e) =>
                setForm({ ...form, maxPerCompany: e.target.value.replace(/\D/g, "") })
              }
              className={input}
            />
          </div>

          <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto_auto_auto]">
            <label className="flex flex-col text-xs text-slate-500">
              Başlangıç
              <input
                type="date"
                value={form.startsAt}
                onChange={(e) => setForm({ ...form, startsAt: e.target.value })}
                className={`${input} mt-1`}
              />
            </label>
            <label className="flex flex-col text-xs text-slate-500">
              Bitiş
              <input
                type="date"
                value={form.endsAt}
                onChange={(e) => setForm({ ...form, endsAt: e.target.value })}
                className={`${input} mt-1`}
              />
            </label>
            <label className="flex items-center gap-2 self-end pb-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={form.appliesToRenewals}
                onChange={(e) => setForm({ ...form, appliesToRenewals: e.target.checked })}
                className="h-4 w-4"
              />
              Yenilemelerde de geçerli
            </label>
            <label className="flex items-center gap-2 self-end pb-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                className="h-4 w-4"
              />
              Aktif
            </label>
            <div className="flex items-end gap-2 pb-1">
              <button
                onClick={save}
                disabled={!formValid || saving}
                className="inline-flex items-center justify-center gap-1 rounded-lg bg-orange-500 px-3 py-2 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-50"
              >
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : editingId ? (
                  <Save className="h-4 w-4" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                {editingId ? "Kaydet" : "Ekle"}
              </button>
              {editingId && (
                <button
                  onClick={cancelEdit}
                  disabled={saving}
                  className="inline-flex items-center gap-1 rounded-lg bg-slate-800 px-3 py-2 text-sm text-slate-300 hover:bg-slate-700 disabled:opacity-50"
                >
                  <X className="h-4 w-4" />
                  Vazgeç
                </button>
              )}
            </div>
          </div>
          <p className="text-xs text-slate-500">
            Yenileme kuralı: işaretli değilse indirim yalnız ilk ödemeye uygulanır, abonelik
            liste tutarıyla yenilenir. Boş bırakılan sınırlar &quot;sınırsız&quot; demektir.
          </p>
        </div>
      </section>

      <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-5">
        <h2 className="text-lg font-semibold text-white">Tanımlı Kodlar</h2>
        <div className="mt-4">
          {codes.length === 0 ? (
            <p className="text-sm text-slate-500">Henüz indirim kodu yok.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-slate-500">
                  <tr className="text-left">
                    <th className="py-2 pr-4">Kod</th>
                    <th className="py-2 pr-4">İndirim</th>
                    <th className="py-2 pr-4">Kapsam</th>
                    <th className="py-2 pr-4">Sınırlar</th>
                    <th className="py-2 pr-4">Tarih</th>
                    <th className="py-2 pr-4">Kullanım</th>
                    <th className="py-2 pr-4">Durum</th>
                    <th className="py-2 pr-4"></th>
                  </tr>
                </thead>
                <tbody className="text-slate-200">
                  {codes.map((c) => (
                    <tr
                      key={c.id}
                      className={`border-t border-slate-800 align-top ${
                        editingId === c.id ? "bg-orange-500/5" : ""
                      }`}
                    >
                      <td className="py-2 pr-4">
                        <span className="font-mono text-orange-300">{c.code}</span>
                        {c.description && (
                          <span className="block text-xs text-slate-500">{c.description}</span>
                        )}
                      </td>
                      <td className="py-2 pr-4">
                        {c.type === "PERCENT"
                          ? `%${Number(c.value)}`
                          : fmtMoney(c.value)}
                        {c.type === "PERCENT" && c.maxDiscount != null && (
                          <span className="block text-xs text-slate-500">
                            en fazla {fmtMoney(c.maxDiscount)}
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-4">
                        {SCOPE_LABEL[c.scope] || c.scope}
                        {c.appliesToRenewals && (
                          <span className="block text-xs text-emerald-400">yenilemede de</span>
                        )}
                      </td>
                      <td className="py-2 pr-4 text-xs text-slate-400">
                        {c.minAmount != null && <span className="block">min {fmtMoney(c.minAmount)}</span>}
                        <span className="block">
                          firma başına {c.maxPerCompany ?? "∞"}
                        </span>
                      </td>
                      <td className="py-2 pr-4 text-xs text-slate-400">
                        {c.startsAt || c.endsAt ? (
                          <>
                            {c.startsAt ? new Date(c.startsAt).toLocaleDateString("tr-TR") : "—"}
                            {" → "}
                            {c.endsAt ? new Date(c.endsAt).toLocaleDateString("tr-TR") : "—"}
                          </>
                        ) : (
                          "süresiz"
                        )}
                      </td>
                      <td className="py-2 pr-4">
                        {c.redemptionCount}
                        {c.maxRedemptions != null ? ` / ${c.maxRedemptions}` : ""}
                      </td>
                      <td className="py-2 pr-4">
                        <button
                          onClick={() => toggleActive(c)}
                          className={`rounded-full px-2 py-0.5 text-xs ${
                            c.isActive
                              ? "bg-emerald-500/15 text-emerald-300"
                              : "bg-slate-600/30 text-slate-400"
                          }`}
                        >
                          {c.isActive ? "Aktif" : "Pasif"}
                        </button>
                      </td>
                      <td className="py-2 pr-4">
                        <div className="flex items-center gap-3">
                          <button
                            onClick={() => startEdit(c)}
                            className="text-slate-500 hover:text-orange-300"
                            title="Düzenle"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => remove(c)}
                            className="text-slate-500 hover:text-red-400"
                            title="Sil"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
