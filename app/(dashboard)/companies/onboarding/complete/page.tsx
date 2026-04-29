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
          <CardTitle>Artik kullanima baslamaniz icin yonlendiriyoruz</CardTitle>
          <CardDescription>
            Sizi ana dashboard ekranina hazirliyoruz. Bu islem otomatik olarak tamamlanacak.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {countdown > 0
              ? `${countdown} saniye sonra dashboard ekranina gecilecek.`
              : "Yonlendirme yapiliyor..."}
          </p>
          <p className="text-sm text-muted-foreground">
            Eger beklemek istemezseniz asagidaki butona tiklayarak hemen devam edebilirsiniz.
          </p>
        </CardContent>
        <CardFooter className="justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => router.push("/dashboard")}>
            Dashboarda Don
          </Button>
          <Button type="button" onClick={handleManualRefreshAndContinue}>
            Yenile ve Devam Et
          </Button>
        </CardFooter>
      </Card>
    </div>
  )
}
