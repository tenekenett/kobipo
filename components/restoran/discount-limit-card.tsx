"use client"

// İSKONTO TAVANI ayarı — Raporlar → İkram & Denetim ekranının başında.
//
// Neden ayrı bir "Restoran Ayarları" sayfası değil: tavanın tek anlamı bu
// raporda gördüğü rakamlardır. Patron "verilen iskonto" tutarını görüp aynı
// ekranda sınırı çekebiliyor; açılış saatinin vardiya takviminde durmasıyla
// aynı gerekçe (components/personel/acilis-saati-dialog).
//
// Yazma yetkisi ADMIN'dedir ve `canEdit` SUNUCUDAN gelir — burada rol okumak,
// kuralın iki yerde ayrı ayrı tanımlanması olurdu.

import { useEffect, useState } from "react"
import { Percent } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from "@/components/ui/use-toast"
import { useDashboardCompany } from "@/components/dashboard/dashboard-company-provider"
import { useDiscountLimit } from "@/lib/swr/use-restoran"
import { formatPercent, isValidLimitInput } from "@/lib/restoran/discount-limit"
import { WriteAction } from "@/components/dashboard/write-guard"

export function DiscountLimitCard() {
  const { selectedCompanyId: companyId } = useDashboardCompany()
  const { toast } = useToast()
  const { maxDiscountPercent, canEdit, isLoading, mutate } = useDiscountLimit(companyId)

  /** Boş metin = "sınır yok". Tek alan, iki durum: ayrı bir anahtar gereksizdi. */
  const [draft, setDraft] = useState("")
  const [saving, setSaving] = useState(false)

  // Sunucu değeri değişince taslak da sıfırlanır: ilk yükleme ve "başka biri
  // değiştirdi" durumu aynı yoldan çözülür.
  useEffect(() => {
    setDraft(maxDiscountPercent === null ? "" : String(maxDiscountPercent))
  }, [maxDiscountPercent])

  const trimmed = draft.trim().replace("%", "").replace(",", ".")
  const parsed = trimmed === "" ? null : Number(trimmed)
  const valid = trimmed === "" || (isValidLimitInput(parsed) && !Number.isNaN(parsed))
  const changed = (parsed ?? null) !== maxDiscountPercent

  async function save() {
    if (!companyId || !valid || saving) return
    setSaving(true)
    try {
      const res = await fetch("/api/restoran/iskonto-limiti", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, maxDiscountPercent: parsed }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast({ title: data?.error || "Kaydedilemedi", variant: "destructive" })
        return
      }
      await mutate()
      toast({
        title:
          parsed === null
            ? "İskonto sınırı kaldırıldı"
            : parsed === 0
              ? "İskonto kapatıldı"
              : `Tavan %${formatPercent(parsed)} olarak kaydedildi`,
      })
    } catch {
      toast({ title: "Sunucuya ulaşılamadı", variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Percent className="h-5 w-5" />
          İskonto tavanı
        </CardTitle>
        <CardDescription>
          Bir hesaba verilebilecek en yüksek indirim. <strong>Tutar iskontosunu da bağlar</strong>:
          600 ₺&apos;lik hesaba 500 ₺ indirim %83&apos;tür. Hem adisyonda hem Kahveci Satış
          ekranında geçerlidir ve <strong>herkesi</strong> bağlar — tavanı yalnızca firma
          yöneticisi değiştirebilir.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Yükleniyor…</p>
        ) : canEdit ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="w-full sm:w-48">
              <Label htmlFor="discount-limit" className="text-xs text-muted-foreground">
                En fazla (%)
              </Label>
              <Input
                id="discount-limit"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                inputMode="decimal"
                placeholder="Sınır yok"
                className="mt-1.5 h-11 text-right text-lg font-bold tabular-nums"
              />
            </div>
            <div className="flex items-center gap-2">
              <WriteAction>
              <Button onClick={() => void save()} disabled={!valid || !changed || saving}>
                {saving ? "Kaydediliyor…" : "Kaydet"}
              </Button>
              {/* Sınırı kaldırmak alanı boşaltmakla aynı şey; kasadan uzaktaki
                  patron için tek tıklık kısayolu da olsun. */}
              {maxDiscountPercent !== null && (
                <Button variant="ghost" onClick={() => setDraft("")} disabled={saving}>
                  Sınırı kaldır
                </Button>
              )}
              </WriteAction>
            </div>
            <p className="text-xs text-muted-foreground sm:pb-3">
              {!valid
                ? "0 ile 100 arasında bir yüzde yazın."
                : trimmed === ""
                  ? "Boş bırakılırsa iskonto sınırsızdır."
                  : parsed === 0
                    ? "%0: iskonto tamamen kapanır."
                    : `Kasiyer bir hesapta en fazla %${formatPercent(parsed as number)} indirim yapabilir.`}
            </p>
          </div>
        ) : (
          <p className="text-sm">
            {maxDiscountPercent === null ? (
              <span className="text-muted-foreground">
                Tanımlı bir iskonto sınırı yok. Değiştirmek için firma yöneticisine başvurun.
              </span>
            ) : (
              <>
                <strong>
                  {maxDiscountPercent === 0
                    ? "İskonto kapalı"
                    : `En fazla %${formatPercent(maxDiscountPercent)}`}
                </strong>
                <span className="ml-2 text-muted-foreground">
                  — değiştirmek için firma yöneticisine başvurun.
                </span>
              </>
            )}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
