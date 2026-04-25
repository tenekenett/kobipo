"use client"

import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"

export default function AbonelikPage() {
  const companyId = useSearchParams().get("company")
  const [plans, setPlans] = useState<any[]>([])
  const [subscriptions, setSubscriptions] = useState<any[]>([])

  useEffect(() => {
    fetch("/api/plans").then(async (res) => res.ok && setPlans(await res.json()))
    if (companyId) {
      fetch(`/api/subscriptions?companyId=${companyId}`).then(async (res) => res.ok && setSubscriptions(await res.json()))
    }
  }, [companyId])

  const checkout = async (planCode: string) => {
    const response = await fetch("/api/billing/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "stripe", planCode }),
    })
    if (!response.ok) return
    const data = await response.json()
    window.open(data.url, "_blank")
  }

  return (
    <Card>
      <CardHeader><CardTitle>Abonelik</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {subscriptions.map((sub) => (
          <div key={sub.id} className="rounded border p-2 text-sm">
            Aktif Plan: {sub.plan?.name} - Durum: {sub.status}
          </div>
        ))}
        <div className="grid gap-2 md:grid-cols-3">
          {plans.map((plan) => (
            <div key={plan.id} className="rounded border p-3">
              <p className="font-medium">{plan.name}</p>
              <p className="text-sm text-muted-foreground">{plan.monthlyPrice} TRY / ay</p>
              <Button className="mt-2 w-full" onClick={() => checkout(plan.code)}>Planı Seç</Button>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
