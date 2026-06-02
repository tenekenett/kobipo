"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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

const emptyForm = {
  name: "",
  taxNumber: "",
  taxOffice: "",
  city: "",
  phone: "",
  email: "",
  address: "",
}

export function CreateCompanyButton() {
  const router = useRouter()
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast({ title: "Hata", description: "Firma adı zorunludur", variant: "destructive" })
      return
    }
    setSaving(true)
    try {
      const response = await fetch("/api/system-admin/companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      })
      const data = await response.json().catch(() => ({}))
      if (response.ok) {
        toast({ title: "Başarılı", description: `"${form.name}" firması oluşturuldu` })
        setForm(emptyForm)
        setOpen(false)
        router.refresh()
      } else {
        throw new Error(data.error || "İşlem başarısız")
      }
    } catch (error) {
      toast({
        title: "Hata",
        description: error instanceof Error ? error.message : "Firma oluşturulurken bir hata oluştu",
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
        <Button className="bg-blue-600 hover:bg-blue-700">
          <Plus className="h-4 w-4 mr-2" />
          Yeni Firma
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg bg-slate-900 border-slate-800 text-slate-100">
        <DialogHeader>
          <DialogTitle className="text-white">Yeni Firma</DialogTitle>
          <DialogDescription className="text-slate-500">
            Sadece firma adı zorunlu — diğer alanları sonra da güncelleyebilirsiniz.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2 space-y-1">
            <Label className="text-slate-300">Firma Adı *</Label>
            <Input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="bg-slate-800/50 border-slate-700 text-white"
              autoFocus
            />
          </div>
          <div className="space-y-1">
            <Label className="text-slate-300">Vergi No</Label>
            <Input
              value={form.taxNumber}
              onChange={(e) => setForm((f) => ({ ...f, taxNumber: e.target.value }))}
              className="bg-slate-800/50 border-slate-700 text-white"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-slate-300">Vergi Dairesi</Label>
            <Input
              value={form.taxOffice}
              onChange={(e) => setForm((f) => ({ ...f, taxOffice: e.target.value }))}
              className="bg-slate-800/50 border-slate-700 text-white"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-slate-300">Şehir</Label>
            <Input
              value={form.city}
              onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
              className="bg-slate-800/50 border-slate-700 text-white"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-slate-300">Telefon</Label>
            <Input
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              className="bg-slate-800/50 border-slate-700 text-white"
            />
          </div>
          <div className="sm:col-span-2 space-y-1">
            <Label className="text-slate-300">E-posta</Label>
            <Input
              type="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              className="bg-slate-800/50 border-slate-700 text-white"
            />
          </div>
          <div className="sm:col-span-2 space-y-1">
            <Label className="text-slate-300">Adres</Label>
            <Input
              value={form.address}
              onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
              className="bg-slate-800/50 border-slate-700 text-white"
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
          <Button onClick={handleSave} disabled={saving || !form.name.trim()} className="bg-blue-600 hover:bg-blue-700">
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
