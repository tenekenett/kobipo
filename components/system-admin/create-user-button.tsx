"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { useToast } from "@/components/ui/use-toast"
import { Plus, Loader2 } from "lucide-react"
import { Role } from "@prisma/client"
import { roleLabels } from "@/lib/auth/role-labels"

type CompanyOption = { id: string; name: string; isActive: boolean }

const emptyForm: { name: string; email: string; password: string; isSuperAdmin: boolean; companyId: string; role: Role } = {
  name: "",
  email: "",
  password: "",
  isSuperAdmin: false,
  companyId: "",
  role: Role.VIEWER,
}

export function CreateUserButton({ companies }: { companies: CompanyOption[] }) {
  const router = useRouter()
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    if (!form.email.trim()) {
      toast({ title: "Hata", description: "E-posta zorunludur", variant: "destructive" })
      return
    }
    setSaving(true)
    try {
      const response = await fetch("/api/system-admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      })
      const data = await response.json().catch(() => ({}))
      if (response.ok) {
        toast({
          title: "Kullanıcı oluşturuldu",
          description: data.tempPassword
            ? `Geçici şifre: ${data.tempPassword} — kullanıcıya iletin.`
            : "Kullanıcı belirlenen şifreyle oluşturuldu.",
        })
        setForm(emptyForm)
        setOpen(false)
        router.refresh()
      } else {
        throw new Error(data.error || "İşlem başarısız")
      }
    } catch (error) {
      toast({
        title: "Hata",
        description: error instanceof Error ? error.message : "Kullanıcı oluşturulurken bir hata oluştu",
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) setForm(emptyForm)
      }}
    >
      <DialogTrigger asChild>
        <Button className="bg-emerald-600 hover:bg-emerald-700">
          <Plus className="h-4 w-4 mr-2" />
          Yeni Kullanıcı
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md bg-slate-900 border-slate-800 text-slate-100">
        <DialogHeader>
          <DialogTitle className="text-white">Yeni Kullanıcı</DialogTitle>
          <DialogDescription className="text-slate-500">
            Şifre boş bırakılırsa otomatik geçici şifre üretilir.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label className="text-slate-300">Ad Soyad</Label>
            <Input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="bg-slate-800/50 border-slate-700 text-white"
              autoFocus
            />
          </div>
          <div className="space-y-1">
            <Label className="text-slate-300">E-posta *</Label>
            <Input
              type="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              className="bg-slate-800/50 border-slate-700 text-white"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-slate-300">Şifre (opsiyonel)</Label>
            <Input
              type="text"
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              placeholder="Boş bırakılırsa otomatik üretilir"
              className="bg-slate-800/50 border-slate-700 text-white"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-slate-300">Firma (opsiyonel)</Label>
            <select
              value={form.companyId}
              onChange={(e) => setForm((f) => ({ ...f, companyId: e.target.value }))}
              className="w-full h-10 rounded-md bg-slate-800/50 border border-slate-700 text-white text-sm px-3"
            >
              <option value="">Bağlama (sonra atanabilir)</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}{c.isActive ? "" : " (pasif)"}
                </option>
              ))}
            </select>
          </div>
          {form.companyId && (
            <div className="space-y-1">
              <Label className="text-slate-300">Rol</Label>
              <select
                value={form.role}
                onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as Role }))}
                className="w-full h-10 rounded-md bg-slate-800/50 border border-slate-700 text-white text-sm px-3"
              >
                {Object.values(Role).map((r) => (
                  <option key={r} value={r}>
                    {roleLabels[r]}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-800/30 p-3">
            <div className="space-y-0.5">
              <Label className="text-slate-300">Sistem Yöneticisi</Label>
              <p className="text-xs text-slate-500">Super admin yetkisi ver</p>
            </div>
            <Switch
              checked={form.isSuperAdmin}
              onCheckedChange={(checked) => setForm((f) => ({ ...f, isSuperAdmin: checked }))}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={saving}
            className="border-slate-700 text-slate-300 hover:bg-slate-800"
          >
            İptal
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving || !form.email.trim()}
            className="bg-emerald-600 hover:bg-emerald-700"
          >
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Kaydediliyor
              </>
            ) : (
              "Oluştur"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
