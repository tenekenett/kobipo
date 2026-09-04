"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { useToast } from "@/components/ui/use-toast"
import { LayoutGrid, Save, Loader2 } from "lucide-react"
import {
  MANAGEABLE_MODULES,
  MODULE_KEYS,
  applySuppression,
  moduleLabel,
  sanitizeFreeModules,
  withModuleDependencies,
} from "@/lib/modules"

/**
 * `disabledModules` SONUÇTUR; karta lazım olan ise KARARDIR. İkisi bir yerde ayrışıyor:
 * satın alınmış bir modül, gereksinimi elle kapatıldığı için de kapalı görünebilir
 * (Stok kapatılınca Restoran). O satır "kapat" diye geri gönderilirse hesabın ödediği
 * modülün yetkisi iptal edilir — bu yüzden kapalılığın NEDENİ ayırt edilir:
 *
 *   satın alınmış + gereksinimi elle kapatılmış → kararla değil, zincirle kapalı.
 */
function explicitOff(
  disabled: string[],
  suppressed: string[],
  purchased: string[],
): Set<string> {
  const off = new Set(disabled)
  const suppressedSet = new Set(suppressed)
  const purchasedSet = new Set(purchased)
  return new Set(
    MANAGEABLE_MODULES.filter((m) => {
      if (!off.has(m.key)) return false
      const chained =
        purchasedSet.has(m.key) && (m.requires ?? []).some((dep) => suppressedSet.has(dep))
      return !chained
    }).map((m) => m.key),
  )
}

export function CompanyModulesCard({
  companyId,
  initialDisabled,
  freeModules = [],
  initialSuppressed = [],
  initialPurchased = [],
  accountName,
  accountCompanyCount = 1,
}: {
  companyId: string
  initialDisabled: string[]
  /**
   * TEMEL (ücretsiz) modüller — Paket & Fiyat Yönetimi'nden işaretlenir. Kapatılabilirler,
   * ama kapatma AYRI bir alana (`Company.suppressedModules`) yazılır: `applyEntitlements`
   * ücretsizleri her uygulamada geri açtığı için yalnız `disabledModules`a yazmak sessizce
   * geri alınırdı. Rozet bu farkı kullanıcıya söylüyor.
   */
  freeModules?: string[]
  /** Bu firmada ELLE kapatılmış temel modüller (`Company.suppressedModules`). */
  initialSuppressed?: string[]
  /** Hesabın satın aldığı modüller (`Subscription.purchasedModules`). */
  initialPurchased?: string[]
  /** Hesap kökünün adı — değişikliğin hangi hesabı etkileyeceği yazıyla söylenir. */
  accountName?: string
  /** Hesaptaki firma sayısı (kök + şubeler + ek firmalar). */
  accountCompanyCount?: number
}) {
  const router = useRouter()
  const { toast } = useToast()

  /**
   * Durum AÇIKÇA kapatılanları tutar — bağımlılık yüzünden kapananları değil. Ayrım
   * sunucu için şart: gövdeye "Restoran kapalı" yazmak onun satın alma yetkisini
   * hesabın tümünden kaldırıyor, oysa kullanıcı yalnız bu firmada Stok'u kapatmıştı.
   *
   * DB'den gelen liste sonucu taşıyor; gereksinimi de kapalı olan modül elle
   * kapatılmış sayılmaz (Stok kapalıysa Restoran'ın kapalılığı ondan türer).
   */
  const [off, setOff] = useState<Set<string>>(() =>
    explicitOff(initialDisabled, initialSuppressed, initialPurchased),
  )
  const [applyToAccount, setApplyToAccount] = useState(false)
  const [saving, setSaving] = useState(false)

  const freeSet = useMemo(() => new Set(sanitizeFreeModules(freeModules)), [freeModules])
  const initialSet = useMemo(
    () => explicitOff(initialDisabled, initialSuppressed, initialPurchased),
    [initialDisabled, initialSuppressed, initialPurchased],
  )
  const dirty = useMemo(() => {
    if (off.size !== initialSet.size) return true
    return Array.from(off).some((k) => !initialSet.has(k))
  }, [off, initialSet])

  /** Kapatma kararının SONUCU: kapatılanlar ve onlara bağımlı olanlar düşülmüş küme. */
  const openSet = useMemo(
    () =>
      new Set(
        applySuppression(
          withModuleDependencies(MODULE_KEYS.filter((k) => !off.has(k))),
          [...off],
        ),
      ),
    [off],
  )

  /**
   * AÇARKEN gereksinimler de açılır (Restoran açılıyorsa Stok kapalı kalamaz),
   * KAPATIRKEN yalnız o anahtar işaretlenir — bağımlıları sonuç kümesinde kapanır ve
   * kartta "… kapalı olduğu için" notuyla gösterilir.
   */
  const toggle = (key: string, enabled: boolean) => {
    setOff((prev) => {
      const next = new Set(prev)
      if (enabled) for (const k of withModuleDependencies([key])) next.delete(k)
      else next.add(key)
      return next
    })
  }

  const enabledCount = MANAGEABLE_MODULES.filter((m) => openSet.has(m.key)).length
  // Elle kapatılan TEMEL modüller: kapsam seçimi (ve kalıcı kapatma) yalnız bunlar için
  // anlamlı — ücretli modülün kapatılması satın alma yetkisini kaldırır.
  const suppressed = useMemo(
    () => MODULE_KEYS.filter((k) => freeSet.has(k) && off.has(k)),
    [freeSet, off],
  )

  const handleSave = async () => {
    setSaving(true)
    try {
      const res = await fetch(`/api/system-admin/companies/${companyId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // AÇIKÇA kapatılanlar; bağımlılık sonucu kapananları sunucu türetir.
          disabledModules: Array.from(off),
          applyModulesToAccount: applyToAccount,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || "Kaydetme başarısız")
      // Yetki artık aboneliğe de yazılıyor; yazacak aktif abonelik yoksa uç uyarı
      // döner (yeniden hesaplamada kapanır) — sessizce "başarılı" demek yanıltırdı.
      toast(
        json.warning
          ? { title: "Kaydedildi — dikkat", description: json.warning, variant: "destructive" }
          : {
              title: "Başarılı",
              description:
                suppressed.length && applyToAccount
                  ? "Modül ayarları kaydedildi; temel modül kapatması hesabın tüm firmalarına uygulandı."
                  : "Modül ayarları kaydedildi — yalnız bu firma için geçerli.",
            },
      )
      router.refresh()
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

  return (
    <Card className="bg-slate-900/50 border-slate-800 lg:col-span-2">
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="text-white flex items-center gap-2">
              <LayoutGrid className="h-5 w-5 text-indigo-400" />
              Modüller
            </CardTitle>
            <CardDescription className="text-slate-500">
              Bu firmanın dashboard menüsünde görünecek modüller ({enabledCount}/
              {MANAGEABLE_MODULES.length} açık)
            </CardDescription>
          </div>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={saving || !dirty}
            className="bg-blue-600 hover:bg-blue-700 shrink-0"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Save className="h-4 w-4 mr-1" />
            )}
            Kaydet
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {MANAGEABLE_MODULES.map((m) => {
            const isFree = freeSet.has(m.key)
            const isEnabled = openSet.has(m.key)
            // Kapalı ama elle kapatılmamış → bir gereksinimi kapalı olduğu için kapalı.
            const blockedBy = !isEnabled && !off.has(m.key)
              ? (m.requires ?? []).filter((dep) => !openSet.has(dep))
              : []
            return (
              <div
                key={m.key}
                className={`flex items-start justify-between gap-3 rounded-lg border p-3 transition-colors ${
                  isEnabled
                    ? "border-slate-700 bg-slate-800/50"
                    : "border-slate-800 bg-slate-900/40 opacity-70"
                }`}
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-white flex items-center gap-2">
                    {m.label}
                    {isFree && (
                      <span className="rounded bg-emerald-600/20 px-1.5 py-0.5 text-[10px] font-normal text-emerald-300">
                        ücretsiz
                      </span>
                    )}
                    {isFree && off.has(m.key) && (
                      <span className="rounded bg-amber-600/20 px-1.5 py-0.5 text-[10px] font-normal text-amber-300">
                        elle kapatıldı
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">{m.description}</p>
                  {blockedBy.length > 0 && (
                    <p className="mt-1 text-xs text-amber-400/80">
                      {blockedBy.map(moduleLabel).join(", ")} kapalı olduğu için kapalı
                    </p>
                  )}
                </div>
                <Switch
                  checked={isEnabled}
                  onCheckedChange={(v) => toggle(m.key, v)}
                  className="shrink-0"
                />
              </div>
            )
          })}
        </div>

        {/* Kapsam yalnız TEMEL modül kapatması için anlamlı: ücretli modülün kapatılması
            satın alma yetkisini kaldırır ve o zaten hesabın tamamını etkiler. */}
        {suppressed.length > 0 && (
          <label className="mt-3 flex items-start gap-2 rounded-lg border border-amber-900/40 bg-amber-950/20 p-3 text-xs text-amber-200">
            <input
              type="checkbox"
              checked={applyToAccount}
              onChange={(e) => setApplyToAccount(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-amber-500"
            />
            <span>
              Temel modül kapatmasını{" "}
              <span className="font-medium">
                {accountName ? `${accountName} hesabındaki` : "hesaptaki"} tüm firmalara
                {accountCompanyCount > 1 ? ` (${accountCompanyCount} firma)` : ""}
              </span>{" "}
              uygula. İşaretlenmezse yalnız bu firmada kapanır.
            </span>
          </label>
        )}

        <p className="mt-3 text-xs text-slate-500">
          Kapatılan modüller firmanın menüsünde gizlenir. Dashboard, Ayarlar ve E-Dönüşüm temel
          erişimleri her zaman açıktır. Modül yetkisi <span className="font-medium text-slate-300">
          firma bazındadır</span>: burada açtığınız modül şubelere ya da ek firmalara GEÇMEZ,
          onların kendi abonelikleri vardır.{" "}
          <span className="text-emerald-400">Ücretsiz</span> işaretli modüller satın alma
          gerektirmez; kapatılırsa bu karar kalıcıdır ve müşterinin abonelik ekranında da
          görünmez. Ücretli bir modülü kapatmak satın alma yetkisini{" "}
          <span className="font-medium text-slate-300">hesabın tümünden</span> kaldırır
          (abonelik onu artık faturalamaz).
        </p>
      </CardContent>
    </Card>
  )
}
