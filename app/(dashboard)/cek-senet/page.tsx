"use client"

import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useToast } from "@/components/ui/use-toast"
import { Plus, Eye, Trash2, Edit } from "lucide-react"
import Link from "next/link"

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

export default function CekSenetPage() {
  const searchParams = useSearchParams()
  const companyId = searchParams.get("company")
  const { toast } = useToast()

  const [checks, setChecks] = useState<Check[]>([])
  const [notes, setNotes] = useState<PromissoryNote[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [modalType, setModalType] = useState<"CHECK" | "PROMISSORY_NOTE">("CHECK")
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
    customerId: "",
    supplierId: "",
    notes: "",
  })

  useEffect(() => {
    if (companyId) {
      fetchChecks()
      fetchNotes()
      fetchCustomers()
      fetchSuppliers()
    }
  }, [companyId])

  const fetchChecks = async () => {
    if (!companyId) return
    try {
      const response = await fetch(`/api/cek-senet?companyId=${companyId}&type=CHECK`)
      if (response.ok) {
        const data = await response.json()
        setChecks(data)
      }
    } catch (error) {
      console.error("Error fetching checks:", error)
    }
  }

  const fetchNotes = async () => {
    if (!companyId) return
    try {
      const response = await fetch(`/api/cek-senet?companyId=${companyId}&type=PROMISSORY_NOTE`)
      if (response.ok) {
        const data = await response.json()
        setNotes(data)
      }
    } catch (error) {
      console.error("Error fetching notes:", error)
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
        ? `/api/cek-senet/${editingItem.id}?type=${modalType}`
        : "/api/cek-senet"
      const method = editingItem ? "PUT" : "POST"

      const payload = {
        type: modalType,
        companyId,
        ...(modalType === "CHECK" ? checkForm : noteForm),
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
            : modalType === "CHECK"
            ? "Çek kaydı oluşturuldu"
            : "Senet kaydı oluşturuldu",
        })
        setIsModalOpen(false)
        setEditingItem(null)
        resetForms()
        fetchChecks()
        fetchNotes()
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

  const handleDelete = async (id: string, type: "CHECK" | "PROMISSORY_NOTE") => {
    if (!confirm("Bu kaydı silmek istediğinize emin misiniz?")) return

    try {
      const response = await fetch(`/api/cek-senet/${id}?type=${type}`, {
        method: "DELETE",
      })

      if (response.ok) {
        toast({
          title: "Başarılı",
          description: "Kayıt silindi",
        })
        fetchChecks()
        fetchNotes()
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

  const handleEdit = (item: Check | PromissoryNote, type: "CHECK" | "PROMISSORY_NOTE") => {
    setEditingItem(item)
    setModalType(type)
    if (type === "CHECK") {
      setCheckForm({
        checkNo: (item as Check).checkNo,
        bankName: (item as Check).bankName,
        branchName: (item as Check).branchName || "",
        accountNo: (item as Check).accountNo || "",
        amount: String((item as Check).amount),
        issueDate: new Date((item as Check).issueDate).toISOString().split("T")[0],
        dueDate: new Date((item as Check).dueDate).toISOString().split("T")[0],
        status: (item as Check).status,
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
      customerId: "",
      supplierId: "",
      notes: "",
    })
  }

  const openModal = (type: "CHECK" | "PROMISSORY_NOTE") => {
    setModalType(type)
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
          <CardTitle>Çek/Senet</CardTitle>
          <CardDescription>Firma seçiniz</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Çek/Senet Yönetimi</CardTitle>
              <CardDescription>Çek ve senet portföyünüzü yönetin</CardDescription>
            </div>
            <div className="flex gap-2">
              <Button onClick={() => openModal("CHECK")}>
                <Plus className="mr-2 h-4 w-4" />
                Yeni Çek
              </Button>
              <Button onClick={() => openModal("PROMISSORY_NOTE")}>
                <Plus className="mr-2 h-4 w-4" />
                Yeni Senet
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="checks" className="w-full">
            <TabsList>
              <TabsTrigger value="checks">Çekler ({checks.length})</TabsTrigger>
              <TabsTrigger value="notes">Senetler ({notes.length})</TabsTrigger>
            </TabsList>
            <TabsContent value="checks">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Çek No</TableHead>
                    <TableHead>Banka</TableHead>
                    <TableHead>Müşteri/Tedarikçi</TableHead>
                    <TableHead>Tutar</TableHead>
                    <TableHead>Düzenleme Tarihi</TableHead>
                    <TableHead>Vade</TableHead>
                    <TableHead>Durum</TableHead>
                    <TableHead>İşlemler</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {checks.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center text-muted-foreground">
                        Henüz çek kaydı bulunmuyor
                      </TableCell>
                    </TableRow>
                  ) : (
                    checks.map((check) => (
                      <TableRow key={check.id}>
                        <TableCell className="font-medium">{check.checkNo}</TableCell>
                        <TableCell>{check.bankName}</TableCell>
                        <TableCell>
                          {check.customer?.name || check.supplier?.name || "-"}
                        </TableCell>
                        <TableCell>{formatCurrency(Number(check.amount))}</TableCell>
                        <TableCell>{formatDate(check.issueDate)}</TableCell>
                        <TableCell>{formatDate(check.dueDate)}</TableCell>
                        <TableCell>
                          <Badge variant={getStatusVariant(check.status)}>
                            {getStatusLabel(check.status)}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleEdit(check, "CHECK")}
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDelete(check.id, "CHECK")}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </TabsContent>
            <TabsContent value="notes">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Senet No</TableHead>
                    <TableHead>Müşteri/Tedarikçi</TableHead>
                    <TableHead>Tutar</TableHead>
                    <TableHead>Düzenleme Tarihi</TableHead>
                    <TableHead>Vade</TableHead>
                    <TableHead>Durum</TableHead>
                    <TableHead>İşlemler</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {notes.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-muted-foreground">
                        Henüz senet kaydı bulunmuyor
                      </TableCell>
                    </TableRow>
                  ) : (
                    notes.map((note) => (
                      <TableRow key={note.id}>
                        <TableCell className="font-medium">{note.noteNo}</TableCell>
                        <TableCell>
                          {note.customer?.name || note.supplier?.name || "-"}
                        </TableCell>
                        <TableCell>{formatCurrency(Number(note.amount))}</TableCell>
                        <TableCell>{formatDate(note.issueDate)}</TableCell>
                        <TableCell>{formatDate(note.dueDate)}</TableCell>
                        <TableCell>
                          <Badge variant={getStatusVariant(note.status)}>
                            {getStatusLabel(note.status)}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleEdit(note, "PROMISSORY_NOTE")}
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDelete(note.id, "PROMISSORY_NOTE")}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingItem
                ? modalType === "CHECK"
                  ? "Çek Düzenle"
                  : "Senet Düzenle"
                : modalType === "CHECK"
                ? "Yeni Çek"
                : "Yeni Senet"}
            </DialogTitle>
            <DialogDescription>
              {modalType === "CHECK"
                ? "Çek bilgilerini girin"
                : "Senet bilgilerini girin"}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit}>
            <div className="grid gap-4 py-4">
              {modalType === "CHECK" ? (
                <>
                  <div className="grid grid-cols-2 gap-4">
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
                  <div className="grid grid-cols-2 gap-4">
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
                  <div className="grid grid-cols-2 gap-4">
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
                  <div className="grid grid-cols-2 gap-4">
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
                  <div className="grid grid-cols-2 gap-4">
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
                  <div className="grid grid-cols-2 gap-4">
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
                  <div className="grid grid-cols-2 gap-4">
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
                  <div className="grid grid-cols-2 gap-4">
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
                  <div className="grid grid-cols-2 gap-4">
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

