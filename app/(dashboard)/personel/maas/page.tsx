"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
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
import { Plus, RefreshCcw, Trash2, Wallet, DollarSign, Users, FileText, Download, Pencil } from "lucide-react"

type Employee = { id: string; firstName: string; lastName: string; grossSalary?: number | null; status: string }
type Account = { id: string; name: string; type: string }
type Payroll = {
  id: string
  employee: { id: string; firstName: string; lastName: string; department?: string | null }
  grossSalary: number
  bonus: number
  advance: number
  sgkDeduction: number
  taxDeduction: number
  otherDeduction: number
  netSalary: number
  status: string
  paymentDate?: string | null
}

const MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"]

const fmt = (n: number) => Number(n || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const emptyForm = () => ({
  employeeId: "",
  grossSalary: "",
  bonus: "",
  advance: "",
  sgkDeduction: "",
  taxDeduction: "",
  otherDeduction: "",
  notes: "",
})

export default function MaasOdemelerPage() {
  const searchParams = useSearchParams()
  const companyId = searchParams.get("company")
  const { toast } = useToast()
  const { confirm } = useConfirm()

  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)

  const [records, setRecords] = useState<Payroll[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [isLoading, setIsLoading] = useState(false)

  const [createOpen, setCreateOpen] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [form, setForm] = useState(emptyForm())
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editEmployeeName, setEditEmployeeName] = useState("")

  const [payTarget, setPayTarget] = useState<Payroll | null>(null)
  const [payAccountId, setPayAccountId] = useState("")
  const [payDate, setPayDate] = useState(new Date().toISOString().split("T")[0])

  const fetchRecords = useCallback(async () => {
    if (!companyId) return
    setIsLoading(true)
    try {
      const res = await fetch(`/api/personel/payroll?companyId=${companyId}&year=${year}&month=${month}`)
      if (res.ok) setRecords(await res.json())
    } finally {
      setIsLoading(false)
    }
  }, [companyId, year, month])

  const fetchRefData = useCallback(async () => {
    if (!companyId) return
    const [empRes, accRes] = await Promise.all([
      fetch(`/api/personel/employees?companyId=${companyId}&status=ACTIVE`),
      fetch(`/api/finans/accounts?companyId=${companyId}`),
    ])
    if (empRes.ok) setEmployees(await empRes.json())
    if (accRes.ok) {
      const list = await accRes.json()
      const arr: Account[] = Array.isArray(list) ? list : []
      setAccounts(arr)
      const firstCash = arr.find((a) => a.type === "CASH") ?? arr[0]
      if (firstCash) setPayAccountId((p) => p || firstCash.id)
    }
  }, [companyId])

  useEffect(() => {
    fetchRecords()
  }, [fetchRecords])
  useEffect(() => {
    fetchRefData()
  }, [fetchRefData])

  const liveNet = useMemo(() => {
    const n = (v: string) => Number(v || 0)
    return n(form.grossSalary) + n(form.bonus) - n(form.advance) - n(form.sgkDeduction) - n(form.taxDeduction) - n(form.otherDeduction)
  }, [form])

  function openCreate() {
    setEditingId(null)
    setEditEmployeeName("")
    setForm(emptyForm())
    setCreateOpen(true)
  }

  function openEdit(r: Payroll) {
    setEditingId(r.id)
    setEditEmployeeName(`${r.employee.firstName} ${r.employee.lastName}`)
    setForm({
      employeeId: r.employee.id,
      grossSalary: String(r.grossSalary),
      bonus: String(r.bonus),
      advance: String(r.advance),
      sgkDeduction: String(r.sgkDeduction),
      taxDeduction: String(r.taxDeduction),
      otherDeduction: String(r.otherDeduction),
      notes: "",
    })
    setCreateOpen(true)
  }

  function onSelectEmployee(employeeId: string) {
    const emp = employees.find((e) => e.id === employeeId)
    setForm((p) => ({ ...p, employeeId, grossSalary: emp?.grossSalary != null ? String(emp.grossSalary) : p.grossSalary }))
  }

  async function save() {
    if (!companyId) return
    if (!form.employeeId) {
      toast({ title: "Eksik bilgi", description: "Personel seçin.", variant: "destructive" })
      return
    }
    setIsSaving(true)
    try {
      const res = editingId
        ? await fetch(`/api/personel/payroll/${editingId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(form),
          })
        : await fetch("/api/personel/payroll", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...form, companyId, periodYear: year, periodMonth: month }),
          })
      if (res.ok) {
        toast({ title: editingId ? "Bordro güncellendi" : "Bordro oluşturuldu" })
        setCreateOpen(false)
        fetchRecords()
      } else {
        const data = await res.json().catch(() => ({}))
        toast({ title: "Hata", description: data?.error || "Kaydedilemedi", variant: "destructive" })
      }
    } finally {
      setIsSaving(false)
    }
  }

  async function bulkCreate() {
    if (!companyId) return
    if (!(await confirm({ title: "Toplu bordro oluştur", description: `${MONTHS[month - 1]} ${year} için bordrosu olmayan tüm aktif personele taslak bordro oluşturulsun mu?`, confirmLabel: "Oluştur" }))) return
    const res = await fetch("/api/personel/payroll/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyId, periodYear: year, periodMonth: month }),
    })
    if (res.ok) {
      const data = await res.json()
      toast({ title: "Toplu bordro", description: data.created > 0 ? `${data.created} bordro oluşturuldu` : (data.message || "Yeni bordro oluşturulmadı") })
      fetchRecords()
    } else {
      toast({ title: "Hata", description: "Oluşturulamadı", variant: "destructive" })
    }
  }

  async function confirmPay() {
    if (!payTarget) return
    const res = await fetch(`/api/personel/payroll/${payTarget.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "pay", accountId: payAccountId || null, paymentDate: payDate }),
    })
    if (res.ok) {
      toast({ title: "Maaş ödendi", description: payAccountId ? "Kasa/banka hesabından düşüldü" : "Ödeme işaretlendi" })
      setPayTarget(null)
      fetchRecords()
    } else {
      const data = await res.json().catch(() => ({}))
      toast({ title: "Hata", description: data?.error || "Ödenemedi", variant: "destructive" })
    }
  }

  async function remove(p: Payroll) {
    if (!(await confirm({ title: "Bordroyu sil", description: "Bu bordroyu silmek istediğinize emin misiniz?", confirmLabel: "Sil", variant: "destructive" }))) return
    const res = await fetch(`/api/personel/payroll/${p.id}`, { method: "DELETE" })
    if (res.ok) {
      toast({ title: "Bordro silindi" })
      fetchRecords()
    } else {
      const data = await res.json().catch(() => ({}))
      toast({ title: "Hata", description: data?.error || "Silinemedi", variant: "destructive" })
    }
  }

  if (!companyId) return <div className="p-6 text-sm text-muted-foreground">Lütfen firma seçin.</div>

  const totalNet = records.reduce((s, r) => s + Number(r.netSalary), 0)
  const paidNet = records.filter((r) => r.status === "PAID").reduce((s, r) => s + Number(r.netSalary), 0)
  const years = [now.getFullYear() + 1, now.getFullYear(), now.getFullYear() - 1, now.getFullYear() - 2]

  // Bu dönemde zaten bordrosu olanlar dropdown'dan çıkarılır (mükerrer-hatası önlenir).
  const recordedIds = new Set(records.map((r) => r.employee.id))
  const availableEmployees = employees.filter((e) => !recordedIds.has(e.id))

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <Card><CardContent className="flex items-center gap-3 p-4"><div className="flex h-10 w-10 items-center justify-center rounded-lg bg-kobipo-blue/10 text-kobipo-blue"><DollarSign className="h-5 w-5" /></div><div><p className="text-xs text-muted-foreground">Dönem Bordro</p><p className="text-xl font-bold">{records.length}</p></div></CardContent></Card>
        <Card><CardContent className="flex items-center gap-3 p-4"><div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"><Wallet className="h-5 w-5" /></div><div><p className="text-xs text-muted-foreground">Toplam Net</p><p className="text-xl font-bold">{fmt(totalNet)} ₺</p></div></CardContent></Card>
        <Card><CardContent className="flex items-center gap-3 p-4"><div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"><Wallet className="h-5 w-5" /></div><div><p className="text-xs text-muted-foreground">Ödenen</p><p className="text-xl font-bold">{fmt(paidNet)} ₺</p></div></CardContent></Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle>Maaş & Bordro</CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
                <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MONTHS.map((m, i) => <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
                <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {years.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" onClick={fetchRecords}><RefreshCcw className="mr-1 h-4 w-4" /> Yenile</Button>
              <Button variant="outline" size="sm" onClick={bulkCreate}><Users className="mr-1 h-4 w-4" /> Tümüne Oluştur</Button>
              <Button variant="outline" size="sm" disabled={records.length === 0} asChild>
                <a href={`/api/personel/payroll/bank-file?companyId=${companyId}&year=${year}&month=${month}`}>
                  <Download className="mr-1 h-4 w-4" /> Banka Dosyası
                </a>
              </Button>
              <Button size="sm" onClick={openCreate}><Plus className="mr-1 h-4 w-4" /> Yeni Bordro</Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading && <div className="text-sm text-muted-foreground">Yükleniyor…</div>}
          {!isLoading && records.length === 0 && <div className="text-sm text-muted-foreground">Bu döneme ait bordro yok. "Yeni Bordro" ile ekleyin.</div>}
          {!isLoading && records.length > 0 && (
            <StyledTableContainer>
              <Table>
                <TableHeader>
                  <StyledTableHeaderRow>
                    <StyledTableHead>Personel</StyledTableHead>
                    <StyledTableHead className="text-right">Brüt</StyledTableHead>
                    <StyledTableHead className="text-right">Ek/Prim</StyledTableHead>
                    <StyledTableHead className="text-right">Kesinti</StyledTableHead>
                    <StyledTableHead className="text-right">Net</StyledTableHead>
                    <StyledTableHead>Durum</StyledTableHead>
                    <StyledTableHead className="w-[160px] text-right">İşlem</StyledTableHead>
                  </StyledTableHeaderRow>
                </TableHeader>
                <TableBody>
                  {records.map((r, idx) => {
                    const deductions = Number(r.advance) + Number(r.sgkDeduction) + Number(r.taxDeduction) + Number(r.otherDeduction)
                    return (
                      <StyledTableRow key={r.id} index={idx}>
                        <TableCell>
                          <div className="font-medium">{r.employee.firstName} {r.employee.lastName}</div>
                          {r.employee.department && <div className="text-xs text-muted-foreground">{r.employee.department}</div>}
                        </TableCell>
                        <TableCell className="text-right whitespace-nowrap text-xs">{fmt(Number(r.grossSalary))}</TableCell>
                        <TableCell className="text-right whitespace-nowrap text-xs">{fmt(Number(r.bonus))}</TableCell>
                        <TableCell className="text-right whitespace-nowrap text-xs text-destructive">{fmt(deductions)}</TableCell>
                        <TableCell className="text-right whitespace-nowrap font-semibold">{fmt(Number(r.netSalary))} ₺</TableCell>
                        <TableCell>
                          <Badge variant={r.status === "PAID" ? "default" : "secondary"}>{r.status === "PAID" ? "Ödendi" : "Bekliyor"}</Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center justify-end gap-1">
                            <Button size="sm" variant="ghost" asChild title="Maaş pusulası (PDF)">
                              <a href={`/api/personel/payroll/${r.id}/pdf`} target="_blank" rel="noopener noreferrer">
                                <FileText className="h-4 w-4 text-kobipo-blue" />
                              </a>
                            </Button>
                            {r.status !== "PAID" && (
                              <Button size="sm" variant="ghost" onClick={() => openEdit(r)} title="Düzenle">
                                <Pencil className="h-4 w-4" />
                              </Button>
                            )}
                            {r.status !== "PAID" && (
                              <Button size="sm" variant="ghost" onClick={() => setPayTarget(r)} title="Öde">
                                <Wallet className="h-4 w-4 text-emerald-600" />
                              </Button>
                            )}
                            <Button size="sm" variant="ghost" disabled={r.status === "PAID"} onClick={() => remove(r)} title={r.status === "PAID" ? "Ödenmiş bordro silinemez" : "Sil"}>
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        </TableCell>
                      </StyledTableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </StyledTableContainer>
          )}
        </CardContent>
      </Card>

      {/* Yeni Bordro */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingId ? "Bordro Düzenle" : "Yeni Bordro"} — {MONTHS[month - 1]} {year}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Personel *</Label>
              {editingId ? (
                <Input value={editEmployeeName} disabled />
              ) : employees.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Aktif personel yok. Önce <Link href={`/personel?company=${companyId}`} className="text-kobipo-blue hover:underline">Personeller</Link> sayfasından ekleyin.
                </p>
              ) : availableEmployees.length === 0 ? (
                <p className="text-xs text-muted-foreground">Bu dönemde tüm aktif personelin bordrosu zaten var.</p>
              ) : (
                <Select value={form.employeeId} onValueChange={onSelectEmployee}>
                  <SelectTrigger><SelectValue placeholder="Personel seçin" /></SelectTrigger>
                  <SelectContent>
                    {availableEmployees.map((e) => <SelectItem key={e.id} value={e.id}>{e.firstName} {e.lastName}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Brüt Maaş</Label><Input type="number" value={form.grossSalary} onChange={(e) => setForm((p) => ({ ...p, grossSalary: e.target.value }))} /></div>
              <div><Label>Ek Ödeme / Prim</Label><Input type="number" value={form.bonus} onChange={(e) => setForm((p) => ({ ...p, bonus: e.target.value }))} /></div>
              <div><Label>Avans</Label><Input type="number" value={form.advance} onChange={(e) => setForm((p) => ({ ...p, advance: e.target.value }))} /></div>
              <div><Label>SGK Kesintisi</Label><Input type="number" value={form.sgkDeduction} onChange={(e) => setForm((p) => ({ ...p, sgkDeduction: e.target.value }))} /></div>
              <div><Label>Gelir Vergisi</Label><Input type="number" value={form.taxDeduction} onChange={(e) => setForm((p) => ({ ...p, taxDeduction: e.target.value }))} /></div>
              <div><Label>Diğer Kesinti</Label><Input type="number" value={form.otherDeduction} onChange={(e) => setForm((p) => ({ ...p, otherDeduction: e.target.value }))} /></div>
            </div>
            <div><Label>Not</Label><Input value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} /></div>
            <div className="flex items-center justify-between rounded-md border bg-muted/30 p-3">
              <span className="text-sm text-muted-foreground">Net Maaş</span>
              <span className="text-lg font-bold">{fmt(liveNet)} ₺</span>
            </div>
            <Button className="w-full" onClick={save} disabled={isSaving || (!editingId && availableEmployees.length === 0)}>{isSaving ? "Kaydediliyor…" : editingId ? "Güncelle" : "Kaydet"}</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Öde */}
      <Dialog open={!!payTarget} onOpenChange={(o) => !o && setPayTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Maaş Ödemesi</DialogTitle>
          </DialogHeader>
          {payTarget && (
            <div className="space-y-3">
              <div className="flex items-center justify-between rounded-md border bg-muted/30 p-3">
                <span className="text-sm">{payTarget.employee.firstName} {payTarget.employee.lastName}</span>
                <span className="text-lg font-bold">{fmt(Number(payTarget.netSalary))} ₺</span>
              </div>
              <div>
                <Label>Kasa / Banka Hesabı</Label>
                {accounts.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Tanımlı hesap yok — ödeme hesaba işlenmeyecek (yalnızca işaretlenir).</p>
                ) : (
                  <Select value={payAccountId} onValueChange={setPayAccountId}>
                    <SelectTrigger><SelectValue placeholder="Hesap seçin" /></SelectTrigger>
                    <SelectContent>
                      {accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name} {a.type === "CASH" ? "(Kasa)" : "(Banka)"}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
              </div>
              <div><Label>Ödeme Tarihi</Label><Input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} /></div>
              <Button className="w-full" onClick={confirmPay}>Ödemeyi Onayla</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
