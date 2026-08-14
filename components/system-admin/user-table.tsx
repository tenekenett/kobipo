"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { companyDisplayName } from "@/lib/company/display-name"
import { Switch } from "@/components/ui/switch"
import { Search, MoreVertical, Shield, Key, Edit, Trash2, Building2, Loader2 } from "lucide-react"
import { useToast } from "@/components/ui/use-toast"
import { useConfirm } from "@/components/ui/confirm-dialog-provider"
import { useRouter } from "next/navigation"
import { Role } from "@prisma/client"
import { roleLabels } from "@/lib/auth/role-labels"

interface User {
  id: string
  name: string | null
  email: string
  isSuperAdmin: boolean
  createdAt: Date
  companies: {
    role: Role
    company: {
      id: string
      name: string
      /** Ünvandan ayrı kısa şube adı — listelerde ayırt edici olan bu. */
      branchName: string | null
      isActive: boolean
    }
  }[]
}

interface CompanyOption {
  id: string
  name: string
  branchName: string | null
  isActive: boolean
}

interface UserTableProps {
  users: User[]
  companies: CompanyOption[]
}

const roleColors: Record<Role, string> = {
  ADMIN: "bg-purple-500/20 text-purple-400",
  BRANCH_MANAGER: "bg-teal-500/20 text-teal-400",
  ACCOUNTANT: "bg-blue-500/20 text-blue-400",
  STOCK: "bg-orange-500/20 text-orange-400",
  SALES: "bg-green-500/20 text-green-400",
  VIEWER: "bg-slate-500/20 text-slate-400",
  CUSTOM: "bg-indigo-500/20 text-indigo-400",
}

export function UserTable({ users, companies }: UserTableProps) {
  const [searchTerm, setSearchTerm] = useState("")
  const { toast } = useToast()
  const { confirm } = useConfirm()
  const router = useRouter()

  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState({ name: "", email: "", isSuperAdmin: false })
  const [saving, setSaving] = useState(false)

  // Firma üyeliği yönetimi
  const [managingUser, setManagingUser] = useState<User | null>(null)
  const [addCompanyId, setAddCompanyId] = useState("")
  const [addRole, setAddRole] = useState<Role>(Role.VIEWER)
  const [membershipBusy, setMembershipBusy] = useState(false)

  const handleAddCompany = async () => {
    if (!managingUser || !addCompanyId) return
    setMembershipBusy(true)
    try {
      const response = await fetch(`/api/system-admin/users/${managingUser.id}/companies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId: addCompanyId, role: addRole }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || "İşlem başarısız")
      toast({ title: "Başarılı", description: "Kullanıcı firmaya eklendi" })
      setAddCompanyId("")
      setAddRole(Role.VIEWER)
      setManagingUser(null)
      router.refresh()
    } catch (error) {
      toast({
        title: "Hata",
        description: error instanceof Error ? error.message : "Firma eklenirken bir hata oluştu",
        variant: "destructive",
      })
    } finally {
      setMembershipBusy(false)
    }
  }

  const handleUpdateRole = async (userId: string, companyId: string, role: Role) => {
    setMembershipBusy(true)
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
      setMembershipBusy(false)
    }
  }

  const handleRemoveCompany = async (userId: string, companyId: string, companyName: string) => {
    if (
      !(await confirm({
        title: "Firma bağlantısını kaldır",
        description: `Kullanıcıyı "${companyName}" firmasından çıkarmak istediğinize emin misiniz?`,
        confirmLabel: "Kaldır",
        variant: "destructive",
      }))
    ) {
      return
    }
    setMembershipBusy(true)
    try {
      const response = await fetch(`/api/system-admin/users/${userId}/companies/${companyId}`, {
        method: "DELETE",
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || "İşlem başarısız")
      toast({ title: "Başarılı", description: "Firma bağlantısı kaldırıldı" })
      setManagingUser(null)
      router.refresh()
    } catch (error) {
      toast({
        title: "Hata",
        description: error instanceof Error ? error.message : "Bağlantı kaldırılırken bir hata oluştu",
        variant: "destructive",
      })
    } finally {
      setMembershipBusy(false)
    }
  }

  const openEdit = (user: User) => {
    setEditingId(user.id)
    setForm({ name: user.name ?? "", email: user.email, isSuperAdmin: user.isSuperAdmin })
  }

  const handleSave = async () => {
    if (!editingId) return
    if (!form.email.trim()) {
      toast({ title: "Hata", description: "E-posta zorunludur", variant: "destructive" })
      return
    }
    setSaving(true)
    try {
      const response = await fetch(`/api/system-admin/users/${editingId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      })
      const data = await response.json().catch(() => ({}))
      if (response.ok) {
        toast({ title: "Başarılı", description: "Kullanıcı bilgileri güncellendi" })
        setEditingId(null)
        router.refresh()
      } else {
        throw new Error(data.error || "İşlem başarısız")
      }
    } catch (error) {
      toast({
        title: "Hata",
        description: error instanceof Error ? error.message : "Kullanıcı güncellenirken bir hata oluştu",
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  // Dialog açıkken taze users listesinden güncel kaydı türet (refresh sonrası senkron).
  const managing = managingUser ? users.find((u) => u.id === managingUser.id) ?? managingUser : null
  const assignedIds = new Set(managing?.companies.map((uc) => uc.company.id) ?? [])
  const availableCompanies = companies.filter((c) => !assignedIds.has(c.id))

  const filteredUsers = users.filter(user =>
    user.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    user.email.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const handleResetPassword = async (userId: string, userEmail: string) => {
    if (!(await confirm({ title: "Şifre sıfırla", description: `"${userEmail}" kullanıcısının şifresini sıfırlamak istiyor musunuz?`, confirmLabel: "Sıfırla" }))) {
      return
    }
    try {
      const response = await fetch(`/api/system-admin/users/${userId}/reset-password`, {
        method: "POST",
      })

      const data = await response.json().catch(() => ({}))
      if (response.ok) {
        // E-posta servisi bağlı olmadığından geçici şifre yöneticiye gösterilir.
        toast({
          title: "Şifre sıfırlandı",
          description: data.tempPassword
            ? `Geçici şifre: ${data.tempPassword} — kullanıcıya iletin.`
            : "Geçici şifre oluşturuldu.",
        })
      } else {
        throw new Error(data.error || "İşlem başarısız")
      }
    } catch (error) {
      toast({
        title: "Hata",
        description: error instanceof Error ? error.message : "Şifre sıfırlanırken bir hata oluştu",
        variant: "destructive",
      })
    }
  }

  const handleDelete = async (userId: string, userEmail: string) => {
    if (
      !(await confirm({
        title: "Kullanıcıyı sil",
        description: `"${userEmail}" kullanıcısını kalıcı olarak silmek istediğinize emin misiniz? Bu işlem geri alınamaz.`,
        confirmLabel: "Sil",
        variant: "destructive",
      }))
    ) {
      return
    }
    try {
      const response = await fetch(`/api/system-admin/users/${userId}`, {
        method: "DELETE",
      })
      if (response.ok) {
        toast({ title: "Başarılı", description: `"${userEmail}" kullanıcısı silindi` })
        router.refresh()
      } else {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || "İşlem başarısız")
      }
    } catch (error) {
      toast({
        title: "Hata",
        description: error instanceof Error ? error.message : "Kullanıcı silinirken bir hata oluştu",
        variant: "destructive",
      })
    }
  }

  const handleToggleSuperAdmin = async (userId: string, currentStatus: boolean) => {
    try {
      const response = await fetch(`/api/system-admin/users/${userId}/toggle-super-admin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isSuperAdmin: !currentStatus })
      })

      if (response.ok) {
        toast({
          title: "Başarılı",
          description: `Kullanıcı ${currentStatus ? "normal kullanıcı" : "sistem yöneticisi"} yapıldı`,
        })
        router.refresh()
      } else {
        throw new Error("İşlem başarısız")
      }
    } catch (error) {
      toast({
        title: "Hata",
        description: "Kullanıcı yetkisi güncellenirken bir hata oluştu",
        variant: "destructive",
      })
    }
  }

  return (
    <div className="space-y-4">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
        <Input
          placeholder="İsim veya email ara..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="pl-10 bg-slate-800/50 border-slate-700 text-white placeholder:text-slate-500"
        />
      </div>

      {/* Table */}
      <div className="rounded-lg border border-slate-800 overflow-x-auto max-md:[&_tr>*:first-child]:sticky max-md:[&_tr>*:first-child]:left-0 max-md:[&_tr>*:first-child]:z-20 max-md:[&_tr>*:first-child]:bg-slate-900">
        <Table>
          <TableHeader>
            <TableRow className="border-slate-800 hover:bg-slate-800/50">
              <TableHead className="text-slate-400">Kullanıcı</TableHead>
              <TableHead className="text-slate-400">Email</TableHead>
              <TableHead className="text-slate-400">Firmalar</TableHead>
              <TableHead className="text-slate-400">Yetki</TableHead>
              <TableHead className="text-slate-400">Kayıt Tarihi</TableHead>
              <TableHead className="text-slate-400 text-right">İşlemler</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredUsers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-slate-500">
                  {searchTerm ? "Arama sonucu bulunamadı" : "Henüz kullanıcı kaydı yok"}
                </TableCell>
              </TableRow>
            ) : (
              filteredUsers.map((user) => (
                <TableRow key={user.id} className="border-slate-800 hover:bg-slate-800/50">
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center font-medium ${
                        user.isSuperAdmin 
                          ? "bg-gradient-to-br from-red-500 to-orange-500 text-white"
                          : "bg-slate-700 text-slate-300"
                      }`}>
                        {user.name?.charAt(0) || user.email.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p className="font-medium text-white">{user.name || "İsimsiz"}</p>
                        {user.isSuperAdmin && (
                          <span className="text-xs text-red-400 flex items-center gap-1">
                            <Shield className="h-3 w-3" />
                            Sistem Yöneticisi
                          </span>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-slate-300">
                    {user.email}
                  </TableCell>
                  <TableCell>
                    {user.companies.length === 0 ? (
                      <span className="text-slate-500">-</span>
                    ) : (
                      <div className="space-y-1">
                        {user.companies.slice(0, 2).map((uc) => (
                          <div key={uc.company.id} className="flex items-center gap-2">
                            <Building2 className="h-3 w-3 shrink-0 text-slate-500" />
                            <span className="text-sm text-slate-300">{uc.company.name}</span>
                            {uc.company.branchName && (
                              <span className="shrink-0 rounded bg-slate-700/60 px-1.5 py-0.5 text-xs text-slate-300">
                                {uc.company.branchName}
                              </span>
                            )}
                            <span className={`text-xs px-1.5 py-0.5 rounded ${roleColors[uc.role]}`}>
                              {roleLabels[uc.role]}
                            </span>
                          </div>
                        ))}
                        {user.companies.length > 2 && (
                          <span className="text-xs text-slate-500">
                            +{user.companies.length - 2} firma daha
                          </span>
                        )}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    {user.isSuperAdmin ? (
                      <span className="px-2 py-1 rounded-full text-xs font-medium bg-red-500/20 text-red-400">
                        Super Admin
                      </span>
                    ) : (
                      <span className="px-2 py-1 rounded-full text-xs font-medium bg-slate-500/20 text-slate-400">
                        Kullanıcı
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-slate-500">
                    {new Date(user.createdAt).toLocaleDateString("tr-TR")}
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="text-slate-400 hover:text-white">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="bg-slate-900 border-slate-800">
                        <DropdownMenuLabel className="text-slate-400">İşlemler</DropdownMenuLabel>
                        <DropdownMenuSeparator className="bg-slate-800" />
                        <DropdownMenuItem
                          className="text-slate-300 focus:bg-slate-800 focus:text-white"
                          onClick={() => openEdit(user)}
                        >
                          <Edit className="h-4 w-4 mr-2" />
                          Düzenle
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-slate-300 focus:bg-slate-800 focus:text-white"
                          onClick={() => {
                            setManagingUser(user)
                            setAddCompanyId("")
                            setAddRole(Role.VIEWER)
                          }}
                        >
                          <Building2 className="h-4 w-4 mr-2" />
                          Firmaları Yönet
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-slate-300 focus:bg-slate-800 focus:text-white"
                          onClick={() => handleResetPassword(user.id, user.email)}
                        >
                          <Key className="h-4 w-4 mr-2" />
                          Şifre Sıfırla
                        </DropdownMenuItem>
                        <DropdownMenuItem 
                          className="text-slate-300 focus:bg-slate-800 focus:text-white"
                          onClick={() => handleToggleSuperAdmin(user.id, user.isSuperAdmin)}
                        >
                          <Shield className="h-4 w-4 mr-2" />
                          {user.isSuperAdmin ? "Super Admin Kaldır" : "Super Admin Yap"}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator className="bg-slate-800" />
                        <DropdownMenuItem
                          className="text-red-400 focus:bg-red-500/20 focus:text-red-400"
                          onClick={() => handleDelete(user.id, user.email)}
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Sil
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination info */}
      <div className="text-sm text-slate-500">
        Toplam {filteredUsers.length} kullanıcı gösteriliyor
      </div>

      {/* Düzenleme Dialog'u */}
      <Dialog open={editingId !== null} onOpenChange={(open) => !open && setEditingId(null)}>
        <DialogContent className="sm:max-w-md bg-slate-900 border-slate-800 text-slate-100">
          <DialogHeader>
            <DialogTitle className="text-white">Kullanıcı Düzenle</DialogTitle>
            <DialogDescription className="text-slate-500">
              Kullanıcı bilgilerini güncelleyin
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label className="text-slate-300">Ad Soyad</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="bg-slate-800/50 border-slate-700 text-white"
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
            <div className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-800/30 p-3">
              <div className="space-y-0.5">
                <Label className="text-slate-300">Sistem Yöneticisi</Label>
                <p className="text-xs text-slate-500">Super admin yetkisi</p>
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
              onClick={() => setEditingId(null)}
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
                "Kaydet"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Firma üyeliği yönetim dialog'u */}
      <Dialog open={managing !== null} onOpenChange={(open) => !open && setManagingUser(null)}>
        {/* Ünvanlar uzun (şube adıyla birlikte 100+ karakter) → max-w-lg dar kalıyordu. */}
        <DialogContent className="sm:max-w-2xl bg-slate-900 border-slate-800 text-slate-100">
          <DialogHeader>
            <DialogTitle className="text-white">Firma Bağlantıları</DialogTitle>
            <DialogDescription className="text-slate-500">
              {managing?.name || managing?.email} kullanıcısının bağlı olduğu firmalar ve rolleri
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Mevcut üyelikler */}
            <div className="space-y-2">
              {!managing || managing.companies.length === 0 ? (
                <p className="text-sm text-slate-500 py-2">Henüz bir firmaya bağlı değil.</p>
              ) : (
                managing.companies.map((uc) => (
                  <div
                    key={uc.company.id}
                    className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-800/40 p-2.5"
                  >
                    <Building2 className="h-4 w-4 shrink-0 text-slate-500" />
                    {/* Şube adı AYRI rozette: ünvanın sonuna eklenseydi dar alanda ilk
                        kırpılan o olurdu — yani ayırt edici bilgi kaybolurdu. */}
                    <span className="flex min-w-0 flex-1 items-center gap-1.5 text-sm text-slate-200">
                      <span className="min-w-0 truncate">{uc.company.name}</span>
                      {uc.company.branchName && (
                        <span className="shrink-0 rounded bg-slate-700/60 px-1.5 py-0.5 text-xs text-slate-300">
                          {uc.company.branchName}
                        </span>
                      )}
                      {!uc.company.isActive && (
                        <span className="shrink-0 text-slate-500">(pasif)</span>
                      )}
                    </span>
                    <select
                      value={uc.role}
                      disabled={membershipBusy}
                      onChange={(e) =>
                        handleUpdateRole(managing.id, uc.company.id, e.target.value as Role)
                      }
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
                      disabled={membershipBusy}
                      onClick={() =>
                        handleRemoveCompany(managing.id, uc.company.id, companyDisplayName(uc.company))
                      }
                      className="h-8 w-8 shrink-0 text-red-400 hover:text-red-300 hover:bg-red-500/10"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))
              )}
            </div>

            {/* Yeni firma ekle */}
            <div className="rounded-lg border border-slate-800 bg-slate-800/20 p-3 space-y-2">
              <Label className="text-slate-300 text-sm">Firmaya ekle</Label>
              {availableCompanies.length === 0 ? (
                <p className="text-xs text-slate-500">Eklenebilecek başka firma yok.</p>
              ) : (
                <div className="flex flex-col sm:flex-row gap-2">
                  {/* min-w-0 ŞART: native <select>'in min-content genişliği en uzun
                      option'a eşittir; flex item'da min-width:auto ile birleşince
                      seçici diyaloğun dışına taşıyordu (ünvanlar 100+ karakter). */}
                  <select
                    value={addCompanyId}
                    disabled={membershipBusy}
                    onChange={(e) => setAddCompanyId(e.target.value)}
                    className="w-full min-w-0 flex-1 h-9 rounded-md bg-slate-800 border border-slate-700 text-white text-sm px-2"
                  >
                    <option value="">Firma seç…</option>
                    {availableCompanies.map((c) => (
                      <option key={c.id} value={c.id}>
                        {companyDisplayName(c)}{c.isActive ? "" : " (pasif)"}
                      </option>
                    ))}
                  </select>
                  <select
                    value={addRole}
                    disabled={membershipBusy}
                    onChange={(e) => setAddRole(e.target.value as Role)}
                    className="h-9 shrink-0 rounded-md bg-slate-800 border border-slate-700 text-white text-sm px-2"
                  >
                    {Object.values(Role).map((r) => (
                      <option key={r} value={r}>
                        {roleLabels[r]}
                      </option>
                    ))}
                  </select>
                  <Button
                    onClick={handleAddCompany}
                    disabled={membershipBusy || !addCompanyId}
                    className="bg-emerald-600 hover:bg-emerald-700 shrink-0"
                  >
                    {membershipBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Ekle"}
                  </Button>
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setManagingUser(null)}
              className="border-slate-700 text-slate-300 hover:bg-slate-800"
            >
              Kapat
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

