"use client"

import { useCallback, useEffect, useState } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHeader } from "@/components/ui/table"
import {
  StyledTableContainer,
  StyledTableHeaderRow,
  StyledTableHead,
  StyledTableRow,
} from "@/components/ui/styled-table"
import { useToast } from "@/components/ui/use-toast"
import { useConfirm } from "@/components/ui/confirm-dialog-provider"
import { Plus, RefreshCcw, Trash2, Search, Pencil, UserX, UserCheck, Users } from "lucide-react"

type Employee = {
  id: string
  firstName: string
  lastName: string
  nationalId?: string | null
  email?: string | null
  phone?: string | null
  department?: string | null
  position?: string | null
  hireDate?: string | null
  grossSalary?: number | null
  iban?: string | null
  annualLeaveDays?: number | null
  address?: string | null
  emergencyContact?: string | null
  status: string
  notes?: string | null
}

const STATUS = {
  ACTIVE: { label: "Aktif", variant: "default" as const },
  ON_LEAVE: { label: "İzinde", variant: "secondary" as const },
  TERMINATED: { label: "Ayrıldı", variant: "destructive" as const },
}

const emptyForm = () => ({
  firstName: "",
  lastName: "",
  nationalId: "",
  phone: "",
  email: "",
  department: "",
  position: "",
  hireDate: "",
  grossSalary: "",
  iban: "",
  annualLeaveDays: "14",
  address: "",
  emergencyContact: "",
  notes: "",
})

function fmt(n: number) {
  return Number(n || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function PersonellerPage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const companyId = searchParams.get("company")
  const { toast } = useToast()
  const { confirm } = useConfirm()
  const [employees, setEmployees] = useState<Employee[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("ALL")
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [form, setForm] = useState(emptyForm())
  const [page, setPage] = useState(1)
  const pageSize = 20

  const fetchEmployees = useCallback(async () => {
    if (!companyId) return
    setIsLoading(true)
    try {
      const res = await fetch(`/api/personel/employees?companyId=${companyId}`)
      if (res.ok) setEmployees(await res.json())
    } finally {
      setIsLoading(false)
    }
  }, [companyId])

  useEffect(() => {
    fetchEmployees()
  }, [fetchEmployees])

  function openCreate() {
    setEditingId(null)
    setForm(emptyForm())
    setDialogOpen(true)
  }

  function openEdit(e: Employee) {
    setEditingId(e.id)
    setForm({
      firstName: e.firstName || "",
      lastName: e.lastName || "",
      nationalId: e.nationalId || "",
      phone: e.phone || "",
      email: e.email || "",
      department: e.department || "",
      position: e.position || "",
      hireDate: e.hireDate ? e.hireDate.split("T")[0] : "",
      grossSalary: e.grossSalary != null ? String(e.grossSalary) : "",
      iban: e.iban || "",
      annualLeaveDays: e.annualLeaveDays != null ? String(e.annualLeaveDays) : "14",
      address: e.address || "",
      emergencyContact: e.emergencyContact || "",
      notes: e.notes || "",
    })
    setDialogOpen(true)
  }

  async function save() {
    if (!companyId) return
    if (!form.firstName.trim() || !form.lastName.trim()) {
      toast({ title: "Eksik bilgi", description: "Ad ve soyad zorunlu.", variant: "destructive" })
      return
    }
    setIsSaving(true)
    try {
      const payload = {
        ...form,
        companyId,
        grossSalary: form.grossSalary || null,
        annualLeaveDays: form.annualLeaveDays || "14",
      }
      const res = editingId
        ? await fetch(`/api/personel/employees/${editingId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch("/api/personel/employees", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
      if (res.ok) {
        toast({ title: editingId ? "Personel güncellendi" : "Personel eklendi" })
        setDialogOpen(false)
        fetchEmployees()
      } else {
        const data = await res.json().catch(() => ({}))
        toast({ title: "Hata", description: data?.error || "Kaydedilemedi", variant: "destructive" })
      }
    } finally {
      setIsSaving(false)
    }
  }

  async function setStatus(e: Employee, status: string) {
    const res = await fetch(`/api/personel/employees/${e.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    })
    if (res.ok) {
      toast({ title: status === "TERMINATED" ? "Personel işten çıkarıldı" : "Personel aktifleştirildi" })
      fetchEmployees()
    } else {
      toast({ title: "Hata", description: "Güncellenemedi", variant: "destructive" })
    }
  }

  async function remove(e: Employee) {
    if (!(await confirm({ title: "Personeli sil", description: `${e.firstName} ${e.lastName} kaydını silmek istediğinize emin misiniz?`, confirmLabel: "Sil", variant: "destructive" }))) return
    const res = await fetch(`/api/personel/employees/${e.id}`, { method: "DELETE" })
    if (res.ok) {
      toast({ title: "Personel silindi" })
      fetchEmployees()
    } else {
      const data = await res.json().catch(() => ({}))
      toast({ title: "Hata", description: data?.error || "Silinemedi", variant: "destructive" })
    }
  }

  if (!companyId) {
    return <div className="p-6 text-sm text-muted-foreground">Lütfen firma seçin.</div>
  }

  const term = search.trim().toLocaleLowerCase("tr-TR")
  const filtered = employees.filter((e) => {
    if (statusFilter !== "ALL" && e.status !== statusFilter) return false
    if (!term) return true
    const hay = `${e.firstName} ${e.lastName} ${e.department || ""} ${e.position || ""} ${e.nationalId || ""}`.toLocaleLowerCase("tr-TR")
    return hay.includes(term)
  })

  const activeCount = employees.filter((e) => e.status === "ACTIVE").length
  const onLeaveCount = employees.filter((e) => e.status === "ON_LEAVE").length
  const terminatedCount = employees.filter((e) => e.status === "TERMINATED").length

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const paged = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)
  const companyQs = `?company=${encodeURIComponent(companyId)}`

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-4">
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Toplam Personel</p><p className="text-xl font-bold">{employees.length}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Aktif</p><p className="text-xl font-bold text-emerald-600">{activeCount}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">İzinde</p><p className="text-xl font-bold text-amber-600">{onLeaveCount}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Ayrılan</p><p className="text-xl font-bold text-muted-foreground">{terminatedCount}</p></CardContent></Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="flex items-center gap-2"><Users className="h-5 w-5" /> Personeller</CardTitle>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={fetchEmployees}>
                <RefreshCcw className="mr-1 h-4 w-4" /> Yenile
              </Button>
              <Button size="sm" onClick={openCreate}>
                <Plus className="mr-1 h-4 w-4" /> Yeni Personel
              </Button>
            </div>
          </div>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-8" placeholder="Ad, departman, görev veya TC ara…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} />
            </div>
            <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1) }}>
              <SelectTrigger className="sm:w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Tüm durumlar</SelectItem>
                <SelectItem value="ACTIVE">Aktif</SelectItem>
                <SelectItem value="ON_LEAVE">İzinde</SelectItem>
                <SelectItem value="TERMINATED">Ayrıldı</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading && <div className="text-sm text-muted-foreground">Yükleniyor…</div>}
          {!isLoading && employees.length === 0 && <div className="text-sm text-muted-foreground">Henüz personel yok.</div>}
          {!isLoading && employees.length > 0 && filtered.length === 0 && <div className="text-sm text-muted-foreground">Eşleşen personel yok.</div>}
          {!isLoading && filtered.length > 0 && (
            <StyledTableContainer>
              <Table>
                <TableHeader>
                  <StyledTableHeaderRow>
                    <StyledTableHead>Ad Soyad</StyledTableHead>
                    <StyledTableHead>Departman</StyledTableHead>
                    <StyledTableHead>Görev</StyledTableHead>
                    <StyledTableHead>İşe Giriş</StyledTableHead>
                    <StyledTableHead className="text-right">Brüt Maaş</StyledTableHead>
                    <StyledTableHead>Durum</StyledTableHead>
                    <StyledTableHead className="w-[140px] text-right">İşlem</StyledTableHead>
                  </StyledTableHeaderRow>
                </TableHeader>
                <TableBody>
                  {paged.map((e, idx) => (
                    <StyledTableRow key={e.id} index={idx} className="cursor-pointer" onClick={() => router.push(`/personel/${e.id}${companyQs}`)}>
                      <TableCell>
                        <div className="font-medium text-kobipo-blue">{e.firstName} {e.lastName}</div>
                        {e.phone && <div className="text-xs text-muted-foreground">{e.phone}</div>}
                      </TableCell>
                      <TableCell className="text-xs">{e.department || "—"}</TableCell>
                      <TableCell className="text-xs">{e.position || "—"}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs">
                        {e.hireDate ? new Date(e.hireDate).toLocaleDateString("tr-TR") : "—"}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        {e.grossSalary != null ? `${fmt(Number(e.grossSalary))} ₺` : "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={STATUS[e.status as keyof typeof STATUS]?.variant || "secondary"}>
                          {STATUS[e.status as keyof typeof STATUS]?.label || e.status}
                        </Badge>
                      </TableCell>
                      <TableCell onClick={(ev) => ev.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1">
                          <Button size="sm" variant="ghost" onClick={() => openEdit(e)} title="Düzenle">
                            <Pencil className="h-4 w-4" />
                          </Button>
                          {e.status === "TERMINATED" ? (
                            <Button size="sm" variant="ghost" onClick={() => setStatus(e, "ACTIVE")} title="Aktifleştir">
                              <UserCheck className="h-4 w-4 text-emerald-600" />
                            </Button>
                          ) : (
                            <Button size="sm" variant="ghost" onClick={() => setStatus(e, "TERMINATED")} title="İşten çıkar">
                              <UserX className="h-4 w-4 text-amber-600" />
                            </Button>
                          )}
                          <Button size="sm" variant="ghost" onClick={() => remove(e)} title="Sil">
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </StyledTableRow>
                  ))}
                </TableBody>
              </Table>
            </StyledTableContainer>
          )}
          {!isLoading && totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{filtered.length} kayıt · Sayfa {safePage}/{totalPages}</span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>Önceki</Button>
                <Button variant="outline" size="sm" disabled={safePage >= totalPages} onClick={() => setPage(safePage + 1)}>Sonraki</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingId ? "Personel Düzenle" : "Yeni Personel"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><Label>Ad *</Label><Input value={form.firstName} onChange={(e) => setForm((p) => ({ ...p, firstName: e.target.value }))} /></div>
            <div><Label>Soyad *</Label><Input value={form.lastName} onChange={(e) => setForm((p) => ({ ...p, lastName: e.target.value }))} /></div>
            <div><Label>TC Kimlik No</Label><Input value={form.nationalId} onChange={(e) => setForm((p) => ({ ...p, nationalId: e.target.value }))} /></div>
            <div><Label>Telefon</Label><Input value={form.phone} onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))} /></div>
            <div><Label>E-posta</Label><Input value={form.email} onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))} /></div>
            <div><Label>Departman</Label><Input value={form.department} onChange={(e) => setForm((p) => ({ ...p, department: e.target.value }))} /></div>
            <div><Label>Görev / Unvan</Label><Input value={form.position} onChange={(e) => setForm((p) => ({ ...p, position: e.target.value }))} /></div>
            <div><Label>İşe Giriş Tarihi</Label><Input type="date" value={form.hireDate} onChange={(e) => setForm((p) => ({ ...p, hireDate: e.target.value }))} /></div>
            <div><Label>Brüt Maaş (₺)</Label><Input type="number" value={form.grossSalary} onChange={(e) => setForm((p) => ({ ...p, grossSalary: e.target.value }))} /></div>
            <div><Label>Yıllık İzin Hakkı (gün)</Label><Input type="number" value={form.annualLeaveDays} onChange={(e) => setForm((p) => ({ ...p, annualLeaveDays: e.target.value }))} /></div>
            <div><Label>IBAN</Label><Input value={form.iban} onChange={(e) => setForm((p) => ({ ...p, iban: e.target.value }))} /></div>
            <div><Label>Acil Durum İletişim</Label><Input value={form.emergencyContact} onChange={(e) => setForm((p) => ({ ...p, emergencyContact: e.target.value }))} /></div>
            <div className="sm:col-span-2"><Label>Adres</Label><Input value={form.address} onChange={(e) => setForm((p) => ({ ...p, address: e.target.value }))} /></div>
            <div className="sm:col-span-2"><Label>Not</Label><Input value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} /></div>
          </div>
          <Button className="w-full" onClick={save} disabled={isSaving}>
            {isSaving ? "Kaydediliyor…" : editingId ? "Güncelle" : "Kaydet"}
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  )
}
