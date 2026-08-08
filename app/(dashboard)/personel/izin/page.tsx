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
import { Plus, RefreshCcw, Trash2, Check, X, CalendarCheck, FileText, Scale, AlertTriangle } from "lucide-react"

type Employee = { id: string; firstName: string; lastName: string; status: string }
type Leave = {
  id: string
  employee: { id: string; firstName: string; lastName: string; department?: string | null }
  type: string
  startDate: string
  endDate: string
  days: number
  status: string
  reason?: string | null
}

const TYPE_LABELS: Record<string, string> = { ANNUAL: "Yıllık", EXCUSE: "Mazeret", SICK: "Hastalık", UNPAID: "Ücretsiz" }
const STATUS_LABELS: Record<string, string> = { PENDING: "Bekliyor", APPROVED: "Onaylandı", REJECTED: "Reddedildi" }

const DAY_MS = 24 * 60 * 60 * 1000

const emptyForm = () => ({ employeeId: "", type: "ANNUAL", startDate: new Date().toISOString().split("T")[0], endDate: new Date().toISOString().split("T")[0], reason: "" })

export default function IzinDevamPage() {
  const searchParams = useSearchParams()
  const companyId = searchParams.get("company")
  const { toast } = useToast()
  const { confirm } = useConfirm()
  const [leaves, setLeaves] = useState<Leave[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [statusFilter, setStatusFilter] = useState("ALL")
  const [createOpen, setCreateOpen] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [form, setForm] = useState(emptyForm())
  const [showBalance, setShowBalance] = useState(false)
  const [balances, setBalances] = useState<Array<{ employeeId: string; name: string; department?: string | null; entitlement: number; used: number; remaining: number }>>([])

  const fetchLeaves = useCallback(async () => {
    if (!companyId) return
    setIsLoading(true)
    try {
      const res = await fetch(`/api/personel/leaves?companyId=${companyId}`)
      if (res.ok) setLeaves(await res.json())
    } finally {
      setIsLoading(false)
    }
  }, [companyId])

  const fetchEmployees = useCallback(async () => {
    if (!companyId) return
    const res = await fetch(`/api/personel/employees?companyId=${companyId}&status=ACTIVE`)
    if (res.ok) setEmployees(await res.json())
  }, [companyId])

  const fetchBalances = useCallback(async () => {
    if (!companyId) return
    const res = await fetch(`/api/personel/leaves/balance?companyId=${companyId}&year=${new Date().getFullYear()}`)
    if (res.ok) {
      const data = await res.json()
      setBalances(data.balances || [])
    }
  }, [companyId])

  useEffect(() => { fetchLeaves() }, [fetchLeaves])
  useEffect(() => { fetchEmployees() }, [fetchEmployees])
  useEffect(() => { fetchBalances() }, [fetchBalances])

  function toggleBalance() {
    const next = !showBalance
    setShowBalance(next)
    if (next) fetchBalances()
  }

  const liveDays = useMemo(() => {
    const s = new Date(form.startDate).getTime()
    const e = new Date(form.endDate).getTime()
    if (Number.isNaN(s) || Number.isNaN(e) || e < s) return 0
    return Math.floor((e - s) / DAY_MS) + 1
  }, [form.startDate, form.endDate])

  async function save() {
    if (!companyId) return
    if (!form.employeeId) {
      toast({ title: "Eksik bilgi", description: "Personel seçin.", variant: "destructive" })
      return
    }
    setIsSaving(true)
    try {
      const res = await fetch("/api/personel/leaves", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, companyId }),
      })
      if (res.ok) {
        toast({ title: "İzin talebi oluşturuldu" })
        setCreateOpen(false)
        setForm(emptyForm())
        fetchLeaves()
      } else {
        const data = await res.json().catch(() => ({}))
        toast({ title: "Hata", description: data?.error || "Kaydedilemedi", variant: "destructive" })
      }
    } finally {
      setIsSaving(false)
    }
  }

  /**
   * Durum değişimi. Onayda sunucu, izne denk gelen vardiyaları 409 ile bildirir:
   * planlı olanlar kullanıcı onaylarsa silinir, damgalı olanlar korunur (fiilen
   * çalışılmış saat sonradan onaylanan bir izin yüzünden kaybolmamalı).
   */
  async function setStatus(l: Leave, status: string) {
    const send = (removeShifts: boolean) =>
      fetch(`/api/personel/leaves/${l.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, removeShifts }),
      })

    let res = await send(false)
    if (res.status === 409) {
      const data = await res.clone().json().catch(() => ({}))
      if (data.code === "SHIFTS") {
        const parts = [
          data.planned > 0 ? `${data.planned} planlı vardiya silinecek` : null,
          data.stamped > 0 ? `${data.stamped} damgalı vardiya korunacak` : null,
        ].filter(Boolean)
        const ok = await confirm({
          title: data.error || "İzin günlerinde vardiya var",
          description: `${parts.join(", ")}. İzin onaylansın mı?`,
          confirmLabel: "Onayla",
        })
        if (!ok) return
        res = await send(true)
      }
    }
    if (res.ok) {
      toast({ title: status === "APPROVED" ? "İzin onaylandı" : "İzin reddedildi" })
      fetchLeaves()
      fetchBalances()
    } else {
      const data = await res.json().catch(() => ({}))
      toast({ title: "Hata", description: data?.error || "Güncellenemedi", variant: "destructive" })
    }
  }

  async function remove(l: Leave) {
    if (!(await confirm({ title: "İzin kaydını sil", description: "Bu izin kaydını silmek istediğinize emin misiniz?", confirmLabel: "Sil", variant: "destructive" }))) return
    const res = await fetch(`/api/personel/leaves/${l.id}`, { method: "DELETE" })
    if (res.ok) {
      toast({ title: "İzin kaydı silindi" })
      fetchLeaves()
    } else {
      toast({ title: "Hata", description: "Silinemedi", variant: "destructive" })
    }
  }

  if (!companyId) return <div className="p-6 text-sm text-muted-foreground">Lütfen firma seçin.</div>

  const filtered = statusFilter === "ALL" ? leaves : leaves.filter((l) => l.status === statusFilter)
  const pendingCount = leaves.filter((l) => l.status === "PENDING").length
  const thisYear = new Date().getFullYear()
  const approvedDays = leaves
    .filter((l) => l.status === "APPROVED" && new Date(l.startDate).getFullYear() === thisYear)
    .reduce((s, l) => s + Number(l.days), 0)

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <Card><CardContent className="flex items-center gap-3 p-4"><div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"><CalendarCheck className="h-5 w-5" /></div><div><p className="text-xs text-muted-foreground">Bekleyen Talep</p><p className="text-xl font-bold">{pendingCount}</p></div></CardContent></Card>
        <Card><CardContent className="flex items-center gap-3 p-4"><div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"><CalendarCheck className="h-5 w-5" /></div><div><p className="text-xs text-muted-foreground">{thisYear} Onaylı İzin</p><p className="text-xl font-bold">{approvedDays} gün</p></div></CardContent></Card>
        <Card><CardContent className="flex items-center gap-3 p-4"><div className="flex h-10 w-10 items-center justify-center rounded-lg bg-kobipo-blue/10 text-kobipo-blue"><CalendarCheck className="h-5 w-5" /></div><div><p className="text-xs text-muted-foreground">Toplam Kayıt</p><p className="text-xl font-bold">{leaves.length}</p></div></CardContent></Card>
      </div>

      {showBalance && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><Scale className="h-5 w-5" /> Yıllık İzin Bakiyesi ({new Date().getFullYear()})</CardTitle>
          </CardHeader>
          <CardContent>
            {balances.length === 0 ? (
              <div className="text-sm text-muted-foreground">Aktif personel yok.</div>
            ) : (
              <StyledTableContainer>
                <Table>
                  <TableHeader>
                    <StyledTableHeaderRow>
                      <StyledTableHead>Personel</StyledTableHead>
                      <StyledTableHead>Departman</StyledTableHead>
                      <StyledTableHead className="text-center">Hak</StyledTableHead>
                      <StyledTableHead className="text-center">Kullanılan</StyledTableHead>
                      <StyledTableHead className="text-center">Kalan</StyledTableHead>
                    </StyledTableHeaderRow>
                  </TableHeader>
                  <TableBody>
                    {balances.map((b, idx) => (
                      <StyledTableRow key={b.employeeId} index={idx}>
                        <TableCell className="font-medium">{b.name}</TableCell>
                        <TableCell className="text-xs">{b.department || "—"}</TableCell>
                        <TableCell className="text-center">{b.entitlement}</TableCell>
                        <TableCell className="text-center">{b.used}</TableCell>
                        <TableCell className={`text-center font-semibold ${b.remaining < 0 ? "text-destructive" : b.remaining <= 3 ? "text-amber-600" : "text-emerald-600"}`}>{b.remaining}</TableCell>
                      </StyledTableRow>
                    ))}
                  </TableBody>
                </Table>
              </StyledTableContainer>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle>İzin & Devam</CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Tüm durumlar</SelectItem>
                  <SelectItem value="PENDING">Bekleyen</SelectItem>
                  <SelectItem value="APPROVED">Onaylanan</SelectItem>
                  <SelectItem value="REJECTED">Reddedilen</SelectItem>
                </SelectContent>
              </Select>
              <Button variant={showBalance ? "default" : "outline"} size="sm" onClick={toggleBalance}><Scale className="mr-1 h-4 w-4" /> İzin Bakiyesi</Button>
              <Button variant="outline" size="sm" onClick={fetchLeaves}><RefreshCcw className="mr-1 h-4 w-4" /> Yenile</Button>
              <Button size="sm" onClick={() => { setForm(emptyForm()); setCreateOpen(true) }}><Plus className="mr-1 h-4 w-4" /> Yeni İzin</Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading && <div className="text-sm text-muted-foreground">Yükleniyor…</div>}
          {!isLoading && leaves.length === 0 && <div className="text-sm text-muted-foreground">Henüz izin kaydı yok.</div>}
          {!isLoading && leaves.length > 0 && filtered.length === 0 && <div className="text-sm text-muted-foreground">Bu durumda kayıt yok.</div>}
          {!isLoading && filtered.length > 0 && (
            <StyledTableContainer>
              <Table>
                <TableHeader>
                  <StyledTableHeaderRow>
                    <StyledTableHead>Personel</StyledTableHead>
                    <StyledTableHead>Tür</StyledTableHead>
                    <StyledTableHead>Tarih</StyledTableHead>
                    <StyledTableHead className="text-center">Gün</StyledTableHead>
                    <StyledTableHead>Durum</StyledTableHead>
                    <StyledTableHead className="w-[160px] text-right">İşlem</StyledTableHead>
                  </StyledTableHeaderRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((l, idx) => (
                    <StyledTableRow key={l.id} index={idx}>
                      <TableCell>
                        <div className="font-medium">{l.employee.firstName} {l.employee.lastName}</div>
                        {l.reason && <div className="text-xs text-muted-foreground">{l.reason}</div>}
                      </TableCell>
                      <TableCell className="text-xs">{TYPE_LABELS[l.type] || l.type}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs">
                        {new Date(l.startDate).toLocaleDateString("tr-TR")} – {new Date(l.endDate).toLocaleDateString("tr-TR")}
                      </TableCell>
                      <TableCell className="text-center text-xs font-medium">{Number(l.days)}</TableCell>
                      <TableCell>
                        <Badge variant={l.status === "APPROVED" ? "default" : l.status === "REJECTED" ? "destructive" : "secondary"}>
                          {STATUS_LABELS[l.status] || l.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          {l.status !== "APPROVED" && (
                            <Button size="sm" variant="ghost" onClick={() => setStatus(l, "APPROVED")} title="Onayla">
                              <Check className="h-4 w-4 text-emerald-600" />
                            </Button>
                          )}
                          {l.status !== "REJECTED" && (
                            <Button size="sm" variant="ghost" onClick={() => setStatus(l, "REJECTED")} title="Reddet">
                              <X className="h-4 w-4 text-amber-600" />
                            </Button>
                          )}
                          <Button size="sm" variant="ghost" asChild title="İzin formu (PDF)">
                            <a href={`/api/personel/leaves/${l.id}/pdf`} target="_blank" rel="noopener noreferrer">
                              <FileText className="h-4 w-4 text-kobipo-blue" />
                            </a>
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => remove(l)} title="Sil">
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
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Yeni İzin Talebi</DialogTitle></DialogHeader>
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
            <div>
              <Label>İzin Türü</Label>
              <Select value={form.type} onValueChange={(v) => setForm((p) => ({ ...p, type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(TYPE_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Başlangıç</Label><Input type="date" value={form.startDate} onChange={(e) => setForm((p) => ({ ...p, startDate: e.target.value }))} /></div>
              <div><Label>Bitiş</Label><Input type="date" value={form.endDate} onChange={(e) => setForm((p) => ({ ...p, endDate: e.target.value }))} /></div>
            </div>
            <div><Label>Açıklama</Label><Input value={form.reason} onChange={(e) => setForm((p) => ({ ...p, reason: e.target.value }))} /></div>
            <div className="flex items-center justify-between rounded-md border bg-muted/30 p-3">
              <span className="text-sm text-muted-foreground">Toplam gün</span>
              <span className="text-lg font-bold">{liveDays}</span>
            </div>
            {form.type === "ANNUAL" && form.employeeId && (() => {
              const b = balances.find((x) => x.employeeId === form.employeeId)
              if (!b) return null
              const exceeds = liveDays > b.remaining
              return (
                <div className={`rounded-md border p-3 text-sm ${exceeds ? "border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-900/20" : "bg-muted/30"}`}>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Kalan yıllık izin</span>
                    <span className="font-semibold">{b.remaining} gün</span>
                  </div>
                  {exceeds && (
                    <div className="mt-1 flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
                      <AlertTriangle className="h-3.5 w-3.5" /> Bu talep kalan bakiyeyi aşıyor.
                    </div>
                  )}
                </div>
              )
            })()}
            <Button className="w-full" onClick={save} disabled={isSaving || employees.length === 0}>{isSaving ? "Kaydediliyor…" : "Kaydet"}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
