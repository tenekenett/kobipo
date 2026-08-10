"use client"

import { useCallback, useEffect, useState } from "react"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { looksLikeCuid } from "@/lib/slug"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { EmployeeAccountCard } from "@/components/personel/employee-account-card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Table, TableBody, TableCell, TableHeader } from "@/components/ui/table"
import {
  StyledTableContainer,
  StyledTableHeaderRow,
  StyledTableHead,
  StyledTableRow,
} from "@/components/ui/styled-table"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useToast } from "@/components/ui/use-toast"
import { useConfirm } from "@/components/ui/confirm-dialog-provider"
import {
  EmployeeRestoranTab,
  useRestoranActivity,
} from "@/components/personel/employee-restoran-tab"
import { EmployeeVardiyaTab } from "@/components/personel/employee-vardiya-tab"
import { ArrowLeft, FileText, FileDown, ExternalLink, Plus, Pencil, Trash2, Wallet, CalendarCheck, BadgeCheck, FolderOpen } from "lucide-react"

type Employee = {
  id: string
  slug?: string
  firstName: string
  lastName: string
  nationalId?: string | null
  email?: string | null
  phone?: string | null
  birthDate?: string | null
  department?: string | null
  position?: string | null
  hireDate?: string | null
  terminationDate?: string | null
  grossSalary?: number | null
  iban?: string | null
  address?: string | null
  emergencyContact?: string | null
  annualLeaveDays?: number | null
  status: string
  notes?: string | null
  /** Bağlı Kobipo hesabı; yetkiler burada DEĞİL, Ekip Yönetimi'nde yaşar. */
  userId?: string | null
  user?: { id: string; name?: string | null; email: string } | null
  payrolls: Array<{ id: string; periodYear: number; periodMonth: number; grossSalary: number; netSalary: number; status: string; paymentDate?: string | null }>
  leaves: Array<{ id: string; type: string; startDate: string; endDate: string; days: number; status: string }>
  assets: Array<{ id: string; assetName: string; category?: string | null; serialNo?: string | null; quantity: number; assignedDate: string; status: string }>
  documents: Array<{ id: string; title: string; category?: string | null; storagePath?: string | null; fileUrl?: string | null; fileName?: string | null; fileSize?: number | null; createdAt: string }>
}

const STATUS = {
  ACTIVE: { label: "Aktif", variant: "default" as const },
  ON_LEAVE: { label: "İzinde", variant: "secondary" as const },
  TERMINATED: { label: "Ayrıldı", variant: "destructive" as const },
}
const LEAVE_TYPES: Record<string, string> = { ANNUAL: "Yıllık", EXCUSE: "Mazeret", SICK: "Hastalık", UNPAID: "Ücretsiz" }
const MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"]
const money = (n?: number | null) => (n != null ? `${Number(n).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₺` : "—")
const date = (d?: string | null) => (d ? new Date(d).toLocaleDateString("tr-TR") : "—")
const fmtSize = (b?: number | null) => (!b || b <= 0 ? "" : b < 1024 * 1024 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`)
const DOC_CATEGORIES = ["Sözleşme", "Kimlik", "Diploma", "Sağlık Raporu", "İşe Giriş Formu", "Performans", "Diğer"]
const emptyEditForm = () => ({ firstName: "", lastName: "", nationalId: "", phone: "", email: "", department: "", position: "", hireDate: "", grossSalary: "", iban: "", annualLeaveDays: "14", address: "", emergencyContact: "", notes: "" })

function tenure(hireDate?: string | null): string {
  if (!hireDate) return "—"
  const start = new Date(hireDate)
  const now = new Date()
  if (Number.isNaN(start.getTime())) return "—"
  let months = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth())
  if (now.getDate() < start.getDate()) months -= 1
  if (months < 0) return "—"
  const y = Math.floor(months / 12)
  const m = months % 12
  return `${y > 0 ? `${y} yıl ` : ""}${m} ay`
}

function StatTile({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-xl font-bold">{value}</p>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  )
}

function Field({ label, value }: { label: string; value?: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-medium">{value || "—"}</p>
    </div>
  )
}

export default function PersonelDetayPage() {
  const params = useParams<{ id: string }>()
  const searchParams = useSearchParams()
  const router = useRouter()
  const { toast } = useToast()
  const { confirm } = useConfirm()
  const companyId = searchParams.get("company")
  const id = params.id
  const [emp, setEmp] = useState<Employee | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  // Restoran aktivitesi (uygulanan iskontolar). Route param'ı verilir: uç slug'ı
  // da çözüyor, böylece personel kaydını beklemeye gerek kalmıyor.
  const { data: restoran } = useRestoranActivity(id, companyId)

  // Düzenle diyaloğu
  const [editOpen, setEditOpen] = useState(false)
  const [editSaving, setEditSaving] = useState(false)
  const [editForm, setEditForm] = useState(emptyEditForm())

  // Belge ekle diyaloğu (çoklu dosya)
  const [docOpen, setDocOpen] = useState(false)
  const [docSaving, setDocSaving] = useState(false)
  const [docForm, setDocForm] = useState({ title: "", category: "", notes: "" })
  const [docFiles, setDocFiles] = useState<File[]>([])

  // Bordro / İzin / Zimmet ekleme diyalogları (bu personele özel)
  const today = new Date().toISOString().split("T")[0]
  const [payOpen, setPayOpen] = useState(false)
  const [paySaving, setPaySaving] = useState(false)
  const [payForm, setPayForm] = useState({ periodYear: new Date().getFullYear(), periodMonth: new Date().getMonth() + 1, grossSalary: "", bonus: "", advance: "", sgkDeduction: "", taxDeduction: "", otherDeduction: "", notes: "" })
  const [leaveOpen, setLeaveOpen] = useState(false)
  const [leaveSaving, setLeaveSaving] = useState(false)
  const [leaveForm, setLeaveForm] = useState({ type: "ANNUAL", startDate: today, endDate: today, reason: "" })
  const [assetOpen, setAssetOpen] = useState(false)
  const [assetSaving, setAssetSaving] = useState(false)
  const [assetForm, setAssetForm] = useState({ assetName: "", category: "", serialNo: "", quantity: "1", assignedDate: today, notes: "" })

  const fetchEmp = useCallback(async () => {
    setIsLoading(true)
    try {
      const res = await fetch(`/api/personel/employees/${id}${companyId ? `?companyId=${companyId}` : ""}`)
      if (res.ok) {
        const data = await res.json()
        setEmp(data)
        // SEF: eski cuid URL ile gelindiyse okunabilir slug URL'ine sessizce yükselt.
        if (data?.slug && looksLikeCuid(String(id))) {
          router.replace(`/personel/${data.slug}?company=${companyId}`)
        }
      } else setEmp(null)
    } finally {
      setIsLoading(false)
    }
  }, [id, companyId, router])

  useEffect(() => { fetchEmp() }, [fetchEmp])

  function openEdit() {
    if (!emp) return
    setEditForm({
      firstName: emp.firstName || "", lastName: emp.lastName || "", nationalId: emp.nationalId || "",
      phone: emp.phone || "", email: emp.email || "", department: emp.department || "", position: emp.position || "",
      hireDate: emp.hireDate ? emp.hireDate.split("T")[0] : "", grossSalary: emp.grossSalary != null ? String(emp.grossSalary) : "",
      iban: emp.iban || "", annualLeaveDays: emp.annualLeaveDays != null ? String(emp.annualLeaveDays) : "14",
      address: emp.address || "", emergencyContact: emp.emergencyContact || "", notes: emp.notes || "",
    })
    setEditOpen(true)
  }

  async function saveEdit() {
    if (!editForm.firstName.trim() || !editForm.lastName.trim()) {
      toast({ title: "Eksik bilgi", description: "Ad ve soyad zorunlu.", variant: "destructive" })
      return
    }
    setEditSaving(true)
    try {
      const res = await fetch(`/api/personel/employees/${id}${companyId ? `?companyId=${companyId}` : ""}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...editForm, grossSalary: editForm.grossSalary || null }),
      })
      if (res.ok) {
        toast({ title: "Personel güncellendi" })
        setEditOpen(false)
        fetchEmp()
      } else {
        const data = await res.json().catch(() => ({}))
        toast({ title: "Hata", description: data?.error || "Güncellenemedi", variant: "destructive" })
      }
    } finally {
      setEditSaving(false)
    }
  }

  async function saveDoc() {
    if (!companyId) return
    if (docFiles.length === 0 && !docForm.title.trim()) {
      toast({ title: "Eksik bilgi", description: "Başlık girin veya dosya seçin.", variant: "destructive" })
      return
    }
    if (docFiles.some((f) => f.size > 10 * 1024 * 1024)) {
      toast({ title: "Dosya çok büyük", description: "Her dosya en fazla 10 MB.", variant: "destructive" })
      return
    }
    setDocSaving(true)
    try {
      const fd = new FormData()
      fd.append("companyId", companyId)
      fd.append("employeeId", id)
      fd.append("title", docForm.title)
      fd.append("category", docForm.category)
      fd.append("notes", docForm.notes)
      docFiles.forEach((f) => fd.append("file", f))
      const res = await fetch("/api/personel/documents", { method: "POST", body: fd })
      if (res.ok) {
        const created = await res.json().catch(() => [])
        toast({ title: Array.isArray(created) && created.length > 1 ? `${created.length} belge eklendi` : "Belge eklendi" })
        setDocOpen(false)
        setDocForm({ title: "", category: "", notes: "" })
        setDocFiles([])
        fetchEmp()
      } else {
        const data = await res.json().catch(() => ({}))
        toast({ title: "Hata", description: data?.error || "Eklenemedi", variant: "destructive" })
      }
    } finally {
      setDocSaving(false)
    }
  }

  async function removeDoc(docId: string) {
    if (!(await confirm({ title: "Belgeyi sil", description: "Bu belgeyi silmek istediğinize emin misiniz?", confirmLabel: "Sil", variant: "destructive" }))) return
    const res = await fetch(`/api/personel/documents/${docId}`, { method: "DELETE" })
    if (res.ok) {
      toast({ title: "Belge silindi" })
      fetchEmp()
    } else {
      toast({ title: "Hata", description: "Silinemedi", variant: "destructive" })
    }
  }

  function openPayroll() {
    setPayForm({ periodYear: new Date().getFullYear(), periodMonth: new Date().getMonth() + 1, grossSalary: emp?.grossSalary != null ? String(emp.grossSalary) : "", bonus: "", advance: "", sgkDeduction: "", taxDeduction: "", otherDeduction: "", notes: "" })
    setPayOpen(true)
  }

  async function genericCreate(url: string, body: any, okMsg: string, setSaving: (v: boolean) => void, close: () => void) {
    if (!companyId) return
    setSaving(true)
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, companyId, employeeId: id }),
      })
      if (res.ok) {
        toast({ title: okMsg })
        close()
        fetchEmp()
      } else {
        const data = await res.json().catch(() => ({}))
        toast({ title: "Hata", description: data?.error || "Kaydedilemedi", variant: "destructive" })
      }
    } finally {
      setSaving(false)
    }
  }

  async function savePayroll() {
    await genericCreate("/api/personel/payroll", payForm, "Bordro oluşturuldu", setPaySaving, () => setPayOpen(false))
  }
  async function saveLeave() {
    if (!leaveForm.startDate || !leaveForm.endDate) {
      toast({ title: "Eksik bilgi", description: "Tarih girin.", variant: "destructive" })
      return
    }
    await genericCreate("/api/personel/leaves", leaveForm, "İzin oluşturuldu", setLeaveSaving, () => setLeaveOpen(false))
  }
  async function saveAsset() {
    if (!assetForm.assetName.trim()) {
      toast({ title: "Eksik bilgi", description: "Demirbaş adı zorunlu.", variant: "destructive" })
      return
    }
    await genericCreate("/api/personel/assets", assetForm, "Zimmet kaydedildi", setAssetSaving, () => setAssetOpen(false))
  }

  const payNet = (() => {
    const n = (v: string | number) => Number(v || 0)
    return n(payForm.grossSalary) + n(payForm.bonus) - n(payForm.advance) - n(payForm.sgkDeduction) - n(payForm.taxDeduction) - n(payForm.otherDeduction)
  })()

  const backHref = `/personel${companyId ? `?company=${encodeURIComponent(companyId)}` : ""}`

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Yükleniyor…</div>
  if (!emp) return (
    <div className="p-6">
      <Link href={backHref} className="text-sm text-kobipo-blue hover:underline">← Personellere dön</Link>
      <p className="mt-4 text-sm text-muted-foreground">Personel bulunamadı.</p>
    </div>
  )

  const thisYear = new Date().getFullYear()
  const usedAnnual = emp.leaves
    .filter((l) => l.type === "ANNUAL" && l.status === "APPROVED" && new Date(l.startDate).getFullYear() === thisYear)
    .reduce((s, l) => s + Number(l.days), 0)
  const entitlement = emp.annualLeaveDays ?? 14
  const remaining = entitlement - usedAnnual

  const paidPayrolls = emp.payrolls.filter((p) => p.status === "PAID")
  const lastPaid = [...paidPayrolls].sort(
    (a, b) => new Date(b.paymentDate || 0).getTime() - new Date(a.paymentDate || 0).getTime(),
  )[0]
  const paidThisYear = paidPayrolls.filter((p) => p.periodYear === thisYear).reduce((s, p) => s + Number(p.netSalary), 0)
  const pendingPayrolls = emp.payrolls.filter((p) => p.status === "PENDING").length
  const activeAssets = emp.assets.filter((a) => a.status === "ASSIGNED").length
  const pendingLeaves = emp.leaves.filter((l) => l.status === "PENDING").length

  // Son hareketler — bordro/izin/zimmet/belge olaylarını kronolojik birleştir.
  type Activity = { date: Date; icon: typeof Wallet; text: string; tone: string }
  const activities: Activity[] = []
  for (const p of emp.payrolls) {
    activities.push({
      date: p.paymentDate ? new Date(p.paymentDate) : new Date(p.periodYear, p.periodMonth - 1, 1),
      icon: Wallet, tone: "text-emerald-600",
      text: `Bordro ${MONTHS[p.periodMonth - 1]} ${p.periodYear} — ${money(Number(p.netSalary))} (${p.status === "PAID" ? "ödendi" : "bekliyor"})`,
    })
  }
  for (const l of emp.leaves) {
    activities.push({
      date: new Date(l.startDate), icon: CalendarCheck, tone: "text-amber-600",
      text: `${LEAVE_TYPES[l.type] || l.type} izni — ${Number(l.days)} gün (${l.status === "APPROVED" ? "onaylı" : l.status === "REJECTED" ? "reddedildi" : "bekliyor"})`,
    })
  }
  for (const a of emp.assets) {
    activities.push({
      date: new Date(a.assignedDate), icon: BadgeCheck, tone: "text-kobipo-blue",
      text: `Zimmet: ${a.assetName}${a.status === "RETURNED" ? " (iade edildi)" : ""}`,
    })
  }
  for (const d of emp.documents) {
    activities.push({ date: new Date(d.createdAt), icon: FolderOpen, tone: "text-muted-foreground", text: `Belge: ${d.title}` })
  }
  const recentActivities = activities.sort((a, b) => b.date.getTime() - a.date.getTime()).slice(0, 10)

  return (
    <div className="space-y-6">
      <div>
        <Link href={backHref} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Personeller
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-kobipo-blue/10 text-lg font-bold text-kobipo-blue">
          {emp.firstName[0]}{emp.lastName[0]}
        </div>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">{emp.firstName} {emp.lastName}</h1>
          <p className="text-sm text-muted-foreground">{[emp.position, emp.department].filter(Boolean).join(" · ") || "—"}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={STATUS[emp.status as keyof typeof STATUS]?.variant || "secondary"}>
            {STATUS[emp.status as keyof typeof STATUS]?.label || emp.status}
          </Badge>
          <Button size="sm" variant="outline" onClick={openEdit}><Pencil className="mr-1 h-4 w-4" /> Düzenle</Button>
        </div>
      </div>

      <Tabs defaultValue="ozet">
        <TabsList className="flex-wrap">
          <TabsTrigger value="ozet">Özet</TabsTrigger>
          <TabsTrigger value="bordro">Bordro ({emp.payrolls.length})</TabsTrigger>
          <TabsTrigger value="vardiya">Vardiya</TabsTrigger>
          <TabsTrigger value="izin">İzin ({emp.leaves.length})</TabsTrigger>
          <TabsTrigger value="zimmet">Zimmet ({emp.assets.length})</TabsTrigger>
          <TabsTrigger value="belge">Belgeler ({emp.documents.length})</TabsTrigger>
          {/* Restoran modülü kapalıysa sekme hiç çizilmez — İK ekranı
              kullanılmayan bir modülün boş tablosunu göstermemeli. */}
          {restoran?.enabled && (
            <TabsTrigger value="restoran">
              Restoran ({restoran.summary?.count ?? 0})
            </TabsTrigger>
          )}
        </TabsList>

        {/* ÖZET */}
        <TabsContent value="ozet" className="space-y-6">
          {/* Hızlı istatistikler */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile label="Kıdem" value={tenure(emp.hireDate)} sub={emp.hireDate ? `Giriş: ${date(emp.hireDate)}` : undefined} />
            <StatTile label={`${thisYear} Ödenen Net`} value={`${money(paidThisYear)}`} sub={`${paidPayrolls.filter((p) => p.periodYear === thisYear).length} ödeme`} />
            <StatTile label="Aktif Zimmet" value={activeAssets} sub={`${emp.assets.length} toplam kayıt`} />
            <StatTile label="Bekleyen İzin" value={pendingLeaves} sub={`${pendingPayrolls} bekleyen bordro`} />
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <div className="space-y-6 lg:col-span-2">
            <Card>
              <CardHeader><CardTitle className="text-base">Kişisel & İş Bilgileri</CardTitle></CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-3">
                <Field label="T.C. Kimlik No" value={emp.nationalId} />
                <Field label="Telefon" value={emp.phone} />
                <Field label="E-posta" value={emp.email} />
                <Field label="Doğum Tarihi" value={date(emp.birthDate)} />
                <Field label="İşe Giriş" value={date(emp.hireDate)} />
                <Field label="Çıkış Tarihi" value={date(emp.terminationDate)} />
                <Field label="Departman" value={emp.department} />
                <Field label="Görev" value={emp.position} />
                <Field label="Brüt Maaş" value={money(emp.grossSalary)} />
                <Field label="IBAN" value={emp.iban} />
                <Field label="Acil Durum" value={emp.emergencyContact} />
                <Field label="Adres" value={emp.address} />
              </CardContent>
              {emp.notes && (
                <CardContent className="border-t pt-4">
                  <p className="text-xs text-muted-foreground">Not</p>
                  <p className="text-sm">{emp.notes}</p>
                </CardContent>
              )}
            </Card>

            <EmployeeAccountCard
              employeeId={emp.slug || emp.id}
              companyId={companyId}
              linkedUser={emp.user}
              onChanged={fetchEmp}
            />
            </div>

            <div className="space-y-6">
              {/* Maaş özeti */}
              <Card>
                <CardHeader><CardTitle className="text-base">Maaş Özeti</CardTitle></CardHeader>
                <CardContent className="space-y-2 text-sm">
                  {lastPaid ? (
                    <>
                      <div className="flex justify-between"><span className="text-muted-foreground">Son ödeme dönemi</span><span className="font-medium">{MONTHS[lastPaid.periodMonth - 1]} {lastPaid.periodYear}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Ödeme tarihi</span><span className="font-medium">{date(lastPaid.paymentDate)}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Net tutar</span><span className="font-semibold text-emerald-600">{money(Number(lastPaid.netSalary))}</span></div>
                      <div className="border-t pt-2">
                        <a href={`/api/personel/payroll/${lastPaid.id}/pdf`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-kobipo-blue hover:underline">
                          <FileText className="h-3.5 w-3.5" /> Son maaş pusulası (PDF)
                        </a>
                      </div>
                    </>
                  ) : (
                    <p className="text-muted-foreground">Henüz ödenmiş maaş yok.{pendingPayrolls > 0 ? ` ${pendingPayrolls} bekleyen bordro var.` : ""}</p>
                  )}
                </CardContent>
              </Card>

              {/* Yıllık izin */}
              <Card>
                <CardHeader><CardTitle className="text-base">Yıllık İzin ({thisYear})</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-end justify-between">
                    <span className="text-sm text-muted-foreground">Kalan</span>
                    <span className={`text-3xl font-bold ${remaining < 0 ? "text-destructive" : remaining <= 3 ? "text-amber-600" : "text-emerald-600"}`}>{remaining}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div className="h-full bg-kobipo-blue" style={{ width: `${Math.min(100, (usedAnnual / Math.max(1, entitlement)) * 100)}%` }} />
                  </div>
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Hak: {entitlement} gün</span>
                    <span>Kullanılan: {usedAnnual} gün</span>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>

          {/* Son hareketler */}
          <Card>
            <CardHeader><CardTitle className="text-base">Son Hareketler</CardTitle></CardHeader>
            <CardContent>
              {recentActivities.length === 0 ? (
                <div className="text-sm text-muted-foreground">Henüz hareket yok.</div>
              ) : (
                <ul className="space-y-3">
                  {recentActivities.map((a, i) => {
                    const Icon = a.icon
                    return (
                      <li key={i} className="flex items-start gap-3">
                        <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted ${a.tone}`}>
                          <Icon className="h-4 w-4" />
                        </div>
                        <div className="flex-1 text-sm">{a.text}</div>
                        <div className="whitespace-nowrap text-xs text-muted-foreground">{a.date.toLocaleDateString("tr-TR")}</div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* BORDRO */}
        <TabsContent value="bordro">
          <Card>
            <CardHeader><div className="flex items-center justify-between"><CardTitle className="text-base">Bordro</CardTitle><Button size="sm" onClick={openPayroll}><Plus className="mr-1 h-4 w-4" /> Bordro Ekle</Button></div></CardHeader>
            <CardContent>
            {emp.payrolls.length === 0 ? <div className="text-sm text-muted-foreground">Bordro kaydı yok.</div> : (
              <StyledTableContainer><Table>
                <TableHeader><StyledTableHeaderRow>
                  <StyledTableHead>Dönem</StyledTableHead>
                  <StyledTableHead className="text-right">Brüt</StyledTableHead>
                  <StyledTableHead className="text-right">Net</StyledTableHead>
                  <StyledTableHead>Durum</StyledTableHead>
                  <StyledTableHead className="w-[60px] text-right">PDF</StyledTableHead>
                </StyledTableHeaderRow></TableHeader>
                <TableBody>
                  {emp.payrolls.map((p, idx) => (
                    <StyledTableRow key={p.id} index={idx}>
                      <TableCell>{MONTHS[p.periodMonth - 1]} {p.periodYear}</TableCell>
                      <TableCell className="text-right">{money(Number(p.grossSalary))}</TableCell>
                      <TableCell className="text-right font-semibold">{money(Number(p.netSalary))}</TableCell>
                      <TableCell><Badge variant={p.status === "PAID" ? "default" : "secondary"}>{p.status === "PAID" ? "Ödendi" : "Bekliyor"}</Badge></TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="ghost" asChild title="Maaş pusulası">
                          <a href={`/api/personel/payroll/${p.id}/pdf`} target="_blank" rel="noopener noreferrer"><FileText className="h-4 w-4 text-kobipo-blue" /></a>
                        </Button>
                      </TableCell>
                    </StyledTableRow>
                  ))}
                </TableBody>
              </Table></StyledTableContainer>
            )}
          </CardContent></Card>
        </TabsContent>

        {/* İZİN */}
        <TabsContent value="izin">
          <Card>
            <CardHeader><div className="flex items-center justify-between"><CardTitle className="text-base">İzin</CardTitle><Button size="sm" onClick={() => { setLeaveForm({ type: "ANNUAL", startDate: today, endDate: today, reason: "" }); setLeaveOpen(true) }}><Plus className="mr-1 h-4 w-4" /> İzin Ekle</Button></div></CardHeader>
            <CardContent>
            {emp.leaves.length === 0 ? <div className="text-sm text-muted-foreground">İzin kaydı yok.</div> : (
              <StyledTableContainer><Table>
                <TableHeader><StyledTableHeaderRow>
                  <StyledTableHead>Tür</StyledTableHead>
                  <StyledTableHead>Tarih</StyledTableHead>
                  <StyledTableHead className="text-center">Gün</StyledTableHead>
                  <StyledTableHead>Durum</StyledTableHead>
                  <StyledTableHead className="w-[60px] text-right">PDF</StyledTableHead>
                </StyledTableHeaderRow></TableHeader>
                <TableBody>
                  {emp.leaves.map((l, idx) => (
                    <StyledTableRow key={l.id} index={idx}>
                      <TableCell>{LEAVE_TYPES[l.type] || l.type}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs">{date(l.startDate)} – {date(l.endDate)}</TableCell>
                      <TableCell className="text-center">{Number(l.days)}</TableCell>
                      <TableCell><Badge variant={l.status === "APPROVED" ? "default" : l.status === "REJECTED" ? "destructive" : "secondary"}>{l.status === "APPROVED" ? "Onaylı" : l.status === "REJECTED" ? "Red" : "Bekliyor"}</Badge></TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="ghost" asChild title="İzin formu">
                          <a href={`/api/personel/leaves/${l.id}/pdf`} target="_blank" rel="noopener noreferrer"><FileText className="h-4 w-4 text-kobipo-blue" /></a>
                        </Button>
                      </TableCell>
                    </StyledTableRow>
                  ))}
                </TableBody>
              </Table></StyledTableContainer>
            )}
          </CardContent></Card>
        </TabsContent>

        {/* ZİMMET */}
        <TabsContent value="zimmet">
          <Card>
            <CardHeader><div className="flex items-center justify-between"><CardTitle className="text-base">Zimmet</CardTitle><Button size="sm" onClick={() => { setAssetForm({ assetName: "", category: "", serialNo: "", quantity: "1", assignedDate: today, notes: "" }); setAssetOpen(true) }}><Plus className="mr-1 h-4 w-4" /> Zimmet Ekle</Button></div></CardHeader>
            <CardContent>
            {emp.assets.length === 0 ? <div className="text-sm text-muted-foreground">Zimmet kaydı yok.</div> : (
              <StyledTableContainer><Table>
                <TableHeader><StyledTableHeaderRow>
                  <StyledTableHead>Demirbaş</StyledTableHead>
                  <StyledTableHead>Seri No</StyledTableHead>
                  <StyledTableHead className="text-center">Adet</StyledTableHead>
                  <StyledTableHead>Tarih</StyledTableHead>
                  <StyledTableHead>Durum</StyledTableHead>
                  <StyledTableHead className="w-[60px] text-right">PDF</StyledTableHead>
                </StyledTableHeaderRow></TableHeader>
                <TableBody>
                  {emp.assets.map((a, idx) => (
                    <StyledTableRow key={a.id} index={idx}>
                      <TableCell>{a.assetName}{a.category ? <span className="text-xs text-muted-foreground"> · {a.category}</span> : null}</TableCell>
                      <TableCell className="text-xs font-mono">{a.serialNo || "—"}</TableCell>
                      <TableCell className="text-center">{a.quantity}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs">{date(a.assignedDate)}</TableCell>
                      <TableCell><Badge variant={a.status === "RETURNED" ? "outline" : "default"}>{a.status === "RETURNED" ? "İade" : "Zimmetli"}</Badge></TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="ghost" asChild title="Zimmet formu">
                          <a href={`/api/personel/assets/${a.id}/pdf`} target="_blank" rel="noopener noreferrer"><FileText className="h-4 w-4 text-kobipo-blue" /></a>
                        </Button>
                      </TableCell>
                    </StyledTableRow>
                  ))}
                </TableBody>
              </Table></StyledTableContainer>
            )}
          </CardContent></Card>
        </TabsContent>

        {/* BELGELER */}
        <TabsContent value="belge">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Belgeler</CardTitle>
                <Button size="sm" onClick={() => { setDocForm({ title: "", category: "", notes: "" }); setDocFiles([]); setDocOpen(true) }}>
                  <Plus className="mr-1 h-4 w-4" /> Belge Ekle
                </Button>
              </div>
            </CardHeader>
            <CardContent>
            {emp.documents.length === 0 ? <div className="text-sm text-muted-foreground">Belge yok.</div> : (
              <StyledTableContainer><Table>
                <TableHeader><StyledTableHeaderRow>
                  <StyledTableHead>Belge</StyledTableHead>
                  <StyledTableHead>Kategori</StyledTableHead>
                  <StyledTableHead>Tarih</StyledTableHead>
                  <StyledTableHead className="w-[60px] text-center">Dosya</StyledTableHead>
                  <StyledTableHead className="w-[60px] text-right">Sil</StyledTableHead>
                </StyledTableHeaderRow></TableHeader>
                <TableBody>
                  {emp.documents.map((d, idx) => (
                    <StyledTableRow key={d.id} index={idx}>
                      <TableCell>{d.title}{d.fileName ? <span className="ml-1 text-xs text-muted-foreground">({fmtSize(d.fileSize)})</span> : null}</TableCell>
                      <TableCell className="text-xs">{d.category || "—"}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs">{date(d.createdAt)}</TableCell>
                      <TableCell className="text-center">
                        {d.fileName ? (
                          <a href={`/api/personel/documents/${d.id}/download`} target="_blank" rel="noopener noreferrer" className="inline-flex text-kobipo-blue"><FileDown className="h-4 w-4" /></a>
                        ) : d.fileUrl ? (
                          <a href={d.fileUrl} target="_blank" rel="noopener noreferrer" className="inline-flex text-kobipo-blue"><ExternalLink className="h-4 w-4" /></a>
                        ) : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="ghost" onClick={() => removeDoc(d.id)} title="Sil"><Trash2 className="h-4 w-4 text-destructive" /></Button>
                      </TableCell>
                    </StyledTableRow>
                  ))}
                </TableBody>
              </Table></StyledTableContainer>
            )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* RESTORAN — bu personelin uyguladığı hesap iskontoları */}
        {/* VARDİYA — sayaç YOK: sekme aya göre veri çekiyor, başlıktaki sayı
            hangi ayı sayacağı belirsiz olurdu. */}
        <TabsContent value="vardiya">
          <EmployeeVardiyaTab employeeId={emp.id} companyId={companyId} />
        </TabsContent>

        {restoran?.enabled && (
          <TabsContent value="restoran">
            <EmployeeRestoranTab data={restoran} />
          </TabsContent>
        )}
      </Tabs>

      {/* Personel Düzenle */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader><DialogTitle>Personel Düzenle</DialogTitle></DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><Label>Ad *</Label><Input value={editForm.firstName} onChange={(e) => setEditForm((p) => ({ ...p, firstName: e.target.value }))} /></div>
            <div><Label>Soyad *</Label><Input value={editForm.lastName} onChange={(e) => setEditForm((p) => ({ ...p, lastName: e.target.value }))} /></div>
            <div><Label>T.C. Kimlik No</Label><Input value={editForm.nationalId} onChange={(e) => setEditForm((p) => ({ ...p, nationalId: e.target.value }))} /></div>
            <div><Label>Telefon</Label><Input value={editForm.phone} onChange={(e) => setEditForm((p) => ({ ...p, phone: e.target.value }))} /></div>
            <div><Label>E-posta</Label><Input value={editForm.email} onChange={(e) => setEditForm((p) => ({ ...p, email: e.target.value }))} /></div>
            <div><Label>Departman</Label><Input value={editForm.department} onChange={(e) => setEditForm((p) => ({ ...p, department: e.target.value }))} /></div>
            <div><Label>Görev / Unvan</Label><Input value={editForm.position} onChange={(e) => setEditForm((p) => ({ ...p, position: e.target.value }))} /></div>
            <div><Label>İşe Giriş</Label><Input type="date" value={editForm.hireDate} onChange={(e) => setEditForm((p) => ({ ...p, hireDate: e.target.value }))} /></div>
            <div><Label>Brüt Maaş (₺)</Label><Input type="number" value={editForm.grossSalary} onChange={(e) => setEditForm((p) => ({ ...p, grossSalary: e.target.value }))} /></div>
            <div><Label>Yıllık İzin (gün)</Label><Input type="number" value={editForm.annualLeaveDays} onChange={(e) => setEditForm((p) => ({ ...p, annualLeaveDays: e.target.value }))} /></div>
            <div><Label>IBAN</Label><Input value={editForm.iban} onChange={(e) => setEditForm((p) => ({ ...p, iban: e.target.value }))} /></div>
            <div><Label>Acil Durum</Label><Input value={editForm.emergencyContact} onChange={(e) => setEditForm((p) => ({ ...p, emergencyContact: e.target.value }))} /></div>
            <div className="sm:col-span-2"><Label>Adres</Label><Input value={editForm.address} onChange={(e) => setEditForm((p) => ({ ...p, address: e.target.value }))} /></div>
            <div className="sm:col-span-2"><Label>Not</Label><Input value={editForm.notes} onChange={(e) => setEditForm((p) => ({ ...p, notes: e.target.value }))} /></div>
          </div>
          <Button className="w-full" onClick={saveEdit} disabled={editSaving}>{editSaving ? "Kaydediliyor…" : "Güncelle"}</Button>
        </DialogContent>
      </Dialog>

      {/* Belge Ekle (çoklu dosya) */}
      <Dialog open={docOpen} onOpenChange={setDocOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>Belge Ekle — {emp.firstName} {emp.lastName}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Belge Başlığı {docFiles.length > 0 ? "(opsiyonel)" : "*"}</Label>
              <Input value={docForm.title} onChange={(e) => setDocForm((p) => ({ ...p, title: e.target.value }))} placeholder="İş sözleşmesi" />
            </div>
            <div>
              <Label>Kategori</Label>
              <Select value={docForm.category || "__none__"} onValueChange={(v) => setDocForm((p) => ({ ...p, category: v === "__none__" ? "" : v }))}>
                <SelectTrigger><SelectValue placeholder="Kategori seçin" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">—</SelectItem>
                  {DOC_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Dosya(lar) — birden çok seçilebilir</Label>
              <Input
                type="file"
                multiple
                accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.png,.jpg,.jpeg,.webp,.gif,.txt,.csv"
                onChange={(e) => setDocFiles(e.target.files ? Array.from(e.target.files) : [])}
              />
              {docFiles.length > 0 && (
                <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                  {docFiles.map((f, i) => <li key={i}>• {f.name} · {fmtSize(f.size)}</li>)}
                </ul>
              )}
            </div>
            <div><Label>Not</Label><Input value={docForm.notes} onChange={(e) => setDocForm((p) => ({ ...p, notes: e.target.value }))} /></div>
            <Button className="w-full" onClick={saveDoc} disabled={docSaving}>{docSaving ? "Yükleniyor…" : "Kaydet"}</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Bordro Ekle */}
      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader><DialogTitle>Bordro Ekle — {emp.firstName} {emp.lastName}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Dönem</Label>
                <Select value={String(payForm.periodMonth)} onValueChange={(v) => setPayForm((p) => ({ ...p, periodMonth: Number(v) }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{MONTHS.map((m, i) => <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Yıl</Label>
                <Select value={String(payForm.periodYear)} onValueChange={(v) => setPayForm((p) => ({ ...p, periodYear: Number(v) }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{[new Date().getFullYear() + 1, new Date().getFullYear(), new Date().getFullYear() - 1].map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Brüt Maaş</Label><Input type="number" value={payForm.grossSalary} onChange={(e) => setPayForm((p) => ({ ...p, grossSalary: e.target.value }))} /></div>
              <div><Label>Ek Ödeme / Prim</Label><Input type="number" value={payForm.bonus} onChange={(e) => setPayForm((p) => ({ ...p, bonus: e.target.value }))} /></div>
              <div><Label>Avans</Label><Input type="number" value={payForm.advance} onChange={(e) => setPayForm((p) => ({ ...p, advance: e.target.value }))} /></div>
              <div><Label>SGK Kesintisi</Label><Input type="number" value={payForm.sgkDeduction} onChange={(e) => setPayForm((p) => ({ ...p, sgkDeduction: e.target.value }))} /></div>
              <div><Label>Gelir Vergisi</Label><Input type="number" value={payForm.taxDeduction} onChange={(e) => setPayForm((p) => ({ ...p, taxDeduction: e.target.value }))} /></div>
              <div><Label>Diğer Kesinti</Label><Input type="number" value={payForm.otherDeduction} onChange={(e) => setPayForm((p) => ({ ...p, otherDeduction: e.target.value }))} /></div>
            </div>
            <div><Label>Not</Label><Input value={payForm.notes} onChange={(e) => setPayForm((p) => ({ ...p, notes: e.target.value }))} /></div>
            <div className="flex items-center justify-between rounded-md border bg-muted/30 p-3"><span className="text-sm text-muted-foreground">Net Maaş</span><span className="text-lg font-bold">{money(payNet)}</span></div>
            <Button className="w-full" onClick={savePayroll} disabled={paySaving}>{paySaving ? "Kaydediliyor…" : "Kaydet"}</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* İzin Ekle */}
      <Dialog open={leaveOpen} onOpenChange={setLeaveOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>İzin Ekle — {emp.firstName} {emp.lastName}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>İzin Türü</Label>
              <Select value={leaveForm.type} onValueChange={(v) => setLeaveForm((p) => ({ ...p, type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(LEAVE_TYPES).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Başlangıç</Label><Input type="date" value={leaveForm.startDate} onChange={(e) => setLeaveForm((p) => ({ ...p, startDate: e.target.value }))} /></div>
              <div><Label>Bitiş</Label><Input type="date" value={leaveForm.endDate} onChange={(e) => setLeaveForm((p) => ({ ...p, endDate: e.target.value }))} /></div>
            </div>
            <div><Label>Açıklama</Label><Input value={leaveForm.reason} onChange={(e) => setLeaveForm((p) => ({ ...p, reason: e.target.value }))} /></div>
            <Button className="w-full" onClick={saveLeave} disabled={leaveSaving}>{leaveSaving ? "Kaydediliyor…" : "Kaydet"}</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Zimmet Ekle */}
      <Dialog open={assetOpen} onOpenChange={setAssetOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>Zimmet Ekle — {emp.firstName} {emp.lastName}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Demirbaş / Ekipman *</Label><Input value={assetForm.assetName} onChange={(e) => setAssetForm((p) => ({ ...p, assetName: e.target.value }))} placeholder="Dizüstü bilgisayar" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Kategori</Label><Input value={assetForm.category} onChange={(e) => setAssetForm((p) => ({ ...p, category: e.target.value }))} placeholder="Bilgisayar" /></div>
              <div><Label>Seri No</Label><Input value={assetForm.serialNo} onChange={(e) => setAssetForm((p) => ({ ...p, serialNo: e.target.value }))} /></div>
              <div><Label>Adet</Label><Input type="number" value={assetForm.quantity} onChange={(e) => setAssetForm((p) => ({ ...p, quantity: e.target.value }))} /></div>
              <div><Label>Zimmet Tarihi</Label><Input type="date" value={assetForm.assignedDate} onChange={(e) => setAssetForm((p) => ({ ...p, assignedDate: e.target.value }))} /></div>
            </div>
            <div><Label>Not</Label><Input value={assetForm.notes} onChange={(e) => setAssetForm((p) => ({ ...p, notes: e.target.value }))} /></div>
            <Button className="w-full" onClick={saveAsset} disabled={assetSaving}>{assetSaving ? "Kaydediliyor…" : "Kaydet"}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
