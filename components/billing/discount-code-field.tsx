"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Loader2, Percent, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { money } from "@/lib/format"

/**
 * "İndirim kodu" kutusu — kontör ve paket/abonelik satın alma ekranlarının ortağı.
 *
 * Kutu yalnız ÖN İZLEME yapar: indirimi SUNUCU hesaplar
 * ([[app/api/discount-codes/validate/route.ts]]) ve kod, sipariş açılırken bir kez
 * daha doğrulanır. İstemci tutar göndermez — sipariş isteğine yalnız `discountCode`
 * gider. Tutarı istemciden almak, indirimi kullanıcının yazabileceği bir alana
 * çevirirdi.
 *
 * SEÇİM DEĞİŞİNCE KOD DÜŞMEZ, YENİDEN DOĞRULANIR (`selectionKey`).
 * Eskiden abonelik ekranı seçim değişince `setDiscount(null)` yapıyordu: kullanıcı
 * kuponu uygulayıp yeşil kutuyu gördükten sonra bir modülü işaretlediğinde indirim
 * SESSİZCE kayboluyor, özet liste fiyatına dönüyor ve fark etmeyen kullanıcı
 * indirimsiz ödüyordu. Sıfırlamanın kendisi doğruydu (tutar değişti, eski ön izleme
 * yanlış olurdu) — hata sessiz olmasıydı. Artık kod yeni tutara göre yeniden
 * hesaplanır; gerçekten uygulanamıyorsa (ör. yeni seçim kodun kapsamı dışında)
 * SEBEBİ YAZILARAK düşer.
 *
 * İki kip:
 *  - `single`   → tutar tek (paket/abonelik seçimi): kutu indirimli tutarı gösterir.
 *  - `perPackage` → kontör ekranı paketleri liste halinde gösterir; sunucu her paket
 *    için ayrı hesaplar, satırlar kendi indirimli fiyatını basar.
 */
export type AppliedDiscount =
  | {
      kind: "single"
      code: string
      discountAmount: number
      payable: number
      listAmount: number
      appliesToRenewals: boolean
    }
  | {
      kind: "perPackage"
      code: string
      /** packageId → hesap; kodun uymadığı paketler için `error`. */
      packages: Record<
        string,
        { discountAmount: number; payable: number; listAmount: number } | { error: string }
      >
    }

/** Satır fiyatını basacak ekranlar için: bu paket indirimli mi? */
export function packageDiscount(
  applied: AppliedDiscount | null,
  packageId: string,
): { discountAmount: number; payable: number; listAmount: number } | null {
  if (!applied || applied.kind !== "perPackage") return null
  const entry = applied.packages[packageId]
  if (!entry || "error" in entry) return null
  return entry
}

export function DiscountCodeField({
  companyId,
  scope,
  mode = "single",
  /** Fiyatı belirleyen seçim: KONTOR'da `packageId` (tekli kipte), PACKAGE'ta plan/modül/kota/periyot. */
  payload,
  /**
   * Fiyatı etkileyen seçimin imzası. Değiştiğinde uygulanmış kod yeni tutara göre
   * YENİDEN doğrulanır. Vermezseniz kod olduğu gibi kalır — o zaman ön izleme
   * eskimiş tutarı gösterebilir.
   */
  selectionKey,
  applied,
  onApplied,
  /**
   * Kutuda uygulanmamış metin var mı? Ödeme düğmesi bunu dinlemeli: kodu yazıp
   * "Uygula"ya basmadan ödemeye giden kullanıcının kodu siparişe HİÇ gitmez ve
   * liste fiyatından tahsil edilir.
   */
  onDirtyChange,
  disabled,
}: {
  companyId: string
  scope: "KONTOR" | "PACKAGE"
  mode?: "single" | "perPackage"
  payload: Record<string, unknown>
  selectionKey?: string
  applied: AppliedDiscount | null
  onApplied: (d: AppliedDiscount | null) => void
  onDirtyChange?: (dirty: boolean) => void
  disabled?: boolean
}) {
  const [code, setCode] = useState("")
  const [busy, setBusy] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Efektler bu değerlerin EN GÜNCELİNİ okumalı ama değişmeleri efekti yeniden
  // tetiklememeli: `payload` her render'da yeni bir nesnedir, bağımlılığa konursa
  // sonsuz doğrulama döngüsü olur.
  const payloadRef = useRef(payload)
  payloadRef.current = payload
  const appliedRef = useRef(applied)
  appliedRef.current = applied
  const onAppliedRef = useRef(onApplied)
  onAppliedRef.current = onApplied

  /** Sunucuya sorar; cevabı `AppliedDiscount`a çevirir. Hata metni sunucununkidir. */
  const validate = useCallback(
    async (raw: string): Promise<{ ok: true; value: AppliedDiscount } | { ok: false; error: string }> => {
      try {
        const res = await fetch("/api/discount-codes/validate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ companyId, scope, code: raw, ...payloadRef.current }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          // Sunucunun gerekçesi olduğu gibi gösterilir ("süresi dolmuş", "daha önce
          // kullandınız"…): "geçersiz kod" deyip susmak destek çağrısı üretir.
          return { ok: false, error: String(data?.error || "Kod uygulanamadı") }
        }

        if (mode === "perPackage") {
          const map: Record<
            string,
            { discountAmount: number; payable: number; listAmount: number } | { error: string }
          > = {}
          for (const row of Array.isArray(data?.packages) ? data.packages : []) {
            map[row.packageId] =
              row.error != null
                ? { error: String(row.error) }
                : {
                    discountAmount: Number(row.discountAmount) || 0,
                    payable: Number(row.payable) || 0,
                    listAmount: Number(row.listAmount) || 0,
                  }
          }
          return { ok: true, value: { kind: "perPackage", code: String(data.code), packages: map } }
        }

        return {
          ok: true,
          value: {
            kind: "single",
            code: String(data.code),
            discountAmount: Number(data.discountAmount) || 0,
            payable: Number(data.payable) || 0,
            listAmount: Number(data.listAmount) || 0,
            appliesToRenewals: Boolean(data.appliesToRenewals),
          },
        }
      } catch {
        return { ok: false, error: "Kod doğrulanamadı, bağlantınızı kontrol edin." }
      }
    },
    [companyId, scope, mode],
  )

  const apply = async () => {
    const trimmed = code.trim()
    if (!trimmed) return
    setBusy(true)
    setError(null)
    const result = await validate(trimmed)
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      onApplied(null)
      return
    }
    onApplied(result.value)
    setCode("")
    onDirtyChange?.(false)
  }

  // SEÇİM DEĞİŞTİ → uygulanmış kodu yeni tutara göre yeniden hesapla.
  const lastKey = useRef(selectionKey)
  useEffect(() => {
    if (lastKey.current === selectionKey) return
    lastKey.current = selectionKey

    const current = appliedRef.current
    if (!current) return

    let cancelled = false
    setRefreshing(true)
    void (async () => {
      const result = await validate(current.code)
      if (cancelled) return
      setRefreshing(false)
      if (!result.ok) {
        // Kod gerçekten uygulanamıyor — ama SESSİZ DÜŞMÜYOR: sebebi yazılır ki
        // kullanıcı indirim beklerken liste fiyatına farkında olmadan geçmesin.
        onAppliedRef.current(null)
        setError(`${current.code} bu seçime uygulanamadı: ${result.error}`)
        return
      }
      onAppliedRef.current(result.value)
    })()
    return () => {
      cancelled = true
    }
  }, [selectionKey, validate])

  const clear = () => {
    onApplied(null)
    setError(null)
    setCode("")
    onDirtyChange?.(false)
  }

  if (applied) {
    return (
      <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-sm font-semibold">
              <Percent className="h-4 w-4 text-emerald-600" />
              {applied.code} uygulandı
              {refreshing && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
            </p>
            {applied.kind === "single" ? (
              <>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {applied.payable > 0 ? (
                    <>
                      {money(applied.listAmount)} → <strong>{money(applied.payable)}</strong> ·{" "}
                      {money(applied.discountAmount)} indirim
                    </>
                  ) : (
                    <>
                      {money(applied.listAmount)} → <strong>ücretsiz</strong> · tutarın tamamı
                      karşılandı
                    </>
                  )}
                </p>
                {scope === "PACKAGE" && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {applied.appliesToRenewals
                      ? "İndirim yenilemelerde de geçerli."
                      : "İndirim yalnız ilk ödemede geçerli; yenilemeler liste fiyatından çekilir."}
                  </p>
                )}
              </>
            ) : (
              <p className="mt-0.5 text-xs text-muted-foreground">
                İndirimli fiyatlar aşağıda paketlerin yanında görünüyor.
              </p>
            )}
          </div>
          <Button variant="ghost" size="sm" onClick={clear} disabled={disabled || busy || refreshing}>
            <X className="h-4 w-4" />
            <span className="ml-1">Kaldır</span>
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-1.5">
      <div className="flex gap-2">
        <Input
          value={code}
          onChange={(e) => {
            setCode(e.target.value)
            if (error) setError(null)
            onDirtyChange?.(e.target.value.trim().length > 0)
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              void apply()
            }
          }}
          placeholder="İndirim kodu"
          className={error ? "border-destructive focus-visible:ring-destructive" : ""}
          disabled={disabled || busy}
          autoComplete="off"
        />
        <Button variant="outline" onClick={apply} disabled={disabled || busy || !code.trim()}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Uygula"}
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
