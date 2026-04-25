import Link from "next/link"
import { Button } from "@/components/ui/button"

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        <h1 className="text-3xl font-bold">Sayfa Bulunamadı</h1>
        <p className="mt-2 text-muted-foreground">Aradığınız sayfa mevcut değil.</p>
        <Link href="/dashboard"><Button className="mt-4">Dashboard'a Dön</Button></Link>
      </div>
    </div>
  )
}
