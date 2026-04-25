"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"

export default function ProfilPage() {
  const [form, setForm] = useState({ name: "", email: "", password: "", twoFactorEnabled: false })

  useEffect(() => {
    fetch("/api/auth/profile").then(async (res) => {
      if (!res.ok) return
      const data = await res.json()
      setForm((prev) => ({ ...prev, name: data.name || "", email: data.email || "", twoFactorEnabled: Boolean(data.twoFactorEnabled) }))
    })
  }, [])

  const save = async () => {
    await fetch("/api/auth/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    })
    alert("Profil güncellendi")
    setForm((prev) => ({ ...prev, password: "" }))
  }

  return (
    <Card>
      <CardHeader><CardTitle>Profil ve Güvenlik</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <Input placeholder="Ad Soyad" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <Input placeholder="E-posta" value={form.email} disabled />
        <Input placeholder="Yeni şifre (opsiyonel)" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        <div className="flex items-center justify-between rounded border p-3">
          <div>
            <p className="font-medium text-sm">2FA (TOTP)</p>
            <p className="text-xs text-muted-foreground">İkinci adım doğrulamayı açar</p>
          </div>
          <Switch checked={form.twoFactorEnabled} onCheckedChange={(checked) => setForm({ ...form, twoFactorEnabled: checked })} />
        </div>
        <Button onClick={save}>Kaydet</Button>
      </CardContent>
    </Card>
  )
}
