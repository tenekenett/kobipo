"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"

const REDIRECT_SECONDS = 5

export default function OnboardingCompletePage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const companyId = searchParams.get("company")
  const [countdown, setCountdown] = useState(REDIRECT_SECONDS)

  const dashboardUrl = useMemo(
    () => (companyId ? `/dashboard?company=${companyId}` : "/dashboard"),
    [companyId]
  )

  useEffect(() => {
    const tickInterval = window.setInterval(() => {
      setCountdown((prev) => (prev > 0 ? prev - 1 : 0))
    }, 1000)

    const redirectTimer = window.setTimeout(() => {
      window.location.assign(dashboardUrl)
    }, REDIRECT_SECONDS * 1000)

    return () => {
      window.clearInterval(tickInterval)
      window.clearTimeout(redirectTimer)
    }
  }, [dashboardUrl])

  const handleManualRefreshAndContinue = () => {
    window.location.assign(dashboardUrl)
  }

  return (
    <div className="flex min-h-[70vh] items-center justify-center p-4">
      <Card className="w-full max-w-xl">
        <CardHeader>
          <CardTitle>Artık kullanıma başlamanız için yönlendiriyoruz</CardTitle>
          <CardDescription>
            Sizi ana dashboard ekranına hazırlıyoruz. Bu işlem otomatik olarak tamamlanacak.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {countdown > 0
              ? `${countdown} saniye sonra dashboard ekranına geçilecek.`
              : "Yönlendirme yapılıyor..."}
          </p>
          <p className="text-sm text-muted-foreground">
            Eğer beklemek istemezseniz aşağıdaki butona tıklayarak hemen devam edebilirsiniz.
          </p>
        </CardContent>
        <CardFooter className="justify-end gap-2">
          {/* Otomatik yönlendirme ve "Yenile ve Devam Et" yeni firmaya gider; bu buton
              param'sız gidip kullanıcıyı ilk/eski firmaya düşürüyordu. */}
          <Button type="button" variant="outline" onClick={() => router.push(dashboardUrl)}>
            Dashboard'a Dön
          </Button>
          <Button type="button" onClick={handleManualRefreshAndContinue}>
            Yenile ve Devam Et
          </Button>
        </CardFooter>
      </Card>
    </div>
  )
}
