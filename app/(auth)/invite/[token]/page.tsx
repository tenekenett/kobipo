"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { useSession } from "next-auth/react"

type InvitationInfo = {
  valid: boolean
  email: string
  role: string
  companyName: string
}

export default function InviteAcceptPage() {
  const { token } = useParams<{ token: string }>()
  const router = useRouter()
  const { data: session } = useSession()
  const [invitation, setInvitation] = useState<InvitationInfo | null>(null)
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading")
  const [error, setError] = useState("")
  const [name, setName] = useState("")
  const [phone, setPhone] = useState("")
  const [password, setPassword] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    fetch(`/api/invitations/${token}`)
      .then(async (response) => {
        if (!response.ok) {
          setStatus("error")
          setError("Davet bulunamadı veya süresi dolmuş.")
          return
        }
        const data = await response.json()
        setInvitation(data)
        setStatus("ready")
      })
      .catch(() => {
        setStatus("error")
        setError("Davet doğrulanamadı.")
      })
  }, [token])

  const accept = async () => {
    setIsSubmitting(true)
    const response = await fetch(`/api/invitations/${token}/accept`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, phone, password }),
    })
    setIsSubmitting(false)
    if (!response.ok) {
      const data = await response.json()
      setError(data.error || "Davet kabul edilemedi")
      return
    }
    router.push("/dashboard")
  }

  return (
    <div className="mx-auto mt-16 w-full max-w-lg">
      <Card>
        <CardHeader>
          <CardTitle>Firma Daveti</CardTitle>
          <CardDescription>Davet edilen firmaya katılım işlemini tamamlayın</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {status === "loading" && <p className="text-sm text-muted-foreground">Davet doğrulanıyor...</p>}
          {status === "error" && <p className="text-sm text-red-600">{error}</p>}
          {status === "ready" && invitation && (
            <>
              <div className="rounded border p-3 text-sm">
                <p><strong>Firma:</strong> {invitation.companyName}</p>
                <p><strong>E-posta:</strong> {invitation.email}</p>
                <p><strong>Rol:</strong> {invitation.role}</p>
              </div>
              {!session && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="name">Ad Soyad</Label>
                    <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="phone">Telefon</Label>
                    <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="password">Şifre</Label>
                    <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
                  </div>
                </>
              )}
              {error && <p className="text-sm text-red-600">{error}</p>}
              <Button onClick={accept} disabled={isSubmitting}>
                {isSubmitting ? "Katılım tamamlanıyor..." : "Firmaya Katıl"}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
