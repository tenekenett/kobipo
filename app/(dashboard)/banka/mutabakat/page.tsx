"use client"

import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Plus } from "lucide-react"

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
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (companyId) {
      fetchStatements()
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
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Banka Mutabakatı</CardTitle>
              <CardDescription>Banka ekstreleri ve mutabakat işlemleri</CardDescription>
            </div>
            <Button disabled>
              <Plus className="mr-2 h-4 w-4" />
              Yeni Ekstre
            </Button>
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
                    <div className="flex items-center justify-between">
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
                    <div className="grid grid-cols-3 gap-4 mb-4">
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

