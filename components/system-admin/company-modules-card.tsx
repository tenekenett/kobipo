"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { useToast } from "@/components/ui/use-toast"
import { LayoutGrid, Save, Loader2 } from "lucide-react"
import { MANAGEABLE_MODULES, sanitizeFreeModules } from "@/lib/modules"

export function CompanyModulesCard({
  companyId,
  initialDisabled,
  freeModules = [],
}: {
  companyId: string
  initialDisabled: string[]
  /**
   * TEMEL (ücretsiz) modüller — Paket & Fiyat Yönetimi'nden işaretlenir. Firma bazında
   * KAPATILAMAZLAR: `applyEntitlements` her uygulamada onları yeniden açar, yani buradan
   * kapatmak sessizce geri alınırdı. Anahtar bu yüzden devre dışı gösterilir.
   */
  freeModules?: string[]
}) {
  const router = useRouter()
  const { toast } = useToast()
  const [disabled, setDisabled] = useState<Set<string>>(new Set(initialDisabled))
  const [saving, setSaving] = useState(false)

  const freeSet = useMemo(() => new Set(sanitizeFreeModules(freeModules)), [freeModules])
  const initialSet = useMemo(() => new Set(initialDisabled), [initialDisabled])
  const dirty = useMemo(() => {
    if (disabled.size !== initialSet.size) return true
    return Array.from(disabled).some((k) => !initialSet.has(k))
  }, [disabled, initialSet])

  const toggle = (key: string, enabled: boolean) => {
    if (freeSet.has(key)) return // ücretsiz modül kapatılamaz
    setDisabled((prev) => {
      const next = new Set(prev)
      if (enabled) next.delete(key)
      else next.add(key)
      return next
    })
  }

  // Ücretsizler her hâlükârda açık; `disabled` listesinde kalmış olsalar bile sayıma
  // açık girerler (uygulamada da öyle davranıyorlar).
  const enabledCount = MANAGEABLE_MODULES.filter(
    (m) => freeSet.has(m.key) || !disabled.has(m.key),
  ).length

  const handleSave = async () => {
    setSaving(true)
    try {
      const res = await fetch(`/api/system-admin/companies/${companyId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ disabledModules: Array.from(disabled) }),
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
              description: "Modül ayarları hesabın tümüne uygulandı (şubeler ve ek firmalar dahil)",
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
            const isEnabled = isFree || !disabled.has(m.key)
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
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">{m.description}</p>
                </div>
                <Switch
                  checked={isEnabled}
                  disabled={isFree}
                  onCheckedChange={(v) => toggle(m.key, v)}
                  className="shrink-0"
                />
              </div>
            )
          })}
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Kapatılan modüller firmanın menüsünde gizlenir. Dashboard, Ayarlar ve E-Dönüşüm temel
          erişimleri her zaman açıktır.
          {freeSet.size > 0 && (
            <>
              {" "}
              <span className="text-emerald-400">Ücretsiz</span> işaretli modüller tüm hesaplarda
              açıktır ve firma bazında kapatılamaz — kaldırmak için Paket &amp; Fiyat
              Yönetimi&apos;nden ücretsiz işaretini kaldırın.
            </>
          )}
        </p>
      </CardContent>
    </Card>
  )
}
