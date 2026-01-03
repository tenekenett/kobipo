"use client"

import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { useToast } from "@/components/ui/use-toast"
import { Plus } from "lucide-react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

interface Account {
  id: string
  code?: string
  name: string
  type: string
  bankName?: string
  accountNumber?: string
  balance: number
  currency: string
}

interface Transaction {
  id: string
  type: string
  amount: number
  description?: string
  date: string
  account: Account
  customer?: { name: string }
  supplier?: { name: string }
}

export default function FinansPage() {
  const searchParams = useSearchParams()
  const companyId = searchParams.get("company")
  const { toast } = useToast()
  const [accounts, setAccounts] = useState<Account[]>([])
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [activeTab, setActiveTab] = useState<"accounts" | "transactions">("accounts")
  const [isAccountDialogOpen, setIsAccountDialogOpen] = useState(false)
  const [isTransactionDialogOpen, setIsTransactionDialogOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [accountFormData, setAccountFormData] = useState({
    code: "",
    name: "",
    type: "CASH",
    bankName: "",
    accountNumber: "",
    iban: "",
    currency: "TRY",
  })
  const [transactionFormData, setTransactionFormData] = useState({
    accountId: "",
    type: "INCOME",
    amount: "",
    currency: "TRY",
    description: "",
    date: new Date().toISOString().split("T")[0],
    reference: "",
    customerId: "",
    supplierId: "",
  })

  useEffect(() => {
    if (companyId) {
      fetchAccounts()
      if (activeTab === "transactions") {
        fetchTransactions()
      }
    }
  }, [companyId, activeTab])

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

    try {
      const response = await fetch(`/api/finans/transactions?companyId=${companyId}`)
      if (response.ok) {
        const data = await response.json()
        setTransactions(data)
      }
    } catch (error) {
      console.error("Error fetching transactions:", error)
    }
  }

  const handleAccountSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!companyId) return

    setIsLoading(true)
    try {
      const response = await fetch("/api/finans/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...accountFormData, companyId }),
      })

      if (response.ok) {
        toast({
          title: "Başarılı",
          description: "Hesap oluşturuldu",
        })
        setIsAccountDialogOpen(false)
        setAccountFormData({
          code: "",
          name: "",
          type: "CASH",
          bankName: "",
          accountNumber: "",
          iban: "",
          currency: "TRY",
        })
        fetchAccounts()
      } else {
        throw new Error("Oluşturulamadı")
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

  const handleTransactionSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!companyId) return

    setIsLoading(true)
    try {
      const response = await fetch("/api/finans/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...transactionFormData, companyId }),
      })

      if (response.ok) {
        toast({
          title: "Başarılı",
          description: "İşlem kaydedildi",
        })
        setIsTransactionDialogOpen(false)
        setTransactionFormData({
          accountId: "",
          type: "INCOME",
          amount: "",
          currency: "TRY",
          description: "",
          date: new Date().toISOString().split("T")[0],
          reference: "",
          customerId: "",
          supplierId: "",
        })
        fetchTransactions()
        fetchAccounts()
      } else {
        throw new Error("Kaydedilemedi")
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

  if (!companyId) {
    return (
      <div className="flex items-center justify-center p-8">
        <p className="text-muted-foreground">Lütfen bir firma seçin</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Finans Yönetimi</h1>
        <p className="text-muted-foreground">
          Kasa/Banka hesapları ve gelir/gider kayıtları
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)}>
        <TabsList>
          <TabsTrigger value="accounts">Hesaplar</TabsTrigger>
          <TabsTrigger value="transactions">İşlemler</TabsTrigger>
        </TabsList>

        <TabsContent value="accounts">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Kasa/Banka Hesapları</CardTitle>
                  <CardDescription>
                    Toplam {accounts.length} hesap
                  </CardDescription>
                </div>
                <Dialog open={isAccountDialogOpen} onOpenChange={setIsAccountDialogOpen}>
                  <DialogTrigger asChild>
                    <Button>
                      <Plus className="mr-2 h-4 w-4" />
                      Yeni Hesap
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-2xl">
                    <DialogHeader>
                      <DialogTitle>Yeni Hesap</DialogTitle>
                      <DialogDescription>
                        Kasa veya banka hesabı bilgilerini girin
                      </DialogDescription>
                    </DialogHeader>
                    <form onSubmit={handleAccountSubmit} className="space-y-4">
                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-2">
                          <Label htmlFor="code">Kod</Label>
                          <Input
                            id="code"
                            value={accountFormData.code}
                            onChange={(e) =>
                              setAccountFormData({ ...accountFormData, code: e.target.value })
                            }
                            disabled={isLoading}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="name">Ad *</Label>
                          <Input
                            id="name"
                            value={accountFormData.name}
                            onChange={(e) =>
                              setAccountFormData({ ...accountFormData, name: e.target.value })
                            }
                            required
                            disabled={isLoading}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="type">Tip *</Label>
                          <select
                            id="type"
                            value={accountFormData.type}
                            onChange={(e) =>
                              setAccountFormData({ ...accountFormData, type: e.target.value })
                            }
                            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                            required
                            disabled={isLoading}
                          >
                            <option value="CASH">Kasa</option>
                            <option value="BANK">Banka</option>
                          </select>
                        </div>
                        {accountFormData.type === "BANK" && (
                          <>
                            <div className="space-y-2">
                              <Label htmlFor="bankName">Banka Adı</Label>
                              <Input
                                id="bankName"
                                value={accountFormData.bankName}
                                onChange={(e) =>
                                  setAccountFormData({ ...accountFormData, bankName: e.target.value })
                                }
                                disabled={isLoading}
                              />
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor="accountNumber">Hesap No</Label>
                              <Input
                                id="accountNumber"
                                value={accountFormData.accountNumber}
                                onChange={(e) =>
                                  setAccountFormData({ ...accountFormData, accountNumber: e.target.value })
                                }
                                disabled={isLoading}
                              />
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor="iban">IBAN</Label>
                              <Input
                                id="iban"
                                value={accountFormData.iban}
                                onChange={(e) =>
                                  setAccountFormData({ ...accountFormData, iban: e.target.value })
                                }
                                disabled={isLoading}
                              />
                            </div>
                          </>
                        )}
                        <div className="space-y-2">
                          <Label htmlFor="currency">Para Birimi</Label>
                          <Input
                            id="currency"
                            value={accountFormData.currency}
                            onChange={(e) =>
                              setAccountFormData({ ...accountFormData, currency: e.target.value })
                            }
                            disabled={isLoading}
                          />
                        </div>
                      </div>
                      <div className="flex justify-end space-x-2">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => setIsAccountDialogOpen(false)}
                          disabled={isLoading}
                        >
                          İptal
                        </Button>
                        <Button type="submit" disabled={isLoading}>
                          {isLoading ? "Kaydediliyor..." : "Kaydet"}
                        </Button>
                      </div>
                    </form>
                  </DialogContent>
                </Dialog>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Kod</TableHead>
                    <TableHead>Ad</TableHead>
                    <TableHead>Tip</TableHead>
                    <TableHead>Banka</TableHead>
                    <TableHead>Hesap No</TableHead>
                    <TableHead className="text-right">Bakiye</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {accounts.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center">
                        Kayıt bulunamadı
                      </TableCell>
                    </TableRow>
                  ) : (
                    accounts.map((account) => (
                      <TableRow key={account.id}>
                        <TableCell>{account.code || "-"}</TableCell>
                        <TableCell className="font-medium">{account.name}</TableCell>
                        <TableCell>{account.type === "CASH" ? "Kasa" : "Banka"}</TableCell>
                        <TableCell>{account.bankName || "-"}</TableCell>
                        <TableCell>{account.accountNumber || "-"}</TableCell>
                        <TableCell className="text-right">
                          {new Intl.NumberFormat("tr-TR", {
                            style: "currency",
                            currency: account.currency,
                          }).format(Number(account.balance))}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="transactions">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Gelir/Gider İşlemleri</CardTitle>
                  <CardDescription>
                    Toplam {transactions.length} işlem
                  </CardDescription>
                </div>
                <Dialog open={isTransactionDialogOpen} onOpenChange={setIsTransactionDialogOpen}>
                  <DialogTrigger asChild>
                    <Button>
                      <Plus className="mr-2 h-4 w-4" />
                      Yeni İşlem
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-2xl">
                    <DialogHeader>
                      <DialogTitle>Yeni İşlem</DialogTitle>
                      <DialogDescription>
                        Gelir veya gider kaydı oluşturun
                      </DialogDescription>
                    </DialogHeader>
                    <form onSubmit={handleTransactionSubmit} className="space-y-4">
                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-2">
                          <Label htmlFor="accountId">Hesap *</Label>
                          <select
                            id="accountId"
                            value={transactionFormData.accountId}
                            onChange={(e) =>
                              setTransactionFormData({ ...transactionFormData, accountId: e.target.value })
                            }
                            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                            required
                            disabled={isLoading}
                          >
                            <option value="">Seçiniz</option>
                            {accounts.map((acc) => (
                              <option key={acc.id} value={acc.id}>
                                {acc.name}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="type">Tip *</Label>
                          <select
                            id="type"
                            value={transactionFormData.type}
                            onChange={(e) =>
                              setTransactionFormData({ ...transactionFormData, type: e.target.value })
                            }
                            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                            required
                            disabled={isLoading}
                          >
                            <option value="INCOME">Gelir</option>
                            <option value="EXPENSE">Gider</option>
                          </select>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="amount">Tutar *</Label>
                          <Input
                            id="amount"
                            type="number"
                            step="0.01"
                            value={transactionFormData.amount}
                            onChange={(e) =>
                              setTransactionFormData({ ...transactionFormData, amount: e.target.value })
                            }
                            required
                            disabled={isLoading}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="date">Tarih *</Label>
                          <Input
                            id="date"
                            type="date"
                            value={transactionFormData.date}
                            onChange={(e) =>
                              setTransactionFormData({ ...transactionFormData, date: e.target.value })
                            }
                            required
                            disabled={isLoading}
                          />
                        </div>
                        <div className="space-y-2 md:col-span-2">
                          <Label htmlFor="description">Açıklama</Label>
                          <Input
                            id="description"
                            value={transactionFormData.description}
                            onChange={(e) =>
                              setTransactionFormData({ ...transactionFormData, description: e.target.value })
                            }
                            disabled={isLoading}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="reference">Referans</Label>
                          <Input
                            id="reference"
                            value={transactionFormData.reference}
                            onChange={(e) =>
                              setTransactionFormData({ ...transactionFormData, reference: e.target.value })
                            }
                            disabled={isLoading}
                          />
                        </div>
                      </div>
                      <div className="flex justify-end space-x-2">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => setIsTransactionDialogOpen(false)}
                          disabled={isLoading}
                        >
                          İptal
                        </Button>
                        <Button type="submit" disabled={isLoading}>
                          {isLoading ? "Kaydediliyor..." : "Kaydet"}
                        </Button>
                      </div>
                    </form>
                  </DialogContent>
                </Dialog>
              </div>
            </CardHeader>
            <CardContent>
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
                  {transactions.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center">
                        Kayıt bulunamadı
                      </TableCell>
                    </TableRow>
                  ) : (
                    transactions.map((transaction) => (
                      <TableRow key={transaction.id}>
                        <TableCell>
                          {new Date(transaction.date).toLocaleDateString("tr-TR")}
                        </TableCell>
                        <TableCell>{transaction.account.name}</TableCell>
                        <TableCell>
                          {transaction.type === "INCOME" ? (
                            <span className="text-green-600">Gelir</span>
                          ) : (
                            <span className="text-red-600">Gider</span>
                          )}
                        </TableCell>
                        <TableCell>{transaction.description || "-"}</TableCell>
                        <TableCell className="text-right">
                          {new Intl.NumberFormat("tr-TR", {
                            style: "currency",
                            currency: transaction.account.currency,
                          }).format(transaction.amount)}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}

