"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Users, Trash2, Loader2 } from "lucide-react"
import { useToast } from "@/components/ui/use-toast"
import { useConfirm } from "@/components/ui/confirm-dialog-provider"
import { Role } from "@prisma/client"
import { roleLabels } from "@/lib/auth/role-labels"

type Member = {
  role: Role
  user: { id: string; name: string | null; email: string; isSuperAdmin: boolean }
}

type UserOption = { id: string; name: string | null; email: string }

export function CompanyUsersCard({
  companyId,
  members,
  allUsers,
}: {
  companyId: string
  members: Member[]
  allUsers: UserOption[]
}) {
  const router = useRouter()
  const { toast } = useToast()
  const { confirm } = useConfirm()

  const [addUserId, setAddUserId] = useState("")
  const [addRole, setAddRole] = useState<Role>(Role.VIEWER)
  const [busy, setBusy] = useState(false)

  const memberIds = new Set(members.map((m) => m.user.id))
  const availableUsers = allUsers.filter((u) => !memberIds.has(u.id))

  const handleAdd = async () => {
    if (!addUserId) return
    setBusy(true)
    try {
      const response = await fetch(`/api/system-admin/users/${addUserId}/companies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, role: addRole }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || "İşlem başarısız")
      toast({ title: "Başarılı", description: "Kullanıcı firmaya eklendi" })
      setAddUserId("")
      setAddRole(Role.VIEWER)
      router.refresh()
    } catch (error) {
      toast({
        title: "Hata",
        description: error instanceof Error ? error.message : "Kullanıcı eklenirken bir hata oluştu",
        variant: "destructive",
      })
    } finally {
      setBusy(false)
    }
  }

  const handleUpdateRole = async (userId: string, role: Role) => {
    setBusy(true)
    try {
      const response = await fetch(`/api/system-admin/users/${userId}/companies/${companyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || "İşlem başarısız")
      toast({ title: "Başarılı", description: "Rol güncellendi" })
      router.refresh()
    } catch (error) {
      toast({
        title: "Hata",
        description: error instanceof Error ? error.message : "Rol güncellenirken bir hata oluştu",
        variant: "destructive",
      })
    } finally {
      setBusy(false)
    }
  }

  const handleRemove = async (userId: string, label: string) => {
    if (
      !(await confirm({
        title: "Kullanıcıyı çıkar",
        description: `"${label}" kullanıcısını bu firmadan çıkarmak istediğinize emin misiniz?`,
        confirmLabel: "Çıkar",
        variant: "destructive",
      }))
    ) {
      return
    }
    setBusy(true)
    try {
      const response = await fetch(`/api/system-admin/users/${userId}/companies/${companyId}`, {
        method: "DELETE",
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || "İşlem başarısız")
      toast({ title: "Başarılı", description: "Kullanıcı firmadan çıkarıldı" })
      router.refresh()
    } catch (error) {
      toast({
        title: "Hata",
        description: error instanceof Error ? error.message : "Kullanıcı çıkarılırken bir hata oluştu",
        variant: "destructive",
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="bg-slate-900/50 border-slate-800">
      <CardHeader>
        <CardTitle className="text-white flex items-center gap-2">
          <Users className="h-5 w-5 text-emerald-400" />
          Kullanıcılar ({members.length})
        </CardTitle>
        <CardDescription className="text-slate-500">
          Bu firmaya bağlı kullanıcılar ve rolleri
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {members.length === 0 ? (
          <div className="text-center py-6 text-slate-500">Bağlı kullanıcı yok</div>
        ) : (
          <div className="space-y-3">
            {members.map((uc) => (
              <div
                key={uc.user.id}
                className="flex items-center justify-between gap-2 p-3 rounded-lg bg-slate-800/50"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 shrink-0 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-400 font-medium">
                    {uc.user.name?.charAt(0) || uc.user.email.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium text-white truncate">{uc.user.name || "İsimsiz"}</p>
                    <p className="text-xs text-slate-500 truncate">{uc.user.email}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <select
                    value={uc.role}
                    disabled={busy}
                    onChange={(e) => handleUpdateRole(uc.user.id, e.target.value as Role)}
                    className="h-8 rounded-md bg-slate-800 border border-slate-700 text-white text-xs px-2"
                  >
                    {Object.values(Role).map((r) => (
                      <option key={r} value={r}>
                        {roleLabels[r]}
                      </option>
                    ))}
                  </select>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={busy}
                    onClick={() => handleRemove(uc.user.id, uc.user.name || uc.user.email)}
                    className="h-8 w-8 text-red-400 hover:text-red-300 hover:bg-red-500/10"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Kullanıcı ekle */}
        <div className="rounded-lg border border-slate-800 bg-slate-800/20 p-3 space-y-2">
          <Label className="text-slate-300 text-sm">Kullanıcı ekle</Label>
          {availableUsers.length === 0 ? (
            <p className="text-xs text-slate-500">Eklenebilecek başka kullanıcı yok.</p>
          ) : (
            <div className="flex flex-col sm:flex-row gap-2">
              <select
                value={addUserId}
                disabled={busy}
                onChange={(e) => setAddUserId(e.target.value)}
                className="flex-1 h-9 rounded-md bg-slate-800 border border-slate-700 text-white text-sm px-2"
              >
                <option value="">Kullanıcı seç…</option>
                {availableUsers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name ? `${u.name} — ${u.email}` : u.email}
                  </option>
                ))}
              </select>
              <select
                value={addRole}
                disabled={busy}
                onChange={(e) => setAddRole(e.target.value as Role)}
                className="h-9 rounded-md bg-slate-800 border border-slate-700 text-white text-sm px-2"
              >
                {Object.values(Role).map((r) => (
                  <option key={r} value={r}>
                    {roleLabels[r]}
                  </option>
                ))}
              </select>
              <Button
                onClick={handleAdd}
                disabled={busy || !addUserId}
                className="bg-emerald-600 hover:bg-emerald-700 shrink-0"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Ekle"}
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
