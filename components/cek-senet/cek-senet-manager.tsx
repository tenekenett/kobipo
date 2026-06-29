"use client"

import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  StyledTableContainer,
  StyledTableHeaderRow,
  StyledTableHead,
  StyledTableRow,
  EntityCell,
  MonoCell,
} from "@/components/ui/styled-table"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/components/ui/use-toast"
import { useConfirm } from "@/components/ui/confirm-dialog-provider"
import { Plus, Trash2, Edit } from "lucide-react"

interface Check {
  id: string
  checkNo: string
  bankName: string
  branchName?: string
  accountNo?: string
  amount: number
  issueDate: string
  dueDate: string
  status: string
  direction?: string | null
  customer?: { id: string; name: string }
  supplier?: { id: string; name: string }
}

interface PromissoryNote {
  id: string
  noteNo: string
  amount: number
  issueDate: string
  dueDate: string
  status: string
  direction?: string | null
  customer?: { id: string; name: string }
  supplier?: { id: string; name: string }
}

interface Customer {
  id: string
  name: string
}

interface Supplier {
  id: string
  name: string
}

type Mode = "CHECK" | "PROMISSORY_NOTE"

const COPY: Record<Mode, { title: string; description: string; newButton: string; newDialog: string; editDialog: string; dialogDescription: string; empty: string }> = {
  CHECK: {
    title: "Çek Yönetimi",
    description: "Çek portföyünüzü yönetin",
    newButton: "Yeni Çek",
    newDialog: "Yeni Çek",
    editDialog: "Çek Düzenle",
    dialogDescription: "Çek bilgilerini girin",
    empty: "Henüz çek kaydı bulunmuyor",
  },
  PROMISSORY_NOTE: {
    title: "Senet Yönetimi",
    description: "Senet portföyünüzü yönetin",
    newButton: "Yeni Senet",
    newDialog: "Yeni Senet",
    editDialog: "Senet Düzenle",
    dialogDescription: "Senet bilgilerini girin",
    empty: "Henüz senet kaydı bulunmuyor",
  },
}

export function CekSenetManager({ mode }: { mode: Mode }) {
  const copy = COPY[mode]
  const searchParams = useSearchParams()
  const companyId = searchParams.get("company")
  const { toast } = useToast()
  const { confirm } = useConfirm()

  const [checks, setChecks] = useState<Check[]>([])
  const [notes, setNotes] = useState<PromissoryNote[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingItem, setEditingItem] = useState<Check | PromissoryNote | null>(null)

  const [checkForm, setCheckForm] = useState({
    checkNo: "",
    bankName: "",
    branchName: "",
    accountNo: "",
    amount: "",
    issueDate: new Date().toISOString().split("T")[0],
    dueDate: "",
    status: "PORTFÖYDE",
    cariType: "",
    direction: "",
    customerId: "",
    supplierId: "",
    notes: "",
  })

  const [noteForm, setNoteForm] = useState({
    noteNo: "",
    amount: "",
    issueDate: new Date().toISOString().split("T")[0],
    dueDate: "",
    status: "PORTFÖYDE",
    cariType: "",
    direction: "",
    customerId: "",
    supplierId: "",
    notes: "",
  })

  useEffect(() => {
    if (companyId) {
      fetchItems()
      fetchCustomers()
      fetchSuppliers()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId])

  const fetchItems = async () => {
    if (!companyId) return
    try {
      const response = await fetch(`/api/cek-senet?companyId=${companyId}&type=${mode}`)
      if (response.ok) {
        const data = await response.json()
        if (mode === "CHECK") setChecks(data)
        else setNotes(data)
      }
    } catch (error) {
      console.error("Error fetching items:", error)
    }
  }

  const fetchCustomers = async () => {
    if (!companyId) return
    try {
      const response = await fetch(`/api/cari/customers?companyId=${companyId}`)
      if (response.ok) {
        const data = await response.json()
        setCustomers(data)
      }
    } catch (error) {
      console.error("Error fetching customers:", error)
    }
  }

  const fetchSuppliers = async () => {
    if (!companyId) return
    try {
      const response = await fetch(`/api/cari/suppliers?companyId=${companyId}`)
      if (response.ok) {
        const data = await response.json()
        setSuppliers(data)
      }
    } catch (error) {
      console.error("Error fetching suppliers:", error)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!companyId) return

    setIsLoading(true)
    try {
      const url = editingItem
        ? `/api/cek-senet/${editingItem.id}?type=${mode}`
        : "/api/cek-senet"
      const method = editingItem ? "PUT" : "POST"

      const payload = {
        type: mode,
        companyId,
        ...(mode === "CHECK" ? checkForm : noteForm),
      }

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })

      if (response.ok) {
        toast({
          title: "Başarılı",
          description: editingItem
            ? "Kayıt güncellendi"
            : mode === "CHECK"
            ? "Çek kaydı oluşturuldu"
            : "Senet kaydı oluşturuldu",
        })
        setIsModalOpen(false)
        setEditingItem(null)
        resetForms()
        fetchItems()
      } else {
        const error = await response.json()
        toast({
          title: "Hata",
          description: error.error || "İşlem başarısız",
          variant: "destructive",
        })
      }
    } catch (error) {
      toast({
        title: "Hata",
        description: "Bir hata oluştu",
        variant: "destructive",
      })
    } finally {
      setIsLoading(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!(await confirm({ title: "Kaydı sil", description: "Bu kaydı silmek istediğinize emin misiniz?", confirmLabel: "Sil", variant: "destructive" }))) return

    try {
      const response = await fetch(`/api/cek-senet/${id}?type=${mode}`, {
        method: "DELETE",
      })

      if (response.ok) {
        toast({
          title: "Başarılı",
          description: "Kayıt silindi",
        })
        fetchItems()
      } else {
        toast({
          title: "Hata",
          description: "Kayıt silinemedi",
          variant: "destructive",
        })
      }
    } catch (error) {
      toast({
        title: "Hata",
        description: "Bir hata oluştu",
        variant: "destructive",
      })
    }
  }

  const handleEdit = (item: Check | PromissoryNote) => {
    setEditingItem(item)
    if (mode === "CHECK") {
      setCheckForm({
        checkNo: (item as Check).checkNo,
        bankName: (item as Check).bankName,
        branchName: (item as Check).branchName || "",
        accountNo: (item as Check).accountNo || "",
        amount: String((item as Check).amount),
        issueDate: new Date((item as Check).issueDate).toISOString().split("T")[0],
        dueDate: new Date((item as Check).dueDate).toISOString().split("T")[0],
        status: (item as Check).status,
        cariType: (item as Check).customer?.id ? "customer" : (item as Check).supplier?.id ? "supplier" : "",
        direction: (item as Check).direction || ((item as Check).supplier?.id ? "GIVEN" : "RECEIVED"),
        customerId: (item as Check).customer?.id || "",
        supplierId: (item as Check).supplier?.id || "",
        notes: "",
      })
    } else {
      setNoteForm({
        noteNo: (item as PromissoryNote).noteNo,
        amount: String((item as PromissoryNote).amount),
        issueDate: new Date((item as PromissoryNote).issueDate).toISOString().split("T")[0],
        dueDate: new Date((item as PromissoryNote).dueDate).toISOString().split("T")[0],
        status: (item as PromissoryNote).status,
        cariType: (item as PromissoryNote).customer?.id ? "customer" : (item as PromissoryNote).supplier?.id ? "supplier" : "",
        direction: (item as PromissoryNote).direction || ((item as PromissoryNote).supplier?.id ? "GIVEN" : "RECEIVED"),
        customerId: (item as PromissoryNote).customer?.id || "",
        supplierId: (item as PromissoryNote).supplier?.id || "",
        notes: "",
      })
    }
    setIsModalOpen(true)
  }

  const resetForms = () => {
    setCheckForm({
      checkNo: "",
      bankName: "",
      branchName: "",
      accountNo: "",
      amount: "",
      issueDate: new Date().toISOString().split("T")[0],
      dueDate: "",
      status: "PORTFÖYDE",
      cariType: "",
      direction: "",
      customerId: "",
      supplierId: "",
      notes: "",
    })
    setNoteForm({
      noteNo: "",
      amount: "",
      issueDate: new Date().toISOString().split("T")[0],
      dueDate: "",
      status: "PORTFÖYDE",
      cariType: "",
      direction: "",
      customerId: "",
      supplierId: "",
      notes: "",
    })
  }

  const openModal = () => {
    setEditingItem(null)
    resetForms()
    setIsModalOpen(true)
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("tr-TR", {
      style: "currency",
      currency: "TRY",
    }).format(amount)
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("tr-TR")
  }

  const getStatusLabel = (status: string) => {
    const labels: Record<string, string> = {
      PORTFÖYDE: "Portföyde",
      CİRO_EDİLDİ: "Ciro Edildi",
      TAHSİL_EDİLDİ: "Tahsil Edildi",
      İADE_EDİLDİ: "İade Edildi",
      PROTESTOLU: "Protestolu",
    }
    return labels[status] || status
  }

  const getStatusVariant = (status: string): "default" | "secondary" | "destructive" => {
    if (status === "TAHSİL_EDİLDİ") return "default"
    if (status === "PROTESTOLU" || status === "İADE_EDİLDİ") return "destructive"
    return "secondary"
  }

  if (!companyId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{copy.title}</CardTitle>
          <CardDescription>Firma seçiniz</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>{copy.title}</CardTitle>
              <CardDescription>{copy.description}</CardDescription>
            </div>
            <Button onClick={openModal}>
              <Plus className="mr-2 h-4 w-4" />
              {copy.newButton}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {mode === "CHECK" ? (
            <StyledTableContainer>
              <Table>
                <TableHeader>
                  <StyledTableHeaderRow>
                    <StyledTableHead>Çek No</StyledTableHead>
                    <StyledTableHead>Banka</StyledTableHead>
                    <StyledTableHead>Müşteri/Tedarikçi</StyledTableHead>
                    <StyledTableHead className="text-right">Tutar</StyledTableHead>
                    <StyledTableHead>Düzenleme Tarihi</StyledTableHead>
                    <StyledTableHead>Vade</StyledTableHead>
                    <StyledTableHead>Durum</StyledTableHead>
                    <StyledTableHead>İşlemler</StyledTableHead>
                  </StyledTableHeaderRow>
                </TableHeader>
                <TableBody>
                  {checks.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center text-muted-foreground">
                        {copy.empty}
                      </TableCell>
                    </TableRow>
                  ) : (
                    checks.map((check, idx) => (
                      <StyledTableRow key={check.id} index={idx}>
                        <TableCell><MonoCell value={check.checkNo} className="text-kobipo-blue font-medium" /></TableCell>
                        <TableCell className="text-xs">{check.bankName}</TableCell>
                        <TableCell>
                          <EntityCell name={check.customer?.name || check.supplier?.name} />
                        </TableCell>
                        <TableCell className="text-right font-semibold whitespace-nowrap">{formatCurrency(Number(check.amount))}</TableCell>
                        <TableCell className="text-xs whitespace-nowrap">{formatDate(check.issueDate)}</TableCell>
                        <TableCell className="text-xs whitespace-nowrap">{formatDate(check.dueDate)}</TableCell>
                        <TableCell>
                          <Badge variant={getStatusVariant(check.status)}>
                            {getStatusLabel(check.status)}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-2">
                            <Button variant="ghost" size="sm" onClick={() => handleEdit(check)}>
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => handleDelete(check.id)}>
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        </TableCell>
                      </StyledTableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </StyledTableContainer>
          ) : (
            <StyledTableContainer>
              <Table>
                <TableHeader>
                  <StyledTableHeaderRow>
                    <StyledTableHead>Senet No</StyledTableHead>
                    <StyledTableHead>Müşteri/Tedarikçi</StyledTableHead>
                    <StyledTableHead className="text-right">Tutar</StyledTableHead>
                    <StyledTableHead>Düzenleme Tarihi</StyledTableHead>
                    <StyledTableHead>Vade</StyledTableHead>
                    <StyledTableHead>Durum</StyledTableHead>
                    <StyledTableHead>İşlemler</StyledTableHead>
                  </StyledTableHeaderRow>
                </TableHeader>
                <TableBody>
                  {notes.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-muted-foreground">
                        {copy.empty}
                      </TableCell>
                    </TableRow>
                  ) : (
                    notes.map((note, idx) => (
                      <StyledTableRow key={note.id} index={idx}>
                        <TableCell><MonoCell value={note.noteNo} className="text-kobipo-blue font-medium" /></TableCell>
                        <TableCell>
                          <EntityCell name={note.customer?.name || note.supplier?.name} />
                        </TableCell>
                        <TableCell className="text-right font-semibold whitespace-nowrap">{formatCurrency(Number(note.amount))}</TableCell>
                        <TableCell className="text-xs whitespace-nowrap">{formatDate(note.issueDate)}</TableCell>
                        <TableCell className="text-xs whitespace-nowrap">{formatDate(note.dueDate)}</TableCell>
                        <TableCell>
                          <Badge variant={getStatusVariant(note.status)}>
                            {getStatusLabel(note.status)}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-2">
                            <Button variant="ghost" size="sm" onClick={() => handleEdit(note)}>
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => handleDelete(note.id)}>
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        </TableCell>
                      </StyledTableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </StyledTableContainer>
          )}
        </CardContent>
      </Card>

      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingItem ? copy.editDialog : copy.newDialog}</DialogTitle>
            <DialogDescription>{copy.dialogDescription}</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit}>
            <div className="grid gap-4 py-4">
              {mode === "CHECK" ? (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="checkNo">Çek No *</Label>
                      <Input
                        id="checkNo"
                        value={checkForm.checkNo}
                        onChange={(e) =>
                          setCheckForm({ ...checkForm, checkNo: e.target.value })
                        }
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="bankName">Banka Adı *</Label>
                      <Input
                        id="bankName"
                        value={checkForm.bankName}
                        onChange={(e) =>
                          setCheckForm({ ...checkForm, bankName: e.target.value })
                        }
                        required
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="branchName">Şube</Label>
                      <Input
                        id="branchName"
                        value={checkForm.branchName}
                        onChange={(e) =>
                          setCheckForm({ ...checkForm, branchName: e.target.value })
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="accountNo">Hesap No</Label>
                      <Input
                        id="accountNo"
                        value={checkForm.accountNo}
                        onChange={(e) =>
                          setCheckForm({ ...checkForm, accountNo: e.target.value })
                        }
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="amount">Tutar *</Label>
                      <Input
                        id="amount"
                        type="number"
                        step="0.01"
                        value={checkForm.amount}
                        onChange={(e) =>
                          setCheckForm({ ...checkForm, amount: e.target.value })
                        }
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="status">Durum *</Label>
                      <Select
                        value={checkForm.status}
                        onValueChange={(value) =>
                          setCheckForm({ ...checkForm, status: value })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="PORTFÖYDE">Portföyde</SelectItem>
                          <SelectItem value="CİRO_EDİLDİ">Ciro Edildi</SelectItem>
                          <SelectItem value="TAHSİL_EDİLDİ">Tahsil Edildi</SelectItem>
                          <SelectItem value="İADE_EDİLDİ">İade Edildi</SelectItem>
                          <SelectItem value="PROTESTOLU">Protestolu</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="issueDate">Düzenleme Tarihi *</Label>
                      <Input
                        id="issueDate"
                        type="date"
                        value={checkForm.issueDate}
                        onChange={(e) =>
                          setCheckForm({ ...checkForm, issueDate: e.target.value })
                        }
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="dueDate">Vade Tarihi *</Label>
                      <Input
                        id="dueDate"
                        type="date"
                        value={checkForm.dueDate}
                        onChange={(e) =>
                          setCheckForm({ ...checkForm, dueDate: e.target.value })
                        }
                        required
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="cariType">Cari Türü</Label>
                      <Select
                        value={checkForm.cariType}
                        onValueChange={(value) =>
                          setCheckForm({
                            ...checkForm,
                            cariType: value,
                            direction: value === "supplier" ? "GIVEN" : "RECEIVED",
                            customerId: "",
                            supplierId: "",
                          })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Müşteri / Tedarikçi" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="customer">Müşteri</SelectItem>
                          <SelectItem value="supplier">Tedarikçi</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {checkForm.cariType === "customer" && (
                      <div className="space-y-2">
                        <Label htmlFor="customerId">Müşteri</Label>
                        <Select
                          value={checkForm.customerId}
                          onValueChange={(value) =>
                            setCheckForm({ ...checkForm, customerId: value, supplierId: "" })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Müşteri seçiniz" />
                          </SelectTrigger>
                          <SelectContent>
                            {customers.map((customer) => (
                              <SelectItem key={customer.id} value={customer.id}>
                                {customer.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    {checkForm.cariType === "supplier" && (
                      <div className="space-y-2">
                        <Label htmlFor="supplierId">Tedarikçi</Label>
                        <Select
                          value={checkForm.supplierId}
                          onValueChange={(value) =>
                            setCheckForm({ ...checkForm, supplierId: value, customerId: "" })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Tedarikçi seçiniz" />
                          </SelectTrigger>
                          <SelectContent>
                            {suppliers.map((supplier) => (
                              <SelectItem key={supplier.id} value={supplier.id}>
                                {supplier.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    {checkForm.cariType && (
                      <div className="space-y-2">
                        <Label htmlFor="direction">Yön</Label>
                        <Select
                          value={checkForm.direction}
                          onValueChange={(value) =>
                            setCheckForm({ ...checkForm, direction: value })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Alınan / Verilen" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="RECEIVED">Alınan (tahsilat)</SelectItem>
                            <SelectItem value="GIVEN">Verilen (ödeme)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="notes">Notlar</Label>
                    <Textarea
                      id="notes"
                      value={checkForm.notes}
                      onChange={(e) =>
                        setCheckForm({ ...checkForm, notes: e.target.value })
                      }
                    />
                  </div>
                </>
              ) : (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="noteNo">Senet No *</Label>
                      <Input
                        id="noteNo"
                        value={noteForm.noteNo}
                        onChange={(e) =>
                          setNoteForm({ ...noteForm, noteNo: e.target.value })
                        }
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="amount">Tutar *</Label>
                      <Input
                        id="amount"
                        type="number"
                        step="0.01"
                        value={noteForm.amount}
                        onChange={(e) =>
                          setNoteForm({ ...noteForm, amount: e.target.value })
                        }
                        required
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="issueDate">Düzenleme Tarihi *</Label>
                      <Input
                        id="issueDate"
                        type="date"
                        value={noteForm.issueDate}
                        onChange={(e) =>
                          setNoteForm({ ...noteForm, issueDate: e.target.value })
                        }
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="dueDate">Vade Tarihi *</Label>
                      <Input
                        id="dueDate"
                        type="date"
                        value={noteForm.dueDate}
                        onChange={(e) =>
                          setNoteForm({ ...noteForm, dueDate: e.target.value })
                        }
                        required
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="status">Durum *</Label>
                      <Select
                        value={noteForm.status}
                        onValueChange={(value) =>
                          setNoteForm({ ...noteForm, status: value })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="PORTFÖYDE">Portföyde</SelectItem>
                          <SelectItem value="CİRO_EDİLDİ">Ciro Edildi</SelectItem>
                          <SelectItem value="TAHSİL_EDİLDİ">Tahsil Edildi</SelectItem>
                          <SelectItem value="İADE_EDİLDİ">İade Edildi</SelectItem>
                          <SelectItem value="PROTESTOLU">Protestolu</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="cariType">Cari Türü</Label>
                      <Select
                        value={noteForm.cariType}
                        onValueChange={(value) =>
                          setNoteForm({
                            ...noteForm,
                            cariType: value,
                            direction: value === "supplier" ? "GIVEN" : "RECEIVED",
                            customerId: "",
                            supplierId: "",
                          })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Müşteri / Tedarikçi" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="customer">Müşteri</SelectItem>
                          <SelectItem value="supplier">Tedarikçi</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {noteForm.cariType === "customer" && (
                      <div className="space-y-2">
                        <Label htmlFor="customerId">Müşteri</Label>
                        <Select
                          value={noteForm.customerId}
                          onValueChange={(value) =>
                            setNoteForm({ ...noteForm, customerId: value, supplierId: "" })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Müşteri seçiniz" />
                          </SelectTrigger>
                          <SelectContent>
                            {customers.map((customer) => (
                              <SelectItem key={customer.id} value={customer.id}>
                                {customer.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    {noteForm.cariType === "supplier" && (
                      <div className="space-y-2">
                        <Label htmlFor="supplierId">Tedarikçi</Label>
                        <Select
                          value={noteForm.supplierId}
                          onValueChange={(value) =>
                            setNoteForm({ ...noteForm, supplierId: value, customerId: "" })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Tedarikçi seçiniz" />
                          </SelectTrigger>
                          <SelectContent>
                            {suppliers.map((supplier) => (
                              <SelectItem key={supplier.id} value={supplier.id}>
                                {supplier.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    {noteForm.cariType && (
                      <div className="space-y-2">
                        <Label htmlFor="direction">Yön</Label>
                        <Select
                          value={noteForm.direction}
                          onValueChange={(value) =>
                            setNoteForm({ ...noteForm, direction: value })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Alınan / Verilen" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="RECEIVED">Alınan (tahsilat)</SelectItem>
                            <SelectItem value="GIVEN">Verilen (ödeme)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="notes">Notlar</Label>
                    <Textarea
                      id="notes"
                      value={noteForm.notes}
                      onChange={(e) =>
                        setNoteForm({ ...noteForm, notes: e.target.value })
                      }
                    />
                  </div>
                </>
              )}
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setIsModalOpen(false)
                  setEditingItem(null)
                  resetForms()
                }}
              >
                İptal
              </Button>
              <Button type="submit" disabled={isLoading}>
                {isLoading ? "Kaydediliyor..." : editingItem ? "Güncelle" : "Kaydet"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
