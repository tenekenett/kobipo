"use client"

import { useCallback, useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
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
import Link from "next/link"
import { Plus, RefreshCcw, Trash2, Search, Undo2, BadgeCheck, FileText } from "lucide-react"

type Employee = { id: string; firstName: string; lastName: string; status: string }
type Asset = {
  id: string
  employee: { id: string; firstName: string; lastName: string; department?: string | null }
  assetName: string
  category?: string | null
  serialNo?: string | null
  quantity: number
  assignedDate: string
  returnDate?: string | null
  status: string
}

const emptyForm = () => ({ employeeId: "", assetName: "", category: "", serialNo: "", quantity: "1", assignedDate: new Date().toISOString().split("T")[0], notes: "" })

export default function ZimmetPage() {
  const searchParams = useSearchParams()
  const companyId = searchParams.get("company")
  const { toast } = useToast()
  const { confirm } = useConfirm()
  const [assets, setAssets] = useState<Asset[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("ALL")
  const [createOpen, setCreateOpen] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [form, setForm] = useState(emptyForm())

  const fetchAssets = useCallback(async () => {
    if (!companyId) return
    setIsLoading(true)
    try {
      const res = await fetch(`/api/personel/assets?companyId=${companyId}`)
      if (res.ok) setAssets(await res.json())
    } finally {
      setIsLoading(false)
    }
  }, [companyId])

  const fetchEmployees = useCallback(async () => {
    if (!companyId) return
    const res = await fetch(`/api/personel/employees?companyId=${companyId}&status=ACTIVE`)
    if (res.ok) setEmployees(await res.json())
  }, [companyId])

  useEffect(() => { fetchAssets() }, [fetchAssets])
  useEffect(() => { fetchEmployees() }, [fetchEmployees])

  async function save() {
    if (!companyId) return
    if (!form.employeeId || !form.assetName.trim()) {
      toast({ title: "Eksik bilgi", description: "Personel ve demirbaş adı zorunlu.", variant: "destructive" })
      return
    }
    setIsSaving(true)
    try {
      const res = await fetch("/api/personel/assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, companyId }),
      })
      if (res.ok) {
        toast({ title: "Zimmet kaydedildi" })
        setCreateOpen(false)
        setForm(emptyForm())
        fetchAssets()
      } else {
        const data = await res.json().catch(() => ({}))
        toast({ title: "Hata", description: data?.error || "Kaydedilemedi", variant: "destructive" })
      }
    } finally {
      setIsSaving(false)
    }
  }

  async function toggleReturn(a: Asset) {
    const action = a.status === "RETURNED" ? "unreturn" : "return"
    const res = await fetch(`/api/personel/assets/${a.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    })
    if (res.ok) {
      toast({ title: action === "return" ? "İade alındı" : "Zimmete geri alındı" })
      fetchAssets()
    } else {
      toast({ title: "Hata", description: "Güncellenemedi", variant: "destructive" })
    }
  }

  async function remove(a: Asset) {
    if (!(await confirm({ title: "Zimmet kaydını sil", description: "Bu zimmet kaydını silmek istediğinize emin misiniz?", confirmLabel: "Sil", variant: "destructive" }))) return
    const res = await fetch(`/api/personel/assets/${a.id}`, { method: "DELETE" })
    if (res.ok) {
      toast({ title: "Zimmet silindi" })
      fetchAssets()
    } else {
      toast({ title: "Hata", description: "Silinemedi", variant: "destructive" })
    }
  }

  if (!companyId) return <div className="p-6 text-sm text-muted-foreground">Lütfen firma seçin.</div>

  const term = search.trim().toLocaleLowerCase("tr-TR")
  const filtered = assets.filter((a) => {
    if (statusFilter !== "ALL" && a.status !== statusFilter) return false
    if (!term) return true
    const hay = `${a.assetName} ${a.category || ""} ${a.serialNo || ""} ${a.employee.firstName} ${a.employee.lastName}`.toLocaleLowerCase("tr-TR")
    return hay.includes(term)
  })
  const assignedCount = assets.filter((a) => a.status === "ASSIGNED").length
  const returnedCount = assets.filter((a) => a.status === "RETURNED").length

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <Card><CardContent className="flex items-center gap-3 p-4"><div className="flex h-10 w-10 items-center justify-center rounded-lg bg-kobipo-blue/10 text-kobipo-blue"><BadgeCheck className="h-5 w-5" /></div><div><p className="text-xs text-muted-foreground">Zimmetli</p><p className="text-xl font-bold">{assignedCount}</p></div></CardContent></Card>
        <Card><CardContent className="flex items-center gap-3 p-4"><div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"><Undo2 className="h-5 w-5" /></div><div><p className="text-xs text-muted-foreground">İade Edilen</p><p className="text-xl font-bold">{returnedCount}</p></div></CardContent></Card>
        <Card><CardContent className="flex items-center gap-3 p-4"><div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted text-muted-foreground"><BadgeCheck className="h-5 w-5" /></div><div><p className="text-xs text-muted-foreground">Toplam Kayıt</p><p className="text-xl font-bold">{assets.length}</p></div></CardContent></Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle>Zimmet</CardTitle>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={fetchAssets}><RefreshCcw className="mr-1 h-4 w-4" /> Yenile</Button>
              <Button size="sm" onClick={() => { setForm(emptyForm()); setCreateOpen(true) }}><Plus className="mr-1 h-4 w-4" /> Yeni Zimmet</Button>
            </div>
          </div>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-8" placeholder="Demirbaş, seri no veya personel ara…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="sm:w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Tüm durumlar</SelectItem>
                <SelectItem value="ASSIGNED">Zimmetli</SelectItem>
                <SelectItem value="RETURNED">İade edilen</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading && <div className="text-sm text-muted-foreground">Yükleniyor…</div>}
          {!isLoading && assets.length === 0 && <div className="text-sm text-muted-foreground">Henüz zimmet kaydı yok.</div>}
          {!isLoading && assets.length > 0 && filtered.length === 0 && <div className="text-sm text-muted-foreground">Eşleşen kayıt yok.</div>}
          {!isLoading && filtered.length > 0 && (
            <StyledTableContainer>
              <Table>
                <TableHeader>
                  <StyledTableHeaderRow>
                    <StyledTableHead>Personel</StyledTableHead>
                    <StyledTableHead>Demirbaş</StyledTableHead>
                    <StyledTableHead>Kategori</StyledTableHead>
                    <StyledTableHead>Seri No</StyledTableHead>
                    <StyledTableHead className="text-center">Adet</StyledTableHead>
                    <StyledTableHead>Zimmet Tarihi</StyledTableHead>
                    <StyledTableHead>Durum</StyledTableHead>
                    <StyledTableHead className="w-[130px] text-right">İşlem</StyledTableHead>
                  </StyledTableHeaderRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((a, idx) => (
                    <StyledTableRow key={a.id} index={idx}>
                      <TableCell className="font-medium">{a.employee.firstName} {a.employee.lastName}</TableCell>
                      <TableCell className="text-xs">{a.assetName}</TableCell>
                      <TableCell className="text-xs">{a.category || "—"}</TableCell>
                      <TableCell className="text-xs font-mono">{a.serialNo || "—"}</TableCell>
                      <TableCell className="text-center text-xs">{a.quantity}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs">{new Date(a.assignedDate).toLocaleDateString("tr-TR")}</TableCell>
                      <TableCell>
                        <Badge variant={a.status === "RETURNED" ? "outline" : "default"}>
                          {a.status === "RETURNED" ? `İade (${a.returnDate ? new Date(a.returnDate).toLocaleDateString("tr-TR") : ""})` : "Zimmetli"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          <Button size="sm" variant="ghost" asChild title={a.status === "RETURNED" ? "İade formu (PDF)" : "Teslim formu (PDF)"}>
                            <a href={`/api/personel/assets/${a.id}/pdf`} target="_blank" rel="noopener noreferrer">
                              <FileText className="h-4 w-4 text-kobipo-blue" />
                            </a>
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => toggleReturn(a)} title={a.status === "RETURNED" ? "Zimmete geri al" : "İade al"}>
                            <Undo2 className={`h-4 w-4 ${a.status === "RETURNED" ? "text-muted-foreground" : "text-emerald-600"}`} />
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => remove(a)} title="Sil">
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
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>Yeni Zimmet</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Personel *</Label>
              {employees.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Aktif personel yok. Önce <Link href={`/personel?company=${companyId}`} className="text-kobipo-blue hover:underline">Personeller</Link> sayfasından ekleyin.
                </p>
              ) : (
                <Select value={form.employeeId} onValueChange={(v) => setForm((p) => ({ ...p, employeeId: v }))}>
                  <SelectTrigger><SelectValue placeholder="Personel seçin" /></SelectTrigger>
                  <SelectContent>
                    {employees.map((e) => <SelectItem key={e.id} value={e.id}>{e.firstName} {e.lastName}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div><Label>Demirbaş / Ekipman *</Label><Input value={form.assetName} onChange={(e) => setForm((p) => ({ ...p, assetName: e.target.value }))} placeholder="Dizüstü bilgisayar" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Kategori</Label><Input value={form.category} onChange={(e) => setForm((p) => ({ ...p, category: e.target.value }))} placeholder="Bilgisayar" /></div>
              <div><Label>Seri No</Label><Input value={form.serialNo} onChange={(e) => setForm((p) => ({ ...p, serialNo: e.target.value }))} /></div>
              <div><Label>Adet</Label><Input type="number" value={form.quantity} onChange={(e) => setForm((p) => ({ ...p, quantity: e.target.value }))} /></div>
              <div><Label>Zimmet Tarihi</Label><Input type="date" value={form.assignedDate} onChange={(e) => setForm((p) => ({ ...p, assignedDate: e.target.value }))} /></div>
            </div>
            <div><Label>Not</Label><Input value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} /></div>
            <Button className="w-full" onClick={save} disabled={isSaving}>{isSaving ? "Kaydediliyor…" : "Kaydet"}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
