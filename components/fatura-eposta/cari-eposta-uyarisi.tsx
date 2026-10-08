"use client"

/**
 * Fatura editöründe: GİB'e gidince otomatik e-postayla gidecek belgede carinin kartında
 * geçerli e-posta yoksa bunu ÖNCEDEN söyler ve adresi buradan karta yazdırır.
 *
 * Ölçüm (2026-10-08, otomatik mailin ilk taraması): GİB'e giden 14 belgenin 13'ünde carinin
 * adresi yoktu — uyarı olmadan kullanıcı faturanın müşteriye gittiğini sanıyordu.
 *
 * Adres kuralı gönderimle AYNI: `faturaEpostaAdresi` (lib/fatura-eposta/kurallar.ts).
 * Kart yazımı mevcut PUT ucuyla, yalnız `email` alanıyla yapılır (gönderilmeyen alanlar
 * kayıttaki değerinde kalır); cari yazma yetkisi yoksa yalnız uyarı görünür.
 */

import { useState } from "react"
import { Mail, Loader2 } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/use-toast"
import { useCanCallApi } from "@/components/dashboard/write-guard"
import { ADRES_SEBEP_METNI, faturaEpostaAdresi } from "@/lib/fatura-eposta/kurallar"

export function CariEpostaUyarisi({
  companyId,
  kind,
  cariId,
  email,
  onSaved,
}: {
  companyId: string
  kind: "customer" | "supplier"
  cariId: string
  email: string | null | undefined
  onSaved: (email: string) => void
}) {
  const { toast } = useToast()
  const adres = faturaEpostaAdresi(email)
  const api = `/api/cari/${kind === "customer" ? "customers" : "suppliers"}/${cariId}`
  const canWrite = useCanCallApi(api, "PUT")
  // Geçersiz adres düzeltilsin diye kutuya gelir; GİB posta kutusu etiketi gelmez (e-posta değil).
  const [deger, setDeger] = useState(!adres.ok && adres.sebep === "GECERSIZ" ? (email ?? "").trim() : "")
  const [hata, setHata] = useState<string | null>(null)
  const [kaydediliyor, setKaydediliyor] = useState(false)

  if (adres.ok) return null

  const kaydet = async () => {
    const yeni = deger.trim()
    if (!faturaEpostaAdresi(yeni).ok) {
      setHata("Geçerli bir e-posta adresi yazın.")
      return
    }
    setHata(null)
    setKaydediliyor(true)
    try {
      const res = await fetch(api, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, email: yeni }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast({
          title: "E-posta kaydedilemedi",
          description: data.error || `Sunucu hatası (${res.status})`,
          variant: "destructive",
        })
        return
      }
      toast({ title: "Carinin e-postası kaydedildi", description: "Fatura GİB'e gidince bu adrese gönderilecek." })
      onSaved(yeni)
    } catch (e: any) {
      toast({ title: "E-posta kaydedilemedi", description: e?.message, variant: "destructive" })
    } finally {
      setKaydediliyor(false)
    }
  }

  return (
    <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-200">
      <div className="flex items-start gap-1.5">
        <Mail className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <p>
          {ADRES_SEBEP_METNI[adres.sebep]} Fatura GİB&apos;e gidince e-postayla gönderilemeyecek.
        </p>
      </div>
      {canWrite && (
        <div className="mt-2 flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <Input
              type="email"
              className="h-8 bg-background text-sm"
              placeholder="muhasebe@firma.com"
              value={deger}
              onChange={(e) => {
                setDeger(e.target.value)
                setHata(null)
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  void kaydet()
                }
              }}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 shrink-0"
              onClick={() => void kaydet()}
              disabled={kaydediliyor || !deger.trim()}
            >
              {kaydediliyor ? <Loader2 className="h-4 w-4 animate-spin" /> : "Karta kaydet"}
            </Button>
          </div>
          {hata && <p className="text-red-700 dark:text-red-400">{hata}</p>}
        </div>
      )}
    </div>
  )
}
