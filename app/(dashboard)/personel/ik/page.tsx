"use client"

import { WriteAction } from "@/components/dashboard/write-guard"
import { useCallback, useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
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
import { Plus, RefreshCcw, Trash2, FolderOpen, ExternalLink, FileDown } from "lucide-react"

type Employee = { id: string; firstName: string; lastName: string; status: string }
type Doc = {
  id: string
  employee: { id: string; firstName: string; lastName: string; department?: string | null }
  title: string
  category?: string | null
  fileUrl?: string | null
  storagePath?: string | null
  fileName?: string | null
  mimeType?: string | null
  fileSize?: number | null
  notes?: string | null
  createdAt: string
}

const CATEGORIES = ["Sözleşme", "Kimlik", "Diploma", "Sağlık Raporu", "İşe Giriş Formu", "Performans", "Diğer"]

const emptyForm = () => ({ employeeId: "", title: "", category: "", fileUrl: "", notes: "" })

function fmtSize(bytes?: number | null) {
  if (!bytes || bytes <= 0) return ""
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export default function InsanKaynaklariPage() {
  const searchParams = useSearchParams()
  const companyId = searchParams.get("company")
  const { toast } = useToast()
  const { confirm } = useConfirm()
  const [docs, setDocs] = useState<Doc[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [employeeFilter, setEmployeeFilter] = useState("ALL")
  const [createOpen, setCreateOpen] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [form, setForm] = useState(emptyForm())
  const [files, setFiles] = useState<File[]>([])

  const fetchDocs = useCallback(async () => {
    if (!companyId) return
    setIsLoading(true)
    try {
      const res = await fetch(`/api/personel/documents?companyId=${companyId}`)
      if (res.ok) setDocs(await res.json())
    } finally {
      setIsLoading(false)
    }
  }, [companyId])

  const fetchEmployees = useCallback(async () => {
    if (!companyId) return
    const res = await fetch(`/api/personel/employees?companyId=${companyId}`)
    if (res.ok) setEmployees(await res.json())
  }, [companyId])

  useEffect(() => { fetchDocs() }, [fetchDocs])
  useEffect(() => { fetchEmployees() }, [fetchEmployees])

  async function save() {
    if (!companyId) return
    if (!form.employeeId) {
      toast({ title: "Eksik bilgi", description: "Personel seçin.", variant: "destructive" })
      return
    }
    if (files.length === 0 && !form.title.trim()) {
      toast({ title: "Eksik bilgi", description: "Belge başlığı girin veya dosya seçin.", variant: "destructive" })
      return
    }
    if (files.some((f) => f.size > 10 * 1024 * 1024)) {
      toast({ title: "Dosya çok büyük", description: "Her dosya en fazla 10 MB olmalı.", variant: "destructive" })
      return
    }
    setIsSaving(true)
    try {
      // Dosya yüklemeyi desteklemek için multipart/form-data gönderiyoruz.
      const fd = new FormData()
      fd.append("companyId", companyId)
      fd.append("employeeId", form.employeeId)
      fd.append("title", form.title)
      fd.append("category", form.category)
      fd.append("notes", form.notes)
      fd.append("fileUrl", form.fileUrl)
      files.forEach((f) => fd.append("file", f))
      const res = await fetch("/api/personel/documents", { method: "POST", body: fd })
      if (res.ok) {
        const created = await res.json().catch(() => [])
        toast({ title: Array.isArray(created) && created.length > 1 ? `${created.length} belge eklendi` : "Belge eklendi" })
        setCreateOpen(false)
        setForm(emptyForm())
        setFiles([])
        fetchDocs()
      } else {
        const data = await res.json().catch(() => ({}))
        toast({ title: "Hata", description: data?.error || "Kaydedilemedi", variant: "destructive" })
      }
    } finally {
      setIsSaving(false)
    }
  }

  async function remove(d: Doc) {
    if (!(await confirm({ title: "Belgeyi sil", description: "Bu belgeyi silmek istediğinize emin misiniz?", confirmLabel: "Sil", variant: "destructive" }))) return
    const res = await fetch(`/api/personel/documents/${d.id}`, { method: "DELETE" })
    if (res.ok) {
      toast({ title: "Belge silindi" })
      fetchDocs()
    } else {
      toast({ title: "Hata", description: "Silinemedi", variant: "destructive" })
    }
  }

  if (!companyId) return <div className="p-6 text-sm text-muted-foreground">Lütfen firma seçin.</div>

  const filtered = employeeFilter === "ALL" ? docs : docs.filter((d) => d.employee.id === employeeFilter)
  const employeesWithDocs = new Set(docs.map((d) => d.employee.id)).size

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <Card><CardContent className="flex items-center gap-3 p-4"><div className="flex h-10 w-10 items-center justify-center rounded-lg bg-kobipo-blue/10 text-kobipo-blue"><FolderOpen className="h-5 w-5" /></div><div><p className="text-xs text-muted-foreground">Toplam Belge</p><p className="text-xl font-bold">{docs.length}</p></div></CardContent></Card>
        <Card><CardContent className="flex items-center gap-3 p-4"><div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"><FolderOpen className="h-5 w-5" /></div><div><p className="text-xs text-muted-foreground">Belgeli Personel</p><p className="text-xl font-bold">{employeesWithDocs}</p></div></CardContent></Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2"><FolderOpen className="h-5 w-5" /> Personel Belge Dolabı</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">Sözleşme, kimlik, diploma, form ve diğer belgeleri personel bazında arşivleyin.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Select value={employeeFilter} onValueChange={setEmployeeFilter}>
                <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Tüm personel</SelectItem>
                  {employees.map((e) => <SelectItem key={e.id} value={e.id}>{e.firstName} {e.lastName}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" onClick={fetchDocs}><RefreshCcw className="mr-1 h-4 w-4" /> Yenile</Button>
              <WriteAction><Button size="sm" onClick={() => { setForm(emptyForm()); setFiles([]); setCreateOpen(true) }}><Plus className="mr-1 h-4 w-4" /> Yeni Belge</Button></WriteAction>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading && <div className="text-sm text-muted-foreground">Yükleniyor…</div>}
          {!isLoading && docs.length === 0 && <div className="text-sm text-muted-foreground">Henüz belge yok.</div>}
          {!isLoading && docs.length > 0 && filtered.length === 0 && <div className="text-sm text-muted-foreground">Bu personele ait belge yok.</div>}
          {!isLoading && filtered.length > 0 && (
            <StyledTableContainer>
              <Table>
                <TableHeader>
                  <StyledTableHeaderRow>
                    <StyledTableHead>Personel</StyledTableHead>
                    <StyledTableHead>Belge</StyledTableHead>
                    <StyledTableHead>Kategori</StyledTableHead>
                    <StyledTableHead>Tarih</StyledTableHead>
                    <StyledTableHead className="w-[120px] text-center">Dosya</StyledTableHead>
                    <StyledTableHead className="w-[60px] text-right">İşlem</StyledTableHead>
                  </StyledTableHeaderRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((d, idx) => (
                    <StyledTableRow key={d.id} index={idx}>
                      <TableCell className="font-medium">{d.employee.firstName} {d.employee.lastName}</TableCell>
                      <TableCell>
                        <div className="text-sm">{d.title}</div>
                        {d.notes && <div className="text-xs text-muted-foreground">{d.notes}</div>}
                      </TableCell>
                      <TableCell className="text-xs">{d.category || "—"}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs">{new Date(d.createdAt).toLocaleDateString("tr-TR")}</TableCell>
                      <TableCell className="text-center">
                        {d.fileName ? (
                          <a
                            href={`/api/personel/documents/${d.id}/download`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-kobipo-blue hover:underline"
                            title={d.fileName || "İndir"}
                          >
                            <FileDown className="h-4 w-4 shrink-0" />
                            <span className="max-w-[90px] truncate">{fmtSize(d.fileSize) || "İndir"}</span>
                          </a>
                        ) : d.fileUrl ? (
                          <a href={d.fileUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-kobipo-blue hover:underline">
                            <ExternalLink className="h-4 w-4" /> Link
                          </a>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end">
                          <WriteAction><Button size="sm" variant="ghost" onClick={() => remove(d)} title="Sil">
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button></WriteAction>
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
          <DialogHeader><DialogTitle>Yeni Belge</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Personel *</Label>
              {employees.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Personel yok. Önce <Link href={`/personel?company=${companyId}`} className="text-kobipo-blue hover:underline">Personeller</Link> sayfasından ekleyin.
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
            <div><Label>Belge Başlığı {files.length > 1 ? "(çoklu dosyada opsiyonel)" : files.length === 1 ? "(opsiyonel)" : "*"}</Label><Input value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} placeholder="İş sözleşmesi" /></div>
            <div>
              <Label>Kategori</Label>
              <Select value={form.category || "__none__"} onValueChange={(v) => setForm((p) => ({ ...p, category: v === "__none__" ? "" : v }))}>
                <SelectTrigger><SelectValue placeholder="Kategori seçin" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">—</SelectItem>
                  {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Dosya Yükle (birden çok seçilebilir — PDF, DOCX, Excel, resim…)</Label>
              <Input
                type="file"
                multiple
                accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.png,.jpg,.jpeg,.webp,.gif,.txt,.csv"
                onChange={(e) => setFiles(e.target.files ? Array.from(e.target.files) : [])}
              />
              {files.length > 0 && (
                <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                  {files.map((f, i) => <li key={i}>• {f.name} · {fmtSize(f.size)}</li>)}
                </ul>
              )}
            </div>
            <div>
              <Label>veya Dış Bağlantı (opsiyonel)</Label>
              <Input value={form.fileUrl} onChange={(e) => setForm((p) => ({ ...p, fileUrl: e.target.value }))} placeholder="https://…" disabled={files.length > 0} />
            </div>
            <div><Label>Not</Label><Input value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} /></div>
            <WriteAction><Button className="w-full" onClick={save} disabled={isSaving}>{isSaving ? "Kaydediliyor…" : "Kaydet"}</Button></WriteAction>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
