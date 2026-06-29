"use client"

import { useEffect, useState } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  StyledTableContainer,
  StyledTableHeaderRow,
  StyledTableHead,
  StyledTableRow,
  EntityCell,
} from "@/components/ui/styled-table"
import { Plus } from "lucide-react"
import { TransactionDialog } from "@/components/cari/transaction-dialog"

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
  const router = useRouter()
  const companyId = searchParams.get("company")
  const customerId = searchParams.get("customerId")
  const supplierId = searchParams.get("supplierId")
  const [accounts, setAccounts] = useState<FinancialAccount[]>([])
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

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
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>Finans Hareketleri</CardTitle>
              <CardDescription>Gelir ve gider işlemleri</CardDescription>
            </div>
            <Button onClick={() => setIsDialogOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Yeni Hareket
            </Button>
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
                {transactions.map((tx, idx) => (
                  <StyledTableRow
                    key={tx.id}
                    index={idx}
                    className="cursor-pointer"
                    onClick={() =>
                      router.push(
                        `/finans/hareketler/${tx.id}?company=${encodeURIComponent(companyId || "")}&from=${encodeURIComponent("/finans/hareketler")}`,
                      )
                    }
                  >
                    <TableCell className="text-xs whitespace-nowrap">
                      {new Date(tx.date).toLocaleDateString("tr-TR")}
                    </TableCell>
                    <TableCell>
                      <EntityCell name={tx.account.name} />
                    </TableCell>
                    <TableCell>
                      <span className={`px-2 py-1 rounded text-xs ${
                        tx.type === "INCOME" ? "bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300" : "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300"
                      }`}>
                        {tx.type === "INCOME" ? "Gelir" : "Gider"}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs">{tx.description || "-"}</TableCell>
                    <TableCell className={`text-right font-semibold whitespace-nowrap ${
                      tx.type === "INCOME" ? "text-green-600" : "text-red-600"
                    }`}>
                      {tx.type === "INCOME" ? "+" : "-"}
                      {formatCurrency(tx.amount)}
                    </TableCell>
                  </StyledTableRow>
                ))}
              </TableBody>
            </Table>
            </StyledTableContainer>
          )}
        </CardContent>
      </Card>
      {companyId && (
        <TransactionDialog
          open={isDialogOpen}
          onOpenChange={setIsDialogOpen}
          companyId={companyId}
          title="Yeni Finans Hareketi"
          description="Gelir veya gider işlemi ekleyin"
          customerId={customerId}
          supplierId={supplierId}
          lockedType={customerId ? "INCOME" : supplierId ? "EXPENSE" : undefined}
          accounts={accounts}
          onSuccess={fetchTransactions}
        />
      )}
    </div>
  )
}

