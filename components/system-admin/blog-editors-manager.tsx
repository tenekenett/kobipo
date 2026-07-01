"use client"

import { useState } from "react"
import { Newspaper, Plus, KeyRound, Trash2, ShieldOff, Loader2, ExternalLink } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent } from "@/components/ui/card"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { useToast } from "@/components/ui/use-toast"

interface Editor {
  id: string
  name: string | null
  email: string
  isSuperAdmin: boolean
  createdAt: string
}

export function BlogEditorsManager({ initialEditors }: { initialEditors: Editor[] }) {
  const { toast } = useToast()
  const [editors, setEditors] = useState<Editor[]>(initialEditors)
  const [showForm, setShowForm] = useState(false)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({ name: "", email: "", password: "" })
  const [busyId, setBusyId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Editor | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  const refresh = async () => {
    const res = await fetch("/api/system-admin/blog-editors")
    if (res.ok) setEditors(await res.json())
  }

  const create = async () => {
    setCreating(true)
    try {
      const res = await fetch("/api/system-admin/blog-editors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Oluşturulamadı")
      toast({ title: "Blog editörü oluşturuldu", description: data.email })
      setForm({ name: "", email: "", password: "" })
      setShowForm(false)
      refresh()
    } catch (e: unknown) {
      toast({
        title: "Oluşturulamadı",
        description: e instanceof Error ? e.message : "Bilinmeyen hata",
        variant: "destructive",
      })
    } finally {
      setCreating(false)
    }
  }

  const resetPassword = async (ed: Editor) => {
    const password = window.prompt(`${ed.email} için yeni şifre (en az 8 karakter):`)
    if (!password) return
    setBusyId(ed.id)
    try {
      const res = await fetch(`/api/system-admin/blog-editors/${ed.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Sıfırlanamadı")
      toast({ title: "Şifre güncellendi", description: ed.email })
    } catch (e: unknown) {
      toast({
        title: "Şifre sıfırlanamadı",
        description: e instanceof Error ? e.message : "Bilinmeyen hata",
        variant: "destructive",
      })
    } finally {
      setBusyId(null)
    }
  }

  const revoke = async (ed: Editor) => {
    setBusyId(ed.id)
    try {
      const res = await fetch(`/api/system-admin/blog-editors/${ed.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isBlogEditor: false }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Kaldırılamadı")
      toast({ title: "Yetki kaldırıldı", description: ed.email })
      setEditors((prev) => prev.filter((e) => e.id !== ed.id))
    } catch (e: unknown) {
      toast({
        title: "İşlem başarısız",
        description: e instanceof Error ? e.message : "Bilinmeyen hata",
        variant: "destructive",
      })
    } finally {
      setBusyId(null)
    }
  }

  const doDelete = async () => {
    if (!deleteTarget) return
    setIsDeleting(true)
    try {
      const res = await fetch(`/api/system-admin/blog-editors/${deleteTarget.id}`, {
        method: "DELETE",
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Silinemedi")
      toast({ title: "Hesap silindi", description: deleteTarget.email })
      setEditors((prev) => prev.filter((e) => e.id !== deleteTarget.id))
      setDeleteTarget(null)
    } catch (e: unknown) {
      toast({
        title: "Silinemedi",
        description: e instanceof Error ? e.message : "Bilinmeyen hata",
        variant: "destructive",
      })
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-3 text-3xl font-bold text-white">
            <Newspaper className="h-8 w-8 text-emerald-400" />
            Blog Editörleri
          </h1>
          <p className="mt-1 text-slate-400">
            Yalnız <span className="font-mono">/blog-admin</span> panelini yönetebilen platform hesapları.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" asChild>
            <a href="/blog-admin" target="_blank" rel="noreferrer">
              <ExternalLink className="mr-2 h-4 w-4" />
              Blog panelini aç
            </a>
          </Button>
          <Button onClick={() => setShowForm((v) => !v)}>
            <Plus className="mr-2 h-4 w-4" />
            Yeni editör
          </Button>
        </div>
      </div>

      {showForm && (
        <Card className="border-slate-800 bg-slate-900/50">
          <CardContent className="grid grid-cols-1 gap-4 pt-6 md:grid-cols-3">
            <div className="space-y-2">
              <Label className="text-slate-300">Ad Soyad</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Editör adı"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-slate-300">E-posta</Label>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="editor@ornek.com"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-slate-300">Şifre (min 8)</Label>
              <Input
                type="text"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder="Güçlü bir şifre"
              />
            </div>
            <div className="flex justify-end gap-2 md:col-span-3">
              <Button variant="outline" onClick={() => setShowForm(false)}>
                Vazgeç
              </Button>
              <Button onClick={create} disabled={creating}>
                {creating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Oluştur
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="border-slate-800 bg-slate-900/50">
        <CardContent className="p-0">
          {editors.length === 0 ? (
            <div className="py-16 text-center text-slate-400">Henüz blog editörü yok.</div>
          ) : (
            <div className="divide-y divide-slate-800">
              {editors.map((ed) => (
                <div key={ed.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div>
                    <div className="font-medium text-white">
                      {ed.name || "İsimsiz"}
                      {ed.isSuperAdmin && (
                        <span className="ml-2 rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">
                          Süper Admin
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-slate-400">{ed.email}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busyId === ed.id}
                      onClick={() => resetPassword(ed)}
                    >
                      <KeyRound className="mr-1.5 h-3.5 w-3.5" />
                      Şifre sıfırla
                    </Button>
                    {!ed.isSuperAdmin && (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busyId === ed.id}
                          onClick={() => revoke(ed)}
                          title="Blog yetkisini kaldır (hesap kalır)"
                        >
                          <ShieldOff className="mr-1.5 h-3.5 w-3.5" />
                          Yetkiyi kaldır
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busyId === ed.id}
                          onClick={() => setDeleteTarget(ed)}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-red-500" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Hesabı sil"
        description={`"${deleteTarget?.email}" blog editörü hesabı kalıcı olarak silinecek.`}
        confirmLabel="Sil"
        variant="destructive"
        isProcessing={isDeleting}
        onConfirm={doDelete}
      />
    </div>
  )
}
