"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { useToast } from "@/components/ui/use-toast"
import { useTheme } from "@/components/providers/theme-provider"
import { cn } from "@/lib/utils"
import { Laptop, Moon, Sun } from "lucide-react"

export default function ProfilPage() {
  const { toast } = useToast()
  const { theme, setTheme } = useTheme()
  const [isSaving, setIsSaving] = useState(false)
  const [themeMounted, setThemeMounted] = useState(false)

  useEffect(() => {
    setThemeMounted(true)
  }, [])

  const themeChoices: Array<{ value: "light" | "dark" | "system"; label: string; description: string; icon: typeof Sun }> = [
    { value: "light", label: "Aydınlık", description: "Klasik açık tema", icon: Sun },
    { value: "dark", label: "Karanlık", description: "Gözleri yormayan koyu tema", icon: Moon },
    { value: "system", label: "Sistem", description: "Cihazın tercihine uyar", icon: Laptop },
  ]
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
    <div className="space-y-6">
    <Card>
      <CardHeader>
        <CardTitle>Görünüm</CardTitle>
        <CardDescription>Arayüz temasını seçin</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-3">
          {themeChoices.map((choice) => {
            const Icon = choice.icon
            const active = themeMounted && theme === choice.value
            return (
              <button
                key={choice.value}
                type="button"
                onClick={() => setTheme(choice.value)}
                className={cn(
                  "flex flex-col items-start gap-2 rounded-lg border p-4 text-left transition-colors",
                  active
                    ? "border-primary bg-primary/5 ring-1 ring-primary"
                    : "border-border hover:border-primary/40 hover:bg-muted/40"
                )}
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-md bg-muted text-foreground">
                  <Icon className="h-4 w-4" />
                </span>
                <span className="text-sm font-semibold">{choice.label}</span>
                <span className="text-xs text-muted-foreground">{choice.description}</span>
              </button>
            )
          })}
        </div>
      </CardContent>
    </Card>
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
    </div>
  )
}
