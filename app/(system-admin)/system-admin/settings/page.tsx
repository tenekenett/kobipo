import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Settings, Server, Database, Shield, Bell } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"

export const dynamic = "force-dynamic"

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-white flex items-center gap-3">
          <Settings className="h-8 w-8 text-orange-400" />
          Sistem Ayarları
        </h1>
        <p className="text-slate-400 mt-1">
          Platform geneli yapılandırma ayarları
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* General Settings */}
        <Card className="bg-slate-900/50 border-slate-800">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2">
              <Server className="h-5 w-5 text-blue-400" />
              Genel Ayarlar
            </CardTitle>
            <CardDescription className="text-slate-500">
              Temel platform ayarları
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label className="text-slate-300">Platform Adı</Label>
              <Input 
                defaultValue="Muhasebe SaaS" 
                className="bg-slate-800/50 border-slate-700 text-white"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-slate-300">Destek Email</Label>
              <Input 
                type="email"
                defaultValue="destek@muhasebe.com" 
                className="bg-slate-800/50 border-slate-700 text-white"
              />
            </div>
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-slate-300">Bakım Modu</Label>
                <p className="text-xs text-slate-500">Platformu bakım moduna al</p>
              </div>
              <Switch />
            </div>
          </CardContent>
        </Card>

        {/* Security Settings */}
        <Card className="bg-slate-900/50 border-slate-800">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2">
              <Shield className="h-5 w-5 text-red-400" />
              Güvenlik
            </CardTitle>
            <CardDescription className="text-slate-500">
              Güvenlik ve erişim ayarları
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-slate-300">2FA Zorunlu</Label>
                <p className="text-xs text-slate-500">Tüm admin kullanıcılar için</p>
              </div>
              <Switch />
            </div>
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-slate-300">IP Kısıtlaması</Label>
                <p className="text-xs text-slate-500">Super admin için IP kontrolü</p>
              </div>
              <Switch />
            </div>
            <div className="space-y-2">
              <Label className="text-slate-300">Oturum Süresi (dakika)</Label>
              <Input 
                type="number"
                defaultValue="60" 
                className="bg-slate-800/50 border-slate-700 text-white"
              />
            </div>
          </CardContent>
        </Card>

        {/* Database Settings */}
        <Card className="bg-slate-900/50 border-slate-800">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2">
              <Database className="h-5 w-5 text-green-400" />
              Veritabanı
            </CardTitle>
            <CardDescription className="text-slate-500">
              Veritabanı durumu ve yönetimi
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between p-3 rounded-lg bg-slate-800/50">
              <span className="text-slate-300">Bağlantı Durumu</span>
              <span className="flex items-center gap-2 text-green-400">
                <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                Bağlı
              </span>
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg bg-slate-800/50">
              <span className="text-slate-300">Veritabanı Boyutu</span>
              <span className="text-slate-400">~0 MB</span>
            </div>
            <Button variant="outline" className="w-full border-slate-700 text-slate-300 hover:bg-slate-800">
              Yedek Al
            </Button>
          </CardContent>
        </Card>

        {/* Notification Settings */}
        <Card className="bg-slate-900/50 border-slate-800">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2">
              <Bell className="h-5 w-5 text-yellow-400" />
              Bildirimler
            </CardTitle>
            <CardDescription className="text-slate-500">
              Bildirim ve uyarı ayarları
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-slate-300">Email Bildirimleri</Label>
                <p className="text-xs text-slate-500">Kritik olaylar için</p>
              </div>
              <Switch defaultChecked />
            </div>
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-slate-300">Yeni Firma Bildirimi</Label>
                <p className="text-xs text-slate-500">Yeni firma kaydında bildir</p>
              </div>
              <Switch defaultChecked />
            </div>
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-slate-300">Hata Bildirimleri</Label>
                <p className="text-xs text-slate-500">Sistem hatalarında bildir</p>
              </div>
              <Switch defaultChecked />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Save Button */}
      <div className="flex justify-end">
        <Button className="bg-orange-600 hover:bg-orange-700">
          Ayarları Kaydet
        </Button>
      </div>
    </div>
  )
}

