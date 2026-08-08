"use client"

import { useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"

const REDIRECT_SECONDS = 5

/**
 * Onboarding sihirbazının son adımı. Yeni firma TÜM modüller kapalı doğduğu için
 * (modül = satın alınan şey, bkz. docs/paket-abonelik/MODUL-KILIDI.md) buradan
 * dashboard'a atmak kullanıcıyı boş bir ekrana bırakırdı; varsayılan hedef modül
 * seçimidir. Dashboard ikincil buton olarak durur.
 */
export default function OnboardingCompletePage() {
  const searchParams = useSearchParams()
  const companyId = searchParams.get("company")
  const [countdown, setCountdown] = useState(REDIRECT_SECONDS)

  const withCompany = (path: string) =>
    companyId ? `${path}?company=${encodeURIComponent(companyId)}` : path

  const modulesUrl = useMemo(() => withCompany("/ayarlar/abonelik"), [companyId])
  const dashboardUrl = useMemo(() => withCompany("/dashboard"), [companyId])

  useEffect(() => {
    const tickInterval = window.setInterval(() => {
      setCountdown((prev) => (prev > 0 ? prev - 1 : 0))
    }, 1000)

    const redirectTimer = window.setTimeout(() => {
      window.location.assign(modulesUrl)
    }, REDIRECT_SECONDS * 1000)

    return () => {
      window.clearInterval(tickInterval)
      window.clearTimeout(redirectTimer)
    }
  }, [modulesUrl])

  return (
    <div className="flex min-h-[70vh] items-center justify-center p-4">
      <Card className="w-full max-w-xl">
        <CardHeader>
          <CardTitle>Firmanız hazır — şimdi modüllerinizi seçin</CardTitle>
          <CardDescription>
            Kobipo modüllerden oluşur; yalnızca ihtiyacınız olanların bedelini ödersiniz. Bir
            paket ya da tek tek modül seçtiğinizde ilgili menüler anında açılır.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {countdown > 0
              ? `${countdown} saniye sonra modül seçim ekranına geçilecek.`
              : "Yönlendirme yapılıyor..."}
          </p>
          <p className="text-sm text-muted-foreground">
            Beklemek istemezseniz aşağıdaki butonla hemen devam edebilirsiniz.
          </p>
        </CardContent>
        <CardFooter className="justify-end gap-2">
          {/* Her iki buton da yeni firmanın param'ını taşır (param'sız link kullanıcıyı
              ilk/eski firmaya düşürüyordu, bkz. CLAUDE.md → ?company= kuralı) ve TAM
              yeniden yükleme yapar: firma listesi layout'ta sunucuda basılıyor, soft
              navigasyon yeni firmayı göremiyor. */}
          <Button
            type="button"
            variant="outline"
            onClick={() => window.location.assign(dashboardUrl)}
          >
            Dashboard'a git
          </Button>
          <Button type="button" onClick={() => window.location.assign(modulesUrl)}>
            Modülleri seç
          </Button>
        </CardFooter>
      </Card>
    </div>
  )
}
