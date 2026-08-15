"use client"

import { useEffect, useState } from "react"
import { Loader2, Plus, Trash2, Save, RefreshCw, Star } from "lucide-react"
import { useToast } from "@/components/ui/use-toast"
import { useConfirm } from "@/components/ui/confirm-dialog-provider"
import { MANAGEABLE_MODULES } from "@/lib/modules"
import { BRANCH_ITEM_KEY, COMPANY_ITEM_KEY } from "@/lib/billing/constants"

interface Plan {
  id: string
  code: string
  name: string
  description: string | null
  monthlyPrice: string | number
  yearlyPrice: string | number | null
  includedModules: string[]
  includedBranches: number
  includedCompanies: number
  maxUsers: number
  highlighted: boolean
  sortOrder: number
  isActive: boolean
}

interface PricingItem {
  key: string
  label: string
  monthlyPrice: string | number
  yearlyPrice: string | number
  isActive: boolean
  sortOrder: number
}

const inputCls =
  "rounded-lg bg-slate-800 px-3 py-2 text-sm text-white placeholder:text-slate-500 border border-slate-700 focus:border-indigo-500 focus:outline-none"

export function PackageAdmin() {
  const { toast } = useToast()
  const { confirm } = useConfirm()
  const [loading, setLoading] = useState(true)
  const [plans, setPlans] = useState<Plan[]>([])
  const [pricing, setPricing] = useState<PricingItem[]>([])
  const [paytrEnabled, setPaytrEnabled] = useState(true)

  const loadAll = async () => {
    setLoading(true)
    try {
      const [pkgRes, priceRes] = await Promise.all([
        fetch("/api/billing/packages?all=1"),
        fetch("/api/billing/pricing?all=1"),
      ])
      const pkgData = await pkgRes.json().catch(() => ({}))
      setPlans(pkgRes.ok && Array.isArray(pkgData?.data) ? pkgData.data : [])
      setPaytrEnabled(pkgData?.paytrEnabled !== false)
      const priceData = await priceRes.json().catch(() => ({}))
      setPricing(priceRes.ok && Array.isArray(priceData?.data) ? priceData.data : [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        {!paytrEnabled && (
          <div className="rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
            PayTR yapılandırılmamış — müşteriler kart ile ödeyemez (env değişkenlerini ayarlayın).
          </div>
        )}
        <button
          onClick={loadAll}
          disabled={loading}
          className="ml-auto inline-flex items-center gap-2 rounded-lg bg-slate-800 px-3 py-2 text-sm text-slate-200 hover:bg-slate-700 disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Yenile
        </button>
      </div>

      <BundlesSection plans={plans} onChanged={loadAll} />
      <PricingSection items={pricing} onChanged={loadAll} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Paketler (bundle)
// ---------------------------------------------------------------------------

function BundlesSection({ plans, onChanged }: { plans: Plan[]; onChanged: () => void }) {
  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-5">
      <h2 className="text-lg font-semibold text-white">Hazır Paketler</h2>
      <p className="text-sm text-slate-500">
        Müşteriye gösterilen paketler. Her paket bir modül setini, dahil ek şube (aynı VKN) ve
        dahil ek firma (ayrı VKN) sayısını içerir — ikisi ayrı haklardır.
      </p>

      <PlanForm mode="create" onSaved={onChanged} />

      <div className="mt-5 space-y-3">
        {plans.length === 0 ? (
          <p className="text-sm text-slate-500">Henüz paket yok.</p>
        ) : (
          plans.map((p) => <PlanForm key={p.id} mode="edit" plan={p} onSaved={onChanged} />)
        )}
      </div>
    </section>
  )
}

function PlanForm({
  mode,
  plan,
  onSaved,
}: {
  mode: "create" | "edit"
  plan?: Plan
  onSaved: () => void
}) {
  const { toast } = useToast()
  const { confirm } = useConfirm()
  const [name, setName] = useState(plan?.name ?? "")
  const [description, setDescription] = useState(plan?.description ?? "")
  const [monthlyPrice, setMonthlyPrice] = useState(String(plan?.monthlyPrice ?? ""))
  const [yearlyPrice, setYearlyPrice] = useState(
    plan?.yearlyPrice == null ? "" : String(plan.yearlyPrice),
  )
  const [modules, setModules] = useState<Set<string>>(new Set(plan?.includedModules ?? []))
  const [includedBranches, setIncludedBranches] = useState(String(plan?.includedBranches ?? 0))
  const [includedCompanies, setIncludedCompanies] = useState(String(plan?.includedCompanies ?? 0))
  const [highlighted, setHighlighted] = useState(Boolean(plan?.highlighted))
  const [isActive, setIsActive] = useState(plan?.isActive ?? true)
  const [saving, setSaving] = useState(false)

  const toggleModule = (key: string) => {
    setModules((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const save = async () => {
    if (!name.trim()) {
      toast({ title: "Paket adı zorunlu", variant: "destructive" })
      return
    }
    setSaving(true)
    try {
      const payload = {
        name: name.trim(),
        description: description.trim() || null,
        monthlyPrice: Number(monthlyPrice) || 0,
        yearlyPrice: yearlyPrice === "" ? null : Number(yearlyPrice),
        includedModules: Array.from(modules),
        includedBranches: Number(includedBranches) || 0,
        includedCompanies: Number(includedCompanies) || 0,
        highlighted,
        isActive,
      }
      const res = await fetch(
        mode === "create" ? "/api/billing/packages" : `/api/billing/packages/${plan!.id}`,
        {
          method: mode === "create" ? "POST" : "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || "Kaydedilemedi")
      toast({ title: mode === "create" ? "Paket eklendi" : "Paket güncellendi", description: name })
      if (mode === "create") {
        setName(""); setDescription(""); setMonthlyPrice(""); setYearlyPrice("")
        setModules(new Set()); setIncludedBranches("0"); setIncludedCompanies("0")
        setHighlighted(false); setIsActive(true)
      }
      onSaved()
    } catch (e) {
      toast({ title: "Hata", description: e instanceof Error ? e.message : "Hata", variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!plan) return
    if (!(await confirm({ title: "Paketi sil", description: `"${plan.name}" paketi silinsin mi?`, confirmLabel: "Sil", variant: "destructive" }))) return
    const res = await fetch(`/api/billing/packages/${plan.id}`, { method: "DELETE" })
    if (res.ok) {
      toast({ title: "Paket silindi" })
      onSaved()
    } else {
      const d = await res.json().catch(() => ({}))
      toast({ title: "Hata", description: d?.error || "Silinemedi", variant: "destructive" })
    }
  }

  return (
    <div
      className={`mt-4 rounded-lg border p-4 ${
        mode === "create" ? "border-indigo-700/50 bg-indigo-500/5" : "border-slate-700 bg-slate-800/40"
      }`}
    >
      <div className="grid gap-2 sm:grid-cols-2">
        <input className={inputCls} placeholder="Paket adı (ör. Profesyonel)" value={name} onChange={(e) => setName(e.target.value)} />
        <input className={inputCls} placeholder="Açıklama (opsiyonel)" value={description} onChange={(e) => setDescription(e.target.value)} />
        <input className={inputCls} inputMode="decimal" placeholder="Aylık fiyat (₺)" value={monthlyPrice} onChange={(e) => setMonthlyPrice(e.target.value)} />
        <input className={inputCls} inputMode="decimal" placeholder="Yıllık fiyat (₺, opsiyonel)" value={yearlyPrice} onChange={(e) => setYearlyPrice(e.target.value)} />
      </div>

      <div className="mt-3">
        <p className="mb-1.5 text-xs font-medium text-slate-400">Dahil modüller</p>
        <div className="flex flex-wrap gap-2">
          {MANAGEABLE_MODULES.map((m) => {
            const on = modules.has(m.key)
            return (
              <button
                key={m.key}
                type="button"
                onClick={() => toggleModule(m.key)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  on ? "bg-indigo-500 text-white" : "bg-slate-700/60 text-slate-300 hover:bg-slate-700"
                }`}
              >
                {m.label}
              </button>
            )
          })}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm text-slate-300" title="Aynı VKN, farklı adres">
          Dahil ek şube
          <input
            className={`${inputCls} w-20`}
            inputMode="numeric"
            value={includedBranches}
            onChange={(e) => setIncludedBranches(e.target.value.replace(/\D/g, ""))}
          />
        </label>
        <label
          className="flex items-center gap-2 text-sm text-slate-300"
          title="Ayrı VKN'li firma, aynı abonelik"
        >
          Dahil ek firma
          <input
            className={`${inputCls} w-20`}
            inputMode="numeric"
            value={includedCompanies}
            onChange={(e) => setIncludedCompanies(e.target.value.replace(/\D/g, ""))}
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input type="checkbox" checked={highlighted} onChange={(e) => setHighlighted(e.target.checked)} />
          <Star className="h-3.5 w-3.5 text-amber-400" /> Önerilen
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          Aktif
        </label>

        <div className="ml-auto flex items-center gap-2">
          {mode === "edit" && (
            <button onClick={remove} className="inline-flex items-center gap-1 rounded-lg bg-slate-700 px-2.5 py-1.5 text-xs text-slate-200 hover:bg-red-600/70" title="Sil">
              <Trash2 className="h-3.5 w-3.5" /> Sil
            </button>
          )}
          <button
            onClick={save}
            disabled={saving}
            className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : mode === "create" ? <Plus className="h-4 w-4" /> : <Save className="h-4 w-4" />}
            {mode === "create" ? "Ekle" : "Kaydet"}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// À la carte fiyatlar
// ---------------------------------------------------------------------------

function PricingSection({ items, onChanged }: { items: PricingItem[]; onChanged: () => void }) {
  const { toast } = useToast()
  const [rows, setRows] = useState<PricingItem[]>(items)
  const [saving, setSaving] = useState(false)

  useEffect(() => setRows(items), [items])

  const update = (key: string, patch: Partial<PricingItem>) => {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  }

  const save = async () => {
    setSaving(true)
    try {
      const res = await fetch("/api/billing/pricing", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: rows.map((r) => ({
            key: r.key,
            monthlyPrice: Number(r.monthlyPrice) || 0,
            yearlyPrice: Number(r.yearlyPrice) || 0,
            isActive: r.isActive,
          })),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || "Kaydedilemedi")
      toast({ title: "Fiyatlar güncellendi" })
      onChanged()
    } catch (e) {
      toast({ title: "Hata", description: e instanceof Error ? e.message : "Hata", variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-white">Tekil Fiyatlar</h2>
          <p className="text-sm text-slate-500">
            Paket dışı tekil modül ekleme ve ek şube birim fiyatları.
          </p>
        </div>
        <button
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Kaydet
        </button>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-slate-500">
            <tr className="text-left">
              <th className="py-2 pr-4">Öğe</th>
              <th className="py-2 pr-4">Aylık (₺)</th>
              <th className="py-2 pr-4">Yıllık (₺)</th>
              <th className="py-2 pr-4">Aktif</th>
            </tr>
          </thead>
          <tbody className="text-slate-200">
            {rows.map((r) => (
              <tr key={r.key} className="border-t border-slate-800">
                <td className="py-2 pr-4">
                  {r.label}
                  {r.key === BRANCH_ITEM_KEY && <span className="ml-2 rounded bg-slate-700 px-1.5 py-0.5 text-xs text-slate-400">şube/adet · aynı VKN</span>}
                  {r.key === COMPANY_ITEM_KEY && <span className="ml-2 rounded bg-slate-700 px-1.5 py-0.5 text-xs text-slate-400">firma/adet · ayrı VKN</span>}
                </td>
                <td className="py-2 pr-4">
                  <input className={`${inputCls} w-28`} inputMode="decimal" value={String(r.monthlyPrice)} onChange={(e) => update(r.key, { monthlyPrice: e.target.value })} />
                </td>
                <td className="py-2 pr-4">
                  <input className={`${inputCls} w-28`} inputMode="decimal" value={String(r.yearlyPrice)} onChange={(e) => update(r.key, { yearlyPrice: e.target.value })} />
                </td>
                <td className="py-2 pr-4">
                  <input type="checkbox" checked={r.isActive} onChange={(e) => update(r.key, { isActive: e.target.checked })} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
