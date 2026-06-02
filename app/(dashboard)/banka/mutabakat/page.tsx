"use client"

import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Plus } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

interface BankStatement {
  id: string
  statementDate: string
  openingBalance: number
  closingBalance: number
  isReconciled: boolean
  account: {
    name: string
    bankName?: string
  }
  items: Array<{
    id: string
    transactionDate: string
    description: string
    amount: number
    balance?: number
    isMatched: boolean
  }>
}

export default function BankaMutabakatPage() {
  const searchParams = useSearchParams()
  const companyId = searchParams.get("company")
  const [statements, setStatements] = useState<BankStatement[]>([])
  const [accounts, setAccounts] = useState<Array<{ id: string; name: string }>>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [form, setForm] = useState({
    accountId: "",
    statementDate: "",
    openingBalance: "",
    closingBalance: "",
  })

  useEffect(() => {
    if (companyId) {
      fetchStatements()
      fetchAccounts()
    }
  }, [companyId])

  const fetchStatements = async () => {
    if (!companyId) return
    setIsLoading(true)
    try {
      const response = await fetch(`/api/banka/mutabakat?companyId=${companyId}`)
      if (response.ok) {
        const data = await response.json()
        setStatements(data)
      }
    } catch (error) {
      console.error("Error fetching statements:", error)
    } finally {
      setIsLoading(false)
    }
  }

  const fetchAccounts = async () => {
    if (!companyId) return
    const response = await fetch(`/api/finans/accounts?companyId=${companyId}`)
    if (response.ok) {
      const data = await response.json()
      setAccounts(data.filter((item: any) => item.type === "BANK"))
    }
  }

  const createStatement = async () => {
    if (!companyId || !form.accountId || !form.statementDate) return
    const response = await fetch("/api/banka/mutabakat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyId,
        accountId: form.accountId,
        statementDate: form.statementDate,
        openingBalance: form.openingBalance || "0",
        closingBalance: form.closingBalance || "0",
        items: [
          {
            transactionDate: form.statementDate,
            description: "Açılış kaydı",
            amount: Number(form.closingBalance || 0) - Number(form.openingBalance || 0),
            balance: Number(form.closingBalance || 0),
          },
        ],
      }),
    })
    if (response.ok) {
      setIsCreateOpen(false)
      setForm({ accountId: "", statementDate: "", openingBalance: "", closingBalance: "" })
      fetchStatements()
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
          <CardTitle>Banka Mutabakatı</CardTitle>
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
              <CardTitle>Banka Mutabakatı</CardTitle>
              <CardDescription>Banka ekstreleri ve mutabakat işlemleri</CardDescription>
            </div>
            <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="mr-2 h-4 w-4" />
                  Yeni Ekstre
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Yeni Banka Ekstresi</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <Select value={form.accountId} onValueChange={(value) => setForm((prev) => ({ ...prev, accountId: value }))}>
                    <SelectTrigger><SelectValue placeholder="Banka hesabı seçin" /></SelectTrigger>
                    <SelectContent>
                      {accounts.map((account) => <SelectItem key={account.id} value={account.id}>{account.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Input type="date" value={form.statementDate} onChange={(e) => setForm((prev) => ({ ...prev, statementDate: e.target.value }))} />
                  <Input type="number" placeholder="Açılış bakiyesi" value={form.openingBalance} onChange={(e) => setForm((prev) => ({ ...prev, openingBalance: e.target.value }))} />
                  <Input type="number" placeholder="Kapanış bakiyesi" value={form.closingBalance} onChange={(e) => setForm((prev) => ({ ...prev, closingBalance: e.target.value }))} />
                  <Button className="w-full" onClick={createStatement}>Kaydet</Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8">Yükleniyor...</div>
          ) : statements.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              Henüz banka ekstresi bulunmuyor
            </div>
          ) : (
            <div className="space-y-6">
              {statements.map((statement) => (
                <Card key={statement.id}>
                  <CardHeader>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <CardTitle>{statement.account.name}</CardTitle>
                        <CardDescription>
                          {new Date(statement.statementDate).toLocaleDateString("tr-TR")}
                        </CardDescription>
                      </div>
                      <Badge variant={statement.isReconciled ? "default" : "secondary"}>
                        {statement.isReconciled ? "Mutabık" : "Mutabakat Bekliyor"}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
                      <div>
                        <p className="text-sm text-muted-foreground">Açılış Bakiyesi</p>
                        <p className="font-medium">{formatCurrency(statement.openingBalance)}</p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Kapanış Bakiyesi</p>
                        <p className="font-medium">{formatCurrency(statement.closingBalance)}</p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">İşlem Sayısı</p>
                        <p className="font-medium">{statement.items.length}</p>
                      </div>
                    </div>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Tarih</TableHead>
                          <TableHead>Açıklama</TableHead>
                          <TableHead className="text-right">Tutar</TableHead>
                          <TableHead className="text-right">Bakiye</TableHead>
                          <TableHead>Durum</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {statement.items.map((item) => (
                          <TableRow key={item.id}>
                            <TableCell>
                              {new Date(item.transactionDate).toLocaleDateString("tr-TR")}
                            </TableCell>
                            <TableCell>{item.description}</TableCell>
                            <TableCell className={`text-right ${item.amount >= 0 ? "text-green-600" : "text-red-600"}`}>
                              {formatCurrency(item.amount)}
                            </TableCell>
                            <TableCell className="text-right">
                              {item.balance ? formatCurrency(item.balance) : "-"}
                            </TableCell>
                            <TableCell>
                              <Badge variant={item.isMatched ? "default" : "secondary"}>
                                {item.isMatched ? "Eşleşti" : "Eşleşmedi"}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

