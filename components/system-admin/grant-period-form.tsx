"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { AlertTriangle, CalendarPlus, Check, Loader2 } from "lucide-react"
import { useToast } from "@/components/ui/use-toast"
import { MANAGEABLE_MODULES, withModuleDependencies } from "@/lib/modules"
import { MAX_GRANT_DAYS, MAX_GRANT_MONTHS } from "@/lib/billing/period"

type DurationKind = "days" | "months" | "untilDate"
type TriState = "keep" | "on" | "off"

/** Formun ihtiyaç duyduğu mevcut abonelik özeti — uyarıları buna göre gösterir. */
export type GrantSubscriptionView = {
  status: string
  periodEnd: string | null
  trialEndsAt: string | null
  autoRenew: boolean
  provider: string
  /** Saklı kart VAR MI — token'ın kendisi tarayıcıya hiç gelmez. */
  hasStoredCard?: boolean
  purchasedModules: string[]
} | null

const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString("tr-TR") : "—")

const seg = (active: boolean) =>
  `rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
    active ? "bg-indigo-500/25 text-indigo-200" : "text-slate-400 hover:text-slate-200"
  }`

/**
 * Sistem-admin: bir hesaba ELLE abonelik süresi verme formu.
 *
 * İki yerde kullanılır (abonelik listesi ve firma detayı) — kural tek yerde dursun diye
 * ortak bileşen. Tutar/tarih doğrulaması sunucudadır ([[lib/billing/admin.ts]] →
 * `grantAccountPeriod`); buradaki kontroller yalnız kullanıcıyı boş istekten korur.
 *
 * Formun anlattığı üç ayrım:
 * - **Uzat / Yeniden başlat:** fark yalnız dönemi HENÜZ BİTMEMİŞ hesapta görünür.
 *   "Uzat" kalan günleri korur, "yeniden başlat" onları siler.
 * - **Ödeme alındı:** işaretlenmezse süre hediyedir (mali kayıt üretilmez); işaretlenirse
 *   `PackageOrder` + otomatik satış faturası çıkar. Havale/elden tahsilatın yeri burasıdır.
 * - **Modül seti:** "dokunma" varsayılandır. Süre vermek modül açmaz — hesabın satın
 *   alınmış modülü yoksa süre verilir ama panel boş kalır, sunucu bunu uyarı olarak döner.
 */
export function GrantPeriodForm({
  companyId,
  accountName,
  subscription,
  onDone,
}: {
  companyId: string
  accountName: string
  subscription: GrantSubscriptionView
  onDone?: () => void
}) {
  const { toast } = useToast()
  // Sunucu bileşeninden (firma detayı) çağrıldığında `onDone` yoktur; sayfanın taze
  // veriyle yeniden çizilmesi için router yenilemesi şart.
  const router = useRouter()

  const [mode, setMode] = useState<"extend" | "set">("extend")
  const [kind, setKind] = useState<DurationKind>("months")
  const [days, setDays] = useState("30")
  const [months, setMonths] = useState("1")
  const [untilDate, setUntilDate] = useState("")
  const [cycle, setCycle] = useState<"keep" | "MONTHLY" | "YEARLY">("keep")
  const [autoRenew, setAutoRenew] = useState<TriState>("keep")
  const [touchModules, setTouchModules] = useState(false)
  const [modules, setModules] = useState<Set<string>>(
    () => new Set(subscription?.purchasedModules ?? []),
  )
  const [paymentReceived, setPaymentReceived] = useState(false)
  const [amount, setAmount] = useState("")
  const [busy, setBusy] = useState(false)
  const [warnings, setWarnings] = useState<string[]>([])

  const currentEnd =
    subscription?.status === "TRIAL"
      ? (subscription?.trialEndsAt ?? subscription?.periodEnd ?? null)
      : (subscription?.periodEnd ?? subscription?.trialEndsAt ?? null)

  // "Uzat" ile "yeniden başlat" farkı yalnız dönem gelecekteyken anlamlı; geçmişte
  // kalmışsa ikisi de bugünden başlar. Kullanıcı bunu bilmeden seçim yapmasın.
  const periodInFuture = currentEnd != null && new Date(currentEnd).getTime() > Date.now()

  // Saklı kartla otomatik yenileme kurulu mu? (PAYTR_RECURRING_ENABLED sunucuda; burada
  // yalnız kartın varlığı görülebiliyor — uyarı yine de doğru yöne işaret eder.)
  const recurringLikely =
    subscription?.provider === "PAYTR" &&
    subscription.autoRenew &&
    Boolean(subscription.hasStoredCard)

  const toggleModule = (key: string) =>
    setModules((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      // Bağımlılıklar sunucuda da tamamlanıyor; burada göstermek seçimi şeffaf kılar.
      else for (const dep of withModuleDependencies([key])) next.add(dep)
      return next
    })

  const canSubmit =
    (kind === "untilDate" ? untilDate !== "" : (kind === "days" ? days : months) !== "") &&
    (!paymentReceived || Number(amount) > 0) &&
    !busy

  async function submit() {
    setBusy(true)
    setWarnings([])
    try {
      const res = await fetch("/api/billing/admin/period", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId,
          mode,
          days: kind === "days" ? Number(days) : null,
          months: kind === "months" ? Number(months) : null,
          untilDate: kind === "untilDate" ? untilDate : null,
          billingCycle: cycle === "keep" ? null : cycle,
          autoRenew: autoRenew === "keep" ? null : autoRenew === "on",
          modules: touchModules ? Array.from(modules) : null,
          paymentReceived,
          amount: paymentReceived ? Number(amount) : null,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || "Süre verilemedi")

      setWarnings(Array.isArray(data?.warnings) ? data.warnings : [])
      toast({
        title: "Süre verildi",
        // İKİ SAYI birden: yönetici "1 ay" yazdıysa "+30 gün" görmeli (girdisinin
        // doğrulaması), "bugünden 275 gün" ise hesabın kalan yolu. Tek sayı gösterilince
        // ikisi karışıyor ve verilen süre yanlış okunuyordu.
        description:
          `${accountName} → dönem sonu ${new Date(data.periodEnd).toLocaleDateString("tr-TR")}` +
          ` · +${data.addedDays} gün (bugünden ${data.totalDaysFromNow} gün)`,
      })
      onDone?.()
      router.refresh()
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Hata",
        description: e instanceof Error ? e.message : "Süre verilemedi",
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-slate-800 bg-slate-950/40 p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
        <span className="inline-flex items-center gap-1.5 font-medium text-slate-300">
          <CalendarPlus className="h-3.5 w-3.5 text-indigo-400" />
          Elle süre ver
        </span>
        <span>
          şu anki bitiş: <span className="text-slate-300">{fmt(currentEnd)}</span>
          {subscription && ` · ${subscription.status}`}
        </span>
      </div>

      {/* Uzat / yeniden başlat */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-slate-500">yöntem:</span>
        <div className="inline-flex rounded-lg border border-slate-700 bg-slate-800/60 p-0.5">
          <button type="button" className={seg(mode === "extend")} onClick={() => setMode("extend")}>
            Uzat
          </button>
          <button type="button" className={seg(mode === "set")} onClick={() => setMode("set")}>
            Bugünden başlat
          </button>
        </div>
        <span className="text-slate-600">
          {periodInFuture
            ? mode === "extend"
              ? "kalan günler korunur"
              : "kalan günler SİLİNİR"
            : "dönem zaten geçmiş — ikisi de bugünden başlar"}
        </span>
      </div>

      {/* Süre */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-slate-500">süre:</span>
        <div className="inline-flex rounded-lg border border-slate-700 bg-slate-800/60 p-0.5">
          <button type="button" className={seg(kind === "days")} onClick={() => setKind("days")}>
            Gün
          </button>
          <button type="button" className={seg(kind === "months")} onClick={() => setKind("months")}>
            Ay
          </button>
          <button
            type="button"
            className={seg(kind === "untilDate")}
            onClick={() => setKind("untilDate")}
          >
            Tarihe kadar
          </button>
        </div>
        {kind === "days" && (
          <input
            type="number"
            min={1}
            max={MAX_GRANT_DAYS}
            value={days}
            onChange={(e) => setDays(e.target.value)}
            className="w-20 rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-sm text-white focus:border-indigo-500 focus:outline-none"
            aria-label="Gün"
          />
        )}
        {kind === "months" && (
          <input
            type="number"
            min={1}
            max={MAX_GRANT_MONTHS}
            value={months}
            onChange={(e) => setMonths(e.target.value)}
            className="w-20 rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-sm text-white focus:border-indigo-500 focus:outline-none"
            aria-label="Ay"
          />
        )}
        {kind === "untilDate" && (
          <input
            type="date"
            value={untilDate}
            onChange={(e) => setUntilDate(e.target.value)}
            className="rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-sm text-white focus:border-indigo-500 focus:outline-none"
            aria-label="Bitiş tarihi"
          />
        )}
      </div>

      {/* Periyot + otomatik yenileme */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
        <span className="inline-flex items-center gap-2">
          <span className="text-slate-500">periyot:</span>
          <div className="inline-flex rounded-lg border border-slate-700 bg-slate-800/60 p-0.5">
            {(["keep", "MONTHLY", "YEARLY"] as const).map((c) => (
              <button key={c} type="button" className={seg(cycle === c)} onClick={() => setCycle(c)}>
                {c === "keep" ? "Dokunma" : c === "MONTHLY" ? "Aylık" : "Yıllık"}
              </button>
            ))}
          </div>
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="text-slate-500">otomatik yenileme:</span>
          <div className="inline-flex rounded-lg border border-slate-700 bg-slate-800/60 p-0.5">
            {(["keep", "on", "off"] as TriState[]).map((v) => (
              <button
                key={v}
                type="button"
                className={seg(autoRenew === v)}
                onClick={() => setAutoRenew(v)}
              >
                {v === "keep" ? "Dokunma" : v === "on" ? "Aç" : "Kapat"}
              </button>
            ))}
          </div>
        </span>
      </div>

      {/* TUZAK uyarısı: süre uzatmak yinelenen çekimi durdurmaz. */}
      {recurringLikely && autoRenew !== "off" && (
        <p className="flex items-start gap-2 rounded-md bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Bu hesapta saklı kart var ve otomatik yenileme açık. Süre uzatmak çekimi
          DURDURMAZ — verilen süre bitince kart yeniden çekilir. Hediye/telafi veriyorsanız
          otomatik yenilemeyi &quot;Kapat&quot; seçin.
        </p>
      )}

      {/* Modül seti */}
      <div className="space-y-2">
        <label className="inline-flex items-center gap-2 text-xs text-slate-400">
          <input
            type="checkbox"
            checked={touchModules}
            onChange={(e) => setTouchModules(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-slate-600 bg-slate-800"
          />
          Modül setini de yaz (işaretlenmezse mevcut set korunur)
        </label>
        {touchModules && (
          <div className="flex flex-wrap gap-1.5">
            {MANAGEABLE_MODULES.map((m) => {
              const on = modules.has(m.key)
              return (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => toggleModule(m.key)}
                  className={`rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                    on
                      ? "bg-emerald-500/20 text-emerald-300"
                      : "bg-slate-800 text-slate-400 hover:text-slate-200"
                  }`}
                >
                  {on && <Check className="mr-1 inline h-3 w-3" />}
                  {m.label}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Tahsilat */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <label className="inline-flex items-center gap-2 text-slate-400">
          <input
            type="checkbox"
            checked={paymentReceived}
            onChange={(e) => setPaymentReceived(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-slate-600 bg-slate-800"
          />
          Ödeme alındı (havale/elden)
        </label>
        {paymentReceived && (
          <>
            <input
              type="number"
              min={0}
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Tutar (₺)"
              className="w-28 rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-sm text-white placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none"
              aria-label="Tahsil edilen tutar"
            />
            <span className="text-slate-600">sipariş + otomatik satış faturası üretilir</span>
          </>
        )}
      </div>

      {/* GEREKÇE ALANI KALDIRILDI (2026-08-27). Serbest metin, müşterinin kendi
          "Abonelik geçmişi" ekranında birebir görünüyordu; iç not için tasarlanmış bir
          kutu müşteriye açılıyordu. İz zaten yapısal olarak tutuluyor: kim (actorUserId),
          ne zaman, önceki/sonraki dönem, modül seti, tutar. */}

      {warnings.length > 0 && (
        <ul className="space-y-1">
          {warnings.map((w) => (
            <li
              key={w}
              className="flex items-start gap-2 rounded-md bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-300"
            >
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {w}
            </li>
          ))}
        </ul>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={submit}
          disabled={!canSubmit}
          className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-500/20 px-3 py-1.5 text-xs font-medium text-indigo-200 hover:bg-indigo-500/30 disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          Süreyi ver
        </button>
      </div>
    </div>
  )
}
