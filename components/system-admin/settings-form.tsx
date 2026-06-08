"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { useToast } from "@/components/ui/use-toast"
import { Server, Shield, Bell, Save, Loader2 } from "lucide-react"
import type { SystemSettings } from "@/lib/system/settings"

export function SettingsForm({ initial }: { initial: SystemSettings }) {
  const router = useRouter()
  const { toast } = useToast()
  const [form, setForm] = useState<SystemSettings>(initial)
  const [saving, setSaving] = useState(false)

  const set = <K extends keyof SystemSettings>(key: K, value: SystemSettings[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  const dirty = JSON.stringify(form) !== JSON.stringify(initial)

  const handleSave = async () => {
    setSaving(true)
    try {
      const res = await fetch("/api/system-admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || "Kaydetme başarısız")
      toast({ title: "Başarılı", description: "Sistem ayarları kaydedildi" })
      router.refresh()
    } catch (e) {
      toast({
        title: "Hata",
        description: e instanceof Error ? e.message : "Bir hata oluştu",
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Genel Ayarlar */}
        <Card className="bg-slate-900/50 border-slate-800">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2">
              <Server className="h-5 w-5 text-blue-400" />
              Genel Ayarlar
            </CardTitle>
            <CardDescription className="text-slate-500">Temel platform ayarları</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label className="text-slate-300">Platform Adı</Label>
              <Input
                value={form.platformName}
                onChange={(e) => set("platformName", e.target.value)}
                className="bg-slate-800/50 border-slate-700 text-white"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-slate-300">Destek Email</Label>
              <Input
                type="email"
                value={form.supportEmail}
                onChange={(e) => set("supportEmail", e.target.value)}
                className="bg-slate-800/50 border-slate-700 text-white"
              />
            </div>
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-slate-300">Bakım Modu</Label>
                <p className="text-xs text-slate-500">Platformu bakım moduna al</p>
              </div>
              <Switch
                checked={form.maintenanceMode}
                onCheckedChange={(v) => set("maintenanceMode", v)}
              />
            </div>
          </CardContent>
        </Card>

        {/* Güvenlik */}
        <Card className="bg-slate-900/50 border-slate-800">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2">
              <Shield className="h-5 w-5 text-red-400" />
              Güvenlik
            </CardTitle>
            <CardDescription className="text-slate-500">Güvenlik ve erişim ayarları</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-slate-300">2FA Zorunlu</Label>
                <p className="text-xs text-slate-500">Tüm admin kullanıcılar için</p>
              </div>
              <Switch checked={form.require2FA} onCheckedChange={(v) => set("require2FA", v)} />
            </div>
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-slate-300">IP Kısıtlaması</Label>
                <p className="text-xs text-slate-500">Super admin için IP kontrolü</p>
              </div>
              <Switch checked={form.ipRestriction} onCheckedChange={(v) => set("ipRestriction", v)} />
            </div>
            <div className="space-y-2">
              <Label className="text-slate-300">Oturum Süresi (dakika)</Label>
              <Input
                type="number"
                min={5}
                max={1440}
                value={form.sessionTimeoutMinutes}
                onChange={(e) => set("sessionTimeoutMinutes", Number(e.target.value))}
                className="bg-slate-800/50 border-slate-700 text-white"
              />
            </div>
          </CardContent>
        </Card>

        {/* Bildirimler */}
        <Card className="bg-slate-900/50 border-slate-800 lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2">
              <Bell className="h-5 w-5 text-yellow-400" />
              Bildirimler
            </CardTitle>
            <CardDescription className="text-slate-500">Bildirim ve uyarı ayarları</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-6 sm:grid-cols-3">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-slate-300">Email Bildirimleri</Label>
                <p className="text-xs text-slate-500">Kritik olaylar için</p>
              </div>
              <Switch
                checked={form.emailNotifications}
                onCheckedChange={(v) => set("emailNotifications", v)}
              />
            </div>
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-slate-300">Yeni Firma Bildirimi</Label>
                <p className="text-xs text-slate-500">Yeni firma kaydında bildir</p>
              </div>
              <Switch
                checked={form.newCompanyNotification}
                onCheckedChange={(v) => set("newCompanyNotification", v)}
              />
            </div>
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-slate-300">Hata Bildirimleri</Label>
                <p className="text-xs text-slate-500">Sistem hatalarında bildir</p>
              </div>
              <Switch
                checked={form.errorNotification}
                onCheckedChange={(v) => set("errorNotification", v)}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex justify-end">
        <Button
          onClick={handleSave}
          disabled={saving || !dirty}
          className="bg-blue-600 hover:bg-blue-700"
        >
          {saving ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Save className="h-4 w-4 mr-2" />
          )}
          {saving ? "Kaydediliyor..." : "Ayarları Kaydet"}
        </Button>
      </div>
    </div>
  )
}
