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
import { Search, MoreVertical, Users, FileText, Eye, Ban, Trash2, Edit, Loader2 } from "lucide-react"
import { useToast } from "@/components/ui/use-toast"
import { useConfirm } from "@/components/ui/confirm-dialog-provider"
import { useRouter } from "next/navigation"
import { companyDisplayName } from "@/lib/company/display-name"

interface Company {
  id: string
  name: string
  /** Ünvandan ayrı kısa şube adı; aynı ünvanlı şubeleri ayıran tek alan. */
  branchName: string | null
  taxNumber: string | null
  taxOffice?: string | null
  city: string | null
  phone?: string | null
  email?: string | null
  address?: string | null
  isActive: boolean
  createdAt: Date
  users: {
    user: {
      id: string
      name: string | null
      email: string
    }
  }[]
  _count: {
    customers: number
    suppliers: number
    products: number
    invoices: number
  }
}

interface CompanyTableProps {
  companies: Company[]
}

const emptyForm = {
  name: "",
  branchName: "",
  taxNumber: "",
  taxOffice: "",
  city: "",
  phone: "",
  email: "",
  address: "",
}

export function CompanyTable({ companies }: CompanyTableProps) {
  const [searchTerm, setSearchTerm] = useState("")
  const { toast } = useToast()
  const { confirm } = useConfirm()
  const router = useRouter()

  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)

  const openEdit = (company: Company) => {
    setEditingId(company.id)
    setForm({
      name: company.name ?? "",
      branchName: company.branchName ?? "",
      taxNumber: company.taxNumber ?? "",
      taxOffice: company.taxOffice ?? "",
      city: company.city ?? "",
      phone: company.phone ?? "",
      email: company.email ?? "",
      address: company.address ?? "",
    })
  }

  const handleSave = async () => {
    if (!editingId) return
    if (!form.name.trim()) {
      toast({ title: "Hata", description: "Firma adı zorunludur", variant: "destructive" })
      return
    }
    setSaving(true)
    try {
      const response = await fetch(`/api/system-admin/companies/${editingId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      })
      const data = await response.json().catch(() => ({}))
      if (response.ok) {
        toast({ title: "Başarılı", description: "Firma bilgileri güncellendi" })
        setEditingId(null)
        router.refresh()
      } else {
        throw new Error(data.error || "İşlem başarısız")
      }
    } catch (error) {
      toast({
        title: "Hata",
        description: error instanceof Error ? error.message : "Firma güncellenirken bir hata oluştu",
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  const filteredCompanies = companies.filter(company =>
    company.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    // Şube adıyla da aranabilsin: aynı ünvanlı 5 şube arasında aranan "Kadıköy"dür.
    company.branchName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    company.taxNumber?.includes(searchTerm) ||
    company.city?.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const handleDelete = async (companyId: string, companyName: string) => {
    if (
      !(await confirm({
        title: "Firmayı sil",
        description: `"${companyName}" firmasını ve TÜM verilerini (müşteri, fatura, stok vb.) kalıcı olarak silmek istediğinize emin misiniz? Bu işlem geri alınamaz.`,
        confirmLabel: "Sil",
        variant: "destructive",
      }))
    ) {
      return
    }
    try {
      const response = await fetch(`/api/system-admin/companies/${companyId}`, {
        method: "DELETE",
      })
      if (response.ok) {
        toast({ title: "Başarılı", description: `"${companyName}" firması silindi` })
        router.refresh()
      } else {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || "İşlem başarısız")
      }
    } catch (error) {
      toast({
        title: "Hata",
        description: error instanceof Error ? error.message : "Firma silinirken bir hata oluştu",
        variant: "destructive",
      })
    }
  }

  const handleToggleStatus = async (companyId: string, currentStatus: boolean) => {
    try {
      const response = await fetch(`/api/system-admin/companies/${companyId}/toggle-status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !currentStatus })
      })

      if (response.ok) {
        toast({
          title: "Başarılı",
          description: `Firma ${currentStatus ? "pasif" : "aktif"} hale getirildi`,
        })
        router.refresh()
      } else {
        throw new Error("İşlem başarısız")
      }
    } catch (error) {
      toast({
        title: "Hata",
        description: "Firma durumu güncellenirken bir hata oluştu",
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
          placeholder="Firma adı, vergi no veya şehir ara..."
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
              <TableHead className="text-slate-400">Firma Adı</TableHead>
              <TableHead className="text-slate-400">Vergi No</TableHead>
              <TableHead className="text-slate-400">Şehir</TableHead>
              <TableHead className="text-slate-400">Kullanıcılar</TableHead>
              <TableHead className="text-slate-400">İstatistikler</TableHead>
              <TableHead className="text-slate-400">Durum</TableHead>
              <TableHead className="text-slate-400 text-right">İşlemler</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredCompanies.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-slate-500">
                  {searchTerm ? "Arama sonucu bulunamadı" : "Henüz firma kaydı yok"}
                </TableCell>
              </TableRow>
            ) : (
              filteredCompanies.map((company) => (
                <TableRow key={company.id} className="border-slate-800 hover:bg-slate-800/50">
                  <TableCell>
                    <div>
                      <p className="font-medium text-white">
                        {company.name}
                        {company.branchName && (
                          <span className="ml-1.5 rounded bg-slate-700/60 px-1.5 py-0.5 text-xs font-normal text-slate-300">
                            {company.branchName}
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-slate-500">
                        {new Date(company.createdAt).toLocaleDateString("tr-TR")}
                      </p>
                    </div>
                  </TableCell>
                  <TableCell className="text-slate-300">
                    {company.taxNumber || "-"}
                  </TableCell>
                  <TableCell className="text-slate-300">
                    {company.city || "-"}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Users className="h-4 w-4 text-slate-500" />
                      <span className="text-slate-300">{company.users.length}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-3 text-xs text-slate-500">
                      <span>{company._count.customers} müşteri</span>
                      <span>{company._count.invoices} fatura</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                      company.isActive
                        ? "bg-green-500/20 text-green-400"
                        : "bg-red-500/20 text-red-400"
                    }`}>
                      {company.isActive ? "Aktif" : "Pasif"}
                    </span>
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
                          onClick={() => router.push(`/system-admin/companies/${company.id}`)}
                        >
                          <Eye className="h-4 w-4 mr-2" />
                          Detayları Görüntüle
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-slate-300 focus:bg-slate-800 focus:text-white"
                          onClick={() => openEdit(company)}
                        >
                          <Edit className="h-4 w-4 mr-2" />
                          Düzenle
                        </DropdownMenuItem>
                        <DropdownMenuItem 
                          className="text-slate-300 focus:bg-slate-800 focus:text-white"
                          onClick={() => handleToggleStatus(company.id, company.isActive)}
                        >
                          <Ban className="h-4 w-4 mr-2" />
                          {company.isActive ? "Pasif Yap" : "Aktif Yap"}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator className="bg-slate-800" />
                        <DropdownMenuItem
                          className="text-red-400 focus:bg-red-500/20 focus:text-red-400"
                          onClick={() => handleDelete(company.id, companyDisplayName(company))}
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
        Toplam {filteredCompanies.length} firma gösteriliyor
      </div>

      {/* Düzenleme Dialog'u */}
      <Dialog open={editingId !== null} onOpenChange={(open) => !open && setEditingId(null)}>
        <DialogContent className="sm:max-w-lg bg-slate-900 border-slate-800 text-slate-100">
          <DialogHeader>
            <DialogTitle className="text-white">Firma Düzenle</DialogTitle>
            <DialogDescription className="text-slate-500">
              Firma bilgilerini güncelleyin
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2 space-y-1">
              <Label className="text-slate-300">Firma Adı *</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="bg-slate-800/50 border-slate-700 text-white"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-slate-300">Şube Adı</Label>
              <Input
                value={form.branchName}
                onChange={(e) => setForm((f) => ({ ...f, branchName: e.target.value }))}
                placeholder="Kadıköy, Merkez, Madeni Yağ…"
                className="bg-slate-800/50 border-slate-700 text-white"
              />
              <p className="text-xs text-slate-500">
                Ünvan tüm şubelerde aynı olduğu için listelerde ayırt edici olan alan budur;
                faturada/e-belgede basılmaz, yalnız arayüzde ünvanın yanında görünür.
              </p>
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
              onClick={() => setEditingId(null)}
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
                "Kaydet"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

