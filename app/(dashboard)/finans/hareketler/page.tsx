"use client"

import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useToast } from "@/components/ui/use-toast"
import { Plus } from "lucide-react"

interface FinancialAccount {
  id: string
  name: string
  type: string
  bankName?: string
}

interface Transaction {
  id: string
  date: string
  type: string
  amount: number
  description?: string
  account: {
    name: string
  }
  customer?: {
    name: string
  }
  supplier?: {
    name: string
  }
}

export default function FinansHareketlerPage() {
  const searchParams = useSearchParams()
  const companyId = searchParams.get("company")
  const customerId = searchParams.get("customerId")
  const supplierId = searchParams.get("supplierId")
  const { toast } = useToast()
  const [accounts, setAccounts] = useState<FinancialAccount[]>([])
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [formData, setFormData] = useState({
    accountId: "",
    type: customerId ? "INCOME" : supplierId ? "EXPENSE" : "INCOME",
    amount: "",
    date: new Date().toISOString().split("T")[0],
    description: "",
    customerId: customerId || "",
    supplierId: supplierId || "",
    reference: "",
  })

  useEffect(() => {
    if (companyId) {
      fetchAccounts()
      fetchTransactions()
    }
  }, [companyId, customerId, supplierId])

  const fetchAccounts = async () => {
    if (!companyId) return
    try {
      const response = await fetch(`/api/finans/accounts?companyId=${companyId}`)
      if (response.ok) {
        const data = await response.json()
        setAccounts(data)
      }
    } catch (error) {
      console.error("Error fetching accounts:", error)
    }
  }

  const fetchTransactions = async () => {
    if (!companyId) return
    setIsLoading(true)
    try {
      const params = new URLSearchParams({ companyId })
      if (customerId) params.append("customerId", customerId)
      if (supplierId) params.append("supplierId", supplierId)
      const response = await fetch(`/api/finans/transactions?${params}`)
      if (response.ok) {
        const data = await response.json()
        setTransactions(data)
      }
    } catch (error) {
      console.error("Error fetching transactions:", error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!companyId) return

    setIsLoading(true)
    try {
      const response = await fetch(`/api/finans/transactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...formData,
          companyId,
          amount: parseFloat(formData.amount),
          customerId: formData.customerId || null,
          supplierId: formData.supplierId || null,
        }),
      })

      if (response.ok) {
        toast({
          title: "Başarılı",
          description: "Hareket eklendi",
        })
        setIsDialogOpen(false)
        setFormData({
          accountId: "",
          type: "INCOME",
          amount: "",
          date: new Date().toISOString().split("T")[0],
          description: "",
          customerId: "",
          supplierId: "",
          reference: "",
        })
        fetchTransactions()
      } else {
        const data = await response.json()
        throw new Error(data.error || "Oluşturulamadı")
      }
    } catch (error: any) {
      toast({
        title: "Hata",
        description: error.message || "Bir hata oluştu",
        variant: "destructive",
      })
    } finally {
      setIsLoading(false)
    }
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("tr-TR", {
      style: "currency",
      currency: "TRY",
    }).format(amount)
  }

  if (!companyId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Finans Hareketleri</CardTitle>
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
              <CardTitle>Finans Hareketleri</CardTitle>
              <CardDescription>Gelir ve gider işlemleri</CardDescription>
            </div>
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="mr-2 h-4 w-4" />
                  Yeni Hareket
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Yeni Finans Hareketi</DialogTitle>
                  <DialogDescription>
                    Gelir veya gider işlemi ekleyin
                  </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="space-y-2">
                    <Label>Hesap *</Label>
                    <Select
                      value={formData.accountId}
                      onValueChange={(value) => setFormData({ ...formData, accountId: value })}
                      required
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Hesap seçin" />
                      </SelectTrigger>
                      <SelectContent>
                        {accounts.map((account) => (
                          <SelectItem key={account.id} value={account.id}>
                            {account.name} {account.bankName && `(${account.bankName})`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>İşlem Tipi *</Label>
                    <Select
                      value={formData.type}
                      onValueChange={(value) => setFormData({ ...formData, type: value })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="INCOME">Gelir</SelectItem>
                        <SelectItem value="EXPENSE">Gider</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Tutar *</Label>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={formData.amount}
                      onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Tarih *</Label>
                    <Input
                      type="date"
                      value={formData.date}
                      onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Açıklama</Label>
                    <Input
                      value={formData.description}
                      onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                      placeholder="İşlem açıklaması"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Referans</Label>
                    <Input
                      value={formData.reference}
                      onChange={(e) => setFormData({ ...formData, reference: e.target.value })}
                      placeholder="Referans no"
                    />
                  </div>
                  <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                      İptal
                    </Button>
                    <Button type="submit" disabled={isLoading}>
                      {isLoading ? "Kaydediliyor..." : "Kaydet"}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8">Yükleniyor...</div>
          ) : transactions.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              Henüz hareket bulunmuyor
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tarih</TableHead>
                  <TableHead>Hesap</TableHead>
                  <TableHead>Tip</TableHead>
                  <TableHead>Açıklama</TableHead>
                  <TableHead className="text-right">Tutar</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions.map((tx) => (
                  <TableRow key={tx.id}>
                    <TableCell>
                      {new Date(tx.date).toLocaleDateString("tr-TR")}
                    </TableCell>
                    <TableCell>{tx.account.name}</TableCell>
                    <TableCell>
                      <span className={`px-2 py-1 rounded text-xs ${
                        tx.type === "INCOME" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"
                      }`}>
                        {tx.type === "INCOME" ? "Gelir" : "Gider"}
                      </span>
                    </TableCell>
                    <TableCell>{tx.description || "-"}</TableCell>
                    <TableCell className={`text-right font-medium ${
                      tx.type === "INCOME" ? "text-green-600" : "text-red-600"
                    }`}>
                      {tx.type === "INCOME" ? "+" : "-"}
                      {formatCurrency(tx.amount)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

