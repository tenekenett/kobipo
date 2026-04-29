"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { useToast } from "@/components/ui/use-toast"

export default function ProfilPage() {
  const { toast } = useToast()
  const [isSaving, setIsSaving] = useState(false)
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    password: "",
    passwordRepeat: "",
    twoFactorEnabled: false,
  })

  useEffect(() => {
    fetch("/api/auth/profile").then(async (res) => {
      if (!res.ok) return
      const data = await res.json()
      setForm((prev) => ({
        ...prev,
        name: data.name || "",
        email: data.email || "",
        phone: data.phone || "",
        twoFactorEnabled: Boolean(data.twoFactorEnabled),
      }))
    })
  }, [])

  const save = async () => {
    if (form.password && form.password !== form.passwordRepeat) {
      toast({
        title: "Hata",
        description: "Yeni şifre ve tekrar şifresi eşleşmiyor",
        variant: "destructive",
      })
      return
    }
    setIsSaving(true)
    try {
      const response = await fetch("/api/auth/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          email: form.email,
          phone: form.phone,
          password: form.password,
          twoFactorEnabled: form.twoFactorEnabled,
        }),
      })
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || "Profil güncellenemedi")
      }
      toast({
        title: "Başarılı",
        description: "Profil güncellendi. E-posta değişikliği bir sonraki oturumda tam yansır.",
      })
      setForm((prev) => ({ ...prev, password: "", passwordRepeat: "" }))
    } catch (error) {
      toast({
        title: "Hata",
        description: error instanceof Error ? error.message : "Bir hata oluştu",
        variant: "destructive",
      })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Profil ve Güvenlik</CardTitle>
        <CardDescription>Ad, iletişim ve güvenlik bilgilerinizi güncelleyin</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="name">Ad Soyad</Label>
          <Input id="name" placeholder="Ad Soyad" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">E-posta</Label>
          <Input id="email" placeholder="E-posta" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="phone">Telefon</Label>
          <Input id="phone" placeholder="Telefon" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Yeni Şifre (opsiyonel)</Label>
          <Input id="password" placeholder="Yeni şifre" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="passwordRepeat">Yeni Şifre (tekrar)</Label>
          <Input id="passwordRepeat" placeholder="Yeni şifre tekrar" type="password" value={form.passwordRepeat} onChange={(e) => setForm({ ...form, passwordRepeat: e.target.value })} />
        </div>
        <div className="flex items-center justify-between rounded border p-3">
          <div>
            <p className="font-medium text-sm">2FA (TOTP)</p>
            <p className="text-xs text-muted-foreground">İkinci adım doğrulamayı açar</p>
          </div>
          <Switch checked={form.twoFactorEnabled} onCheckedChange={(checked) => setForm({ ...form, twoFactorEnabled: checked })} />
        </div>
        <Button onClick={save} disabled={isSaving}>{isSaving ? "Kaydediliyor..." : "Kaydet"}</Button>
      </CardContent>
    </Card>
  )
}
