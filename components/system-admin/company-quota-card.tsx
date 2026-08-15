"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2, Check, AlertTriangle, Store, Building2 } from "lucide-react"
import { useToast } from "@/components/ui/use-toast"
import { useConfirm } from "@/components/ui/confirm-dialog-provider"
import { MAX_BRANCH_QUOTA, MAX_COMPANY_QUOTA } from "@/lib/billing/constants"

type QuotaKind = "branch" | "company"

type QuotaView = { quota: number; used: number }

/**
 * Bir firmanın hesabındaki ŞUBE ve FİRMA kotasını elle ayarlar (destek/demo yolu).
 *
 * Kotalar HESAP düzeyindedir: bu ekran bir şubede ya da ek firmada açılsa bile değeri
 * hesap köküne yazar — bu yüzden hangi hesaba dokunulduğu açıkça yazılır. İki kota AYRI
 * havuzdur (şube = aynı VKN, ek firma = ayrı VKN), o yüzden ayrı ayrı kaydedilir.
 *
 * Not: kota vermek modül açmak DEĞİLDİR; uç yetkilere dokunmaz.
 */
export function CompanyQuotaCard({
  companyId,
  accountRootName,
  isAccountRoot,
  branch,
  company,
  hasActiveSubscription,
}: {
  companyId: string
  accountRootName: string
  isAccountRoot: boolean
  branch: QuotaView
  company: QuotaView
  hasActiveSubscription: boolean
}) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-5">
      <h2 className="text-lg font-semibold text-white">Kotalar</h2>
      <p className="mt-1 text-sm text-slate-500">
        {isAccountRoot ? (
          <>Bu hesabın açabileceği şube ve ek firma adedi. Kota vermek modül açmaz.</>
        ) : (
          <>
            Bu firma <span className="font-medium text-slate-300">{accountRootName}</span> hesabına
            bağlı; kota hesap düzeyinde tutulduğu için değişiklik o hesaba yazılır.
          </>
        )}
      </p>

      {!hasActiveSubscription && (
        <p className="mt-3 flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          Hesabın aktif aboneliği yok — kota tek başına etkisizdir (şube/firma ekleme aktif
          abonelik ister). Kaydederken 1 yıllık deneme aboneliği oluşturulmasını onaylayabilirsiniz.
        </p>
      )}

      <div className="mt-4 space-y-3">
        <QuotaRow
          companyId={companyId}
          kind="branch"
          label="Şube kotası"
          hint="Aynı VKN, farklı adres"
          icon={<Store className="h-4 w-4" />}
          view={branch}
        />
        <QuotaRow
          companyId={companyId}
          kind="company"
          label="Ek firma kotası"
          hint="Ayrı VKN, aynı abonelik"
          icon={<Building2 className="h-4 w-4" />}
          view={company}
        />
      </div>
    </div>
  )
}

function QuotaRow({
  companyId,
  kind,
  label,
  hint,
  icon,
  view,
}: {
  companyId: string
  kind: QuotaKind
  label: string
  hint: string
  icon: React.ReactNode
  view: QuotaView
}) {
  const router = useRouter()
  const { toast } = useToast()
  const { confirm } = useConfirm()
  const [value, setValue] = useState(String(view.quota))
  const [saving, setSaving] = useState(false)

  const max = kind === "branch" ? MAX_BRANCH_QUOTA : MAX_COMPANY_QUOTA
  const parsed = Number.parseInt(value, 10)
  const valid = Number.isInteger(parsed) && parsed >= 0 && parsed <= max
  const dirty = valid && parsed !== view.quota
  // Kotayı açık olanın ALTINA çekmek mevcutları kotasız bırakır: engellemiyoruz
  // (destek bilinçli düşürebilir) ama uyarıyoruz.
  const belowUsed = valid && parsed < view.used

  const save = async (createTrial = false): Promise<void> => {
    setSaving(true)
    try {
      const res = await fetch("/api/billing/admin/quota", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId,
          ...(kind === "branch" ? { branchQuota: parsed } : { companyQuota: parsed }),
          createTrialIfMissing: createTrial,
        }),
      })
      const data = await res.json().catch(() => ({}))

      if (res.status === 409 && data?.code === "NO_SUBSCRIPTION" && !createTrial) {
        setSaving(false)
        const ok = await confirm({
          title: "Hesabın aboneliği yok",
          description:
            "Kota abonelik satırında tutulur ve ekleme aktif abonelik ister. Devam edilirse " +
            "1 yıllık deneme aboneliği oluşturulup kota buna yazılacak. Modül yetkileri DEĞİŞMEZ.",
        })
        if (!ok) return
        return save(true)
      }

      if (!res.ok) throw new Error(data?.error || "Kota güncellenemedi")
      toast({
        title: `${label} güncellendi`,
        description: `${kind === "branch" ? data.branchQuota : data.companyQuota} ${
          kind === "branch" ? "şube" : "firma"
        }${data.createdSubscription ? " (deneme aboneliği oluşturuldu)" : ""}`,
      })
      router.refresh()
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Hata",
        description: e instanceof Error ? e.message : "Kota güncellenemedi",
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-800 bg-slate-950/40 p-3">
      <span className="flex items-center gap-2 text-sm text-slate-300">
        <span className="text-slate-500">{icon}</span>
        {label}
      </span>
      <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[11px] text-slate-400">{hint}</span>

      <input
        type="number"
        min={0}
        max={max}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && dirty && !saving) save()
          if (e.key === "Escape") setValue(String(view.quota))
        }}
        disabled={saving}
        aria-label={label}
        className={`w-20 rounded-md border bg-slate-800 px-2 py-1 text-sm text-white focus:outline-none disabled:opacity-50 ${
          valid ? "border-slate-700 focus:border-indigo-500" : "border-red-500/60"
        }`}
      />
      <span className="text-xs text-slate-500">kullanılan: {view.used}</span>

      {dirty && (
        <button
          onClick={() => save()}
          disabled={saving}
          className="inline-flex items-center gap-1 rounded-md bg-emerald-500/15 px-2.5 py-1 text-xs font-medium text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          Kaydet
        </button>
      )}
      {belowUsed && (
        <span className="inline-flex items-center gap-1 text-xs text-amber-400">
          <AlertTriangle className="h-3.5 w-3.5" />
          mevcut {view.used} adedin altında — yenisi eklenemez
        </span>
      )}
    </div>
  )
}
