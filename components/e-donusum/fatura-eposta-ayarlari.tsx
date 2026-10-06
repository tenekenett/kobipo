"use client"

import { useEffect, useState } from "react"
import { Mail } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { useToast } from "@/components/ui/use-toast"
import { useCanCallApi } from "@/components/dashboard/write-guard"

type Ayarlar = {
  invoiceEmailAuto: boolean
  incomingEmailNotify: boolean
  incomingRecipient: string | null
}

const API = "/api/e-donusum/eposta-ayarlari"

/**
 * Fatura e-postası anahtarları (lib/fatura-eposta/). Firma bazındadır: şube kendi
 * anahtarlarını taşır, bu yüzden kart şube görünümünde de çizilir.
 */
export function FaturaEpostaAyarlari({ companyId }: { companyId: string }) {
  const { toast } = useToast()
  const canWrite = useCanCallApi(API, "PUT")
  const [ayarlar, setAyarlar] = useState<Ayarlar | null>(null)
  const [kaydediliyor, setKaydediliyor] = useState<keyof Ayarlar | null>(null)

  useEffect(() => {
    let iptal = false
    setAyarlar(null)
    fetch(`${API}?companyId=${encodeURIComponent(companyId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!iptal && d) setAyarlar(d)
      })
      .catch(() => {})
    return () => {
      iptal = true
    }
  }, [companyId])

  const degistir = async (alan: "invoiceEmailAuto" | "incomingEmailNotify", deger: boolean) => {
    if (!ayarlar) return
    const onceki = ayarlar
    setAyarlar({ ...ayarlar, [alan]: deger })
    setKaydediliyor(alan)
    try {
      const r = await fetch(API, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, [alan]: deger }),
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(data.error || `Kaydedilemedi (${r.status})`)
      setAyarlar((a) => (a ? { ...a, ...data } : a))
      toast({ title: "Kaydedildi" })
    } catch (e: any) {
      setAyarlar(onceki)
      toast({ title: "Hata", description: e?.message, variant: "destructive" })
    } finally {
      setKaydediliyor(null)
    }
  }

  if (!ayarlar) return null

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-kobipo-blue/10 text-kobipo-blue dark:bg-primary/15 dark:text-primary">
            <Mail className="h-4 w-4" />
          </span>
          <div>
            <CardTitle>Fatura e-postaları</CardTitle>
            <CardDescription>e-Fatura ve e-Arşiv belgelerinin e-postayla iletilmesi</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-semibold">Kestiğim faturayı müşteriye e-postayla gönder</p>
            <p className="text-xs text-muted-foreground">
              Belge GİB'e gidince, carinin kartında e-posta varsa PDF ve XML ekli olarak gönderilir.
              Faturanın önizleme ekranından her zaman elle de gönderebilirsiniz.
            </p>
          </div>
          <Switch
            checked={ayarlar.invoiceEmailAuto}
            onCheckedChange={(v) => degistir("invoiceEmailAuto", v)}
            disabled={!canWrite || kaydediliyor !== null}
          />
        </div>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-semibold">Gelen e-faturaları bana e-postayla bildir</p>
            <p className="text-xs text-muted-foreground">
              Gelen her e-fatura PDF'iyle birlikte ayrı bir e-postayla bildirilir.{" "}
              {ayarlar.incomingRecipient ? (
                <>
                  Alıcı: <span className="font-medium text-foreground break-all">{ayarlar.incomingRecipient}</span>{" "}
                  (hesabı açan kişi).
                </>
              ) : (
                <span className="text-amber-700 dark:text-amber-400">
                  Hesapta bildirimin gideceği kurucu yönetici bulunamadı.
                </span>
              )}
            </p>
          </div>
          <Switch
            checked={ayarlar.incomingEmailNotify}
            onCheckedChange={(v) => degistir("incomingEmailNotify", v)}
            disabled={!canWrite || kaydediliyor !== null}
          />
        </div>
      </CardContent>
    </Card>
  )
}
