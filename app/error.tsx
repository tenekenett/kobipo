"use client"

import { Button } from "@/components/ui/button"

export default function GlobalError({ reset }: { reset: () => void }) {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        <h2 className="text-2xl font-bold">Bir hata oluştu</h2>
        <p className="mt-2 text-muted-foreground">Lütfen tekrar deneyin.</p>
        <Button className="mt-4" onClick={reset}>Tekrar Dene</Button>
      </div>
    </div>
  )
}
