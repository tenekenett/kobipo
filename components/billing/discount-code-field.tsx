"use client"

import { useState } from "react"
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
  applied,
  onApplied,
  disabled,
}: {
  companyId: string
  scope: "KONTOR" | "PACKAGE"
  mode?: "single" | "perPackage"
  payload: Record<string, unknown>
  applied: AppliedDiscount | null
  onApplied: (d: AppliedDiscount | null) => void
  disabled?: boolean
}) {
  const [code, setCode] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const apply = async () => {
    const trimmed = code.trim()
    if (!trimmed) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch("/api/discount-codes/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, scope, code: trimmed, ...payload }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        // Sunucunun gerekçesi olduğu gibi gösterilir ("süresi dolmuş", "daha önce
        // kullandınız"…): "geçersiz kod" deyip susmak destek çağrısı üretir.
        setError(data?.error || "Kod uygulanamadı")
        onApplied(null)
        return
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
        onApplied({ kind: "perPackage", code: String(data.code), packages: map })
      } else {
        onApplied({
          kind: "single",
          code: String(data.code),
          discountAmount: Number(data.discountAmount) || 0,
          payable: Number(data.payable) || 0,
          listAmount: Number(data.listAmount) || 0,
          appliesToRenewals: Boolean(data.appliesToRenewals),
        })
      }
      setCode("")
    } catch {
      setError("Kod doğrulanamadı, bağlantınızı kontrol edin.")
    } finally {
      setBusy(false)
    }
  }

  const clear = () => {
    onApplied(null)
    setError(null)
    setCode("")
  }

  if (applied) {
    return (
      <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-sm font-semibold">
              <Percent className="h-4 w-4 text-emerald-600" />
              {applied.code} uygulandı
            </p>
            {applied.kind === "single" ? (
              <>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {money(applied.listAmount)} → <strong>{money(applied.payable)}</strong> ·{" "}
                  {money(applied.discountAmount)} indirim
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
          <Button variant="ghost" size="sm" onClick={clear} disabled={disabled || busy}>
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
