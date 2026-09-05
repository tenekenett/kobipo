"use client"

import { WriteAction } from "@/components/dashboard/write-guard"
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
import {
  StyledTableContainer,
  StyledTableHeaderRow,
  StyledTableHead,
  StyledTableRow,
  EntityCell,
  MonoCell,
} from "@/components/ui/styled-table"
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
import { CategoryCombobox } from "@/components/e-donusum/category-combobox"
import {
  FINANCIAL_ACCOUNT_TYPES,
  accountHasBankFields,
  accountTypeLabel,
} from "@/lib/finans/account-types"
import { toDateInput } from "@/lib/format"

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
    transferAccountId: "",
    type: "INCOME",
    amount: "",
    currency: "TRY",
    description: "",
    date: toDateInput(new Date()),
    reference: "",
    customerId: "",
    supplierId: "",
    category: "",
  })

  /**
   * Kategori önerileri — fatura formuyla AYNI kümeden (uç ikisini birleştirir).
   * Hata olursa sessizce boş kalır; form serbest metinle çalışmaya devam eder.
   */
  const [categoryOptions, setCategoryOptions] = useState<string[]>([])

  useEffect(() => {
    if (companyId) {
      fetchAccounts()
      if (activeTab === "transactions") {
        fetchTransactions()
      }
    }
  }, [companyId, activeTab])

  useEffect(() => {
    if (!companyId) return
    fetch(`/api/finans/transactions/classifications?companyId=${encodeURIComponent(companyId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.categories) setCategoryOptions(d.categories)
      })
      .catch(() => {})
  }, [companyId])

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
          transferAccountId: "",
          type: "INCOME",
          amount: "",
          currency: "TRY",
          description: "",
          date: toDateInput(new Date()),
          reference: "",
          customerId: "",
          supplierId: "",
          category: "",
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
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle>Kasa/Banka Hesapları</CardTitle>
                  <CardDescription>
                    Toplam {accounts.length} hesap
                  </CardDescription>
                </div>
                <Dialog open={isAccountDialogOpen} onOpenChange={setIsAccountDialogOpen}>
                  <DialogTrigger asChild>
                    <WriteAction><Button>
                      <Plus className="mr-2 h-4 w-4" />
                      Yeni Hesap
                    </Button></WriteAction>
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
                            {FINANCIAL_ACCOUNT_TYPES.map((t) => (
                              <option key={t.value} value={t.value}>
                                {t.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        {accountHasBankFields(accountFormData.type) && (
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
                        <WriteAction><Button type="submit" disabled={isLoading}>
                          {isLoading ? "Kaydediliyor..." : "Kaydet"}
                        </Button></WriteAction>
                      </div>
                    </form>
                  </DialogContent>
                </Dialog>
              </div>
            </CardHeader>
            <CardContent>
              <StyledTableContainer>
              <Table>
                <TableHeader>
                  <StyledTableHeaderRow>
                    <StyledTableHead>Kod</StyledTableHead>
                    <StyledTableHead>Ad</StyledTableHead>
                    <StyledTableHead>Tip</StyledTableHead>
                    <StyledTableHead>Banka</StyledTableHead>
                    <StyledTableHead>Hesap No</StyledTableHead>
                    <StyledTableHead className="text-right">Bakiye</StyledTableHead>
                  </StyledTableHeaderRow>
                </TableHeader>
                <TableBody>
                  {accounts.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center">
                        Kayıt bulunamadı
                      </TableCell>
                    </TableRow>
                  ) : (
                    accounts.map((account, idx) => (
                      <StyledTableRow key={account.id} index={idx}>
                        <TableCell><MonoCell value={account.code} /></TableCell>
                        <TableCell className="font-medium">
                          <EntityCell name={account.name} />
                        </TableCell>
                        <TableCell className="text-xs">{accountTypeLabel(account.type)}</TableCell>
                        <TableCell className="text-xs">{account.bankName || "-"}</TableCell>
                        <TableCell><MonoCell value={account.accountNumber} /></TableCell>
                        <TableCell className="text-right font-semibold whitespace-nowrap">
                          {new Intl.NumberFormat("tr-TR", {
                            style: "currency",
                            currency: account.currency,
                          }).format(Number(account.balance))}
                        </TableCell>
                      </StyledTableRow>
                    ))
                  )}
                </TableBody>
              </Table>
              </StyledTableContainer>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="transactions">
          <Card>
            <CardHeader>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle>Gelir/Gider İşlemleri</CardTitle>
                  <CardDescription>
                    Toplam {transactions.length} işlem
                  </CardDescription>
                </div>
                <Dialog open={isTransactionDialogOpen} onOpenChange={setIsTransactionDialogOpen}>
                  <DialogTrigger asChild>
                    <WriteAction><Button>
                      <Plus className="mr-2 h-4 w-4" />
                      Yeni İşlem
                    </Button></WriteAction>
                  </DialogTrigger>
                  <DialogContent className="max-w-2xl">
                    <DialogHeader>
                      <DialogTitle>Yeni İşlem</DialogTitle>
                      <DialogDescription>
                        Gelir, gider veya virman kaydı oluşturun
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
                            <option value="TRANSFER">Virman</option>
                          </select>
                        </div>
                        {transactionFormData.type === "TRANSFER" && (
                          <div className="space-y-2">
                            <Label htmlFor="transferAccountId">Hedef Hesap *</Label>
                            <select
                              id="transferAccountId"
                              value={transactionFormData.transferAccountId}
                              onChange={(e) =>
                                setTransactionFormData({ ...transactionFormData, transferAccountId: e.target.value })
                              }
                              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                              required
                              disabled={isLoading}
                            >
                              <option value="">Seçiniz</option>
                              {accounts
                                .filter((acc) => acc.id !== transactionFormData.accountId)
                                .map((acc) => (
                                  <option key={acc.id} value={acc.id}>
                                    {acc.name}
                                  </option>
                                ))}
                            </select>
                          </div>
                        )}
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
                        {/* Kategori yalnız GELİR/GİDERDE sorulur: virman iki kendi
                            hesabımız arasında para taşır, gider değildir — kategori
                            sorulsaydı gelir-gider raporunda sahte bir kalem açardı. */}
                        {transactionFormData.type !== "TRANSFER" && (
                          <div className="space-y-2 md:col-span-2">
                            <Label>Kategori</Label>
                            <CategoryCombobox
                              value={transactionFormData.category}
                              options={categoryOptions}
                              onChange={(next) =>
                                setTransactionFormData({ ...transactionFormData, category: next })
                              }
                              onCreateOption={(next) =>
                                setCategoryOptions((prev) =>
                                  prev.includes(next) ? prev : [...prev, next],
                                )
                              }
                              placeholder="Örn. Kira, Maaş, Akaryakıt"
                              disabled={isLoading}
                            />
                            <p className="text-xs text-muted-foreground">
                              Gelir-Gider (Karlılık) raporundaki kırılım bu alandan çıkar.
                            </p>
                          </div>
                        )}
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
                        <WriteAction><Button type="submit" disabled={isLoading}>
                          {isLoading ? "Kaydediliyor..." : "Kaydet"}
                        </Button></WriteAction>
                      </div>
                    </form>
                  </DialogContent>
                </Dialog>
              </div>
            </CardHeader>
            <CardContent>
              <StyledTableContainer>
              <Table>
                <TableHeader>
                  <StyledTableHeaderRow>
                    <StyledTableHead>Tarih</StyledTableHead>
                    <StyledTableHead>Hesap</StyledTableHead>
                    <StyledTableHead>Tip</StyledTableHead>
                    <StyledTableHead>Açıklama</StyledTableHead>
                    <StyledTableHead className="text-right">Tutar</StyledTableHead>
                  </StyledTableHeaderRow>
                </TableHeader>
                <TableBody>
                  {transactions.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center">
                        Kayıt bulunamadı
                      </TableCell>
                    </TableRow>
                  ) : (
                    transactions.map((transaction, idx) => (
                      <StyledTableRow
                        key={transaction.id}
                        index={idx}
                        className="cursor-pointer"
                        // Satırın tamamı bağlantı yüzeyi: sağ tık → "yeni sekmede aç".
                        href={`/finans/hareketler/${transaction.id}?company=${encodeURIComponent(companyId || "")}&from=${encodeURIComponent("/finans")}`}
                        hrefLabel={`${transaction.description || "Hareket"} detayı`}
                      >
                        <TableCell className="text-xs whitespace-nowrap">
                          {new Date(transaction.date).toLocaleDateString("tr-TR")}
                        </TableCell>
                        <TableCell>
                          <EntityCell name={transaction.account.name} />
                        </TableCell>
                        <TableCell>
                          {transaction.type === "INCOME" ? (
                            <span className="text-green-600 text-xs font-medium">Gelir</span>
                          ) : transaction.type === "TRANSFER" ? (
                            <span className="text-blue-600 text-xs font-medium">Virman</span>
                          ) : (
                            <span className="text-red-600 text-xs font-medium">Gider</span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs">{transaction.description || "-"}</TableCell>
                        <TableCell className="text-right font-semibold whitespace-nowrap">
                          {new Intl.NumberFormat("tr-TR", {
                            style: "currency",
                            currency: transaction.account.currency,
                          }).format(transaction.amount)}
                        </TableCell>
                      </StyledTableRow>
                    ))
                  )}
                </TableBody>
              </Table>
              </StyledTableContainer>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}

