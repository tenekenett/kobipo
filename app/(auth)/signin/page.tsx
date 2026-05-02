"use client"

import { useState, useEffect } from "react"
import { signIn, useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import { useToast } from "@/components/ui/use-toast"
import { roleToDashboardPath } from "@/lib/auth/role-paths"

export default function SignInPage() {
  const router = useRouter()
  const { toast } = useToast()
  const { data: session, status } = useSession()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (status !== "authenticated" || !session) return

    if (session.user?.isSuperAdmin) {
      router.push("/system-admin")
      return
    }

    const defaultCompanyId = session.user?.defaultCompanyId
    const defaultRole = session.user?.defaultRole

    if (defaultCompanyId && defaultRole) {
      const params = new URLSearchParams({ company: defaultCompanyId })
      router.push(`${roleToDashboardPath(defaultRole)}?${params.toString()}`)
      return
    }

    router.push("/dashboard")
  }, [session, status, router])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)

    try {
      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
      })

      if (result?.error) {
        toast({
          title: "Hata",
          description: "Email veya şifre hatalı",
          variant: "destructive",
        })
      } else {
        router.replace("/dashboard")
      }
    } catch (error) {
      toast({
        title: "Hata",
        description: "Bir hata oluştu",
        variant: "destructive",
      })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-kobipo-border shadow-card p-8">
      <h1 className="mb-1 text-2xl font-extrabold tracking-tight text-kobipo-navy">Giriş Yap</h1>
      <p className="mb-6 text-sm text-kobipo-gray">Hesabınıza erişmek için bilgilerinizi girin.</p>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="email" className="mb-1.5 block text-xs font-semibold text-kobipo-navy">E-posta</label>
          <input
            id="email"
            type="email"
            placeholder="ornek@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            disabled={isLoading}
            className="w-full rounded-lg border-[1.5px] border-kobipo-border bg-white px-3 py-2.5 text-sm text-kobipo-text placeholder:text-kobipo-gray/60 transition-colors focus:border-kobipo-blue focus:outline-none"
          />
        </div>
        <div>
          <label htmlFor="password" className="mb-1.5 block text-xs font-semibold text-kobipo-navy">Şifre</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            disabled={isLoading}
            className="w-full rounded-lg border-[1.5px] border-kobipo-border bg-white px-3 py-2.5 text-sm text-kobipo-text placeholder:text-kobipo-gray/60 transition-colors focus:border-kobipo-blue focus:outline-none"
          />
        </div>
        <button type="submit" className="w-full mt-5 rounded-lg bg-kobipo-blue py-2.5 text-sm font-semibold text-white transition-colors hover:bg-kobipo-mid" disabled={isLoading}>
          {isLoading ? "Giriş yapılıyor..." : "Giriş Yap"}
        </button>
        <button type="button" className="text-xs font-semibold text-kobipo-blue hover:text-kobipo-mid" onClick={() => router.push("/signup")}>
          Hesabınız yok mu? Kayıt olun
        </button>
      </form>
    </div>
  )
}
