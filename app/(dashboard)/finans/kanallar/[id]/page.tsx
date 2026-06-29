"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import {
  ArrowDownLeft,
  ArrowLeft,
  ArrowUpRight,
  Banknote,
  CreditCard,
  Edit,
  Loader2,
  Plus,
  Power,
  PowerOff,
  Repeat,
  Trash2,
  TrendingUp,
  Wallet,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
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
  StyledTableHead,
  StyledTableHeaderRow,
  StyledTableRow,
} from "@/components/ui/styled-table"
import { useConfirm } from "@/components/ui/confirm-dialog-provider"
import { useToast } from "@/components/ui/use-toast"
import { TransactionDialog } from "@/components/cari/transaction-dialog"

interface AccountTransaction {
  id: string
  date: string
  type: string
  amount: string | number
  description?: string | null
  reference?: string | null
  customer?: { id: string; name: string } | null
  supplier?: { id: string; name: string } | null
  linkedPayroll?: { periodMonth: number; periodYear: number } | null
}

interface AccountDetail {
  id: string
  companyId: string
  code?: string | null
  name: string
  type: string
  bankName?: string | null
  accountNumber?: string | null
  iban?: string | null
  currency: string
  balance: string | number
  isActive: boolean
  createdAt: string
  updatedAt: string
  transactions: AccountTransaction[]
  _count?: { transactions: number }
}

const accountTypeLabel = (type: string) =>
  type === "CASH" ? "Kasa" : type === "BANK" ? "Banka" : type

const formatAmount = (value: number, currency: string) =>
  `${value.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`

export default function FinansKanalDetayPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const router = useRouter()
  const { toast } = useToast()
  const { confirm } = useConfirm()

  const id = params.id as string
  const companyId = searchParams.get("company")
  const backHref = `/finans/kanallar?company=${encodeURIComponent(companyId || "")}`

  const [account, setAccount] = useState<AccountDetail | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showEdit, setShowEdit] = useState(false)
  const [showTransaction, setShowTransaction] = useState(false)
  const [deletingTxId, setDeletingTxId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState({
    code: "",
    name: "",
    type: "BANK",
    bankName: "",
    accountNumber: "",
    iban: "",
    currency: "TRY",
  })

  const fetchAccount = useCallback(async () => {
    setIsLoading(true)
    try {
      const res = await fetch(`/api/finans/accounts/${id}`, { cache: "no-store" })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast({ title: "Hata", description: data.error || "Hesap yüklenemedi", variant: "destructive" })
        setAccount(null)
        return
      }
      setAccount(data)
    } catch {
      toast({ title: "Hata", description: "Hesap yüklenemedi", variant: "destructive" })
    } finally {
      setIsLoading(false)
    }
  }, [id, toast])

  useEffect(() => {
    fetchAccount()
  }, [fetchAccount])

  const openEdit = () => {
    if (!account) return
    setEditForm({
      code: account.code || "",
      name: account.name,
      type: account.type,
      bankName: account.bankName || "",
      accountNumber: account.accountNumber || "",
      iban: account.iban || "",
      currency: account.currency,
    })
    setShowEdit(true)
  }

  const handleSaveEdit = async () => {
    if (!account) return
    if (!editForm.name.trim()) {
      toast({ title: "Hata", description: "Hesap adı zorunludur", variant: "destructive" })
      return
    }
    setIsSubmitting(true)
    try {
      const res = await fetch(`/api/finans/accounts/${account.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editForm),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast({ title: "Güncellenemedi", description: data.error || "İşlem başarısız", variant: "destructive" })
        return
      }
      toast({ title: "Güncellendi" })
      setShowEdit(false)
      fetchAccount()
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDeactivate = async () => {
    if (!account) return
    const ok = await confirm({
      title: "Hesabı pasifleştir",
      description: `"${account.name}" hesabını pasifleştirmek istediğinize emin misiniz? Pasif hesaplar yeni hareketlerde seçilemez; mevcut hareketler ve bakiye korunur.`,
      confirmLabel: "Pasifleştir",
      variant: "destructive",
    })
    if (!ok) return
    setIsSubmitting(true)
    try {
      const res = await fetch(`/api/finans/accounts/${account.id}`, { method: "DELETE" })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast({ title: "Pasifleştirilemedi", description: data.error || "İşlem başarısız", variant: "destructive" })
        return
      }
      toast({ title: "Hesap pasifleştirildi" })
      fetchAccount()
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDeleteTransaction = async (tx: AccountTransaction) => {
    const amount = Number(tx.amount)
    const ok = await confirm({
      title: "Hareketi sil",
      description: `${new Date(tx.date).toLocaleDateString("tr-TR")} · ${formatAmount(amount, account?.currency || "TRY")} — Bu hareketi silmek istediğinize emin misiniz? Eşleştiği fatura varsa açık tutarı yeniden açılır ve hesap bakiyesi düzeltilir.`,
      confirmLabel: "Sil",
      variant: "destructive",
    })
    if (!ok) return
    setDeletingTxId(tx.id)
    try {
      const res = await fetch(`/api/finans/transactions/${tx.id}`, { method: "DELETE" })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast({ title: "Silinemedi", description: data.error || "İşlem başarısız", variant: "destructive" })
        return
      }
      toast({ title: "Hareket silindi" })
      fetchAccount()
    } finally {
      setDeletingTxId(null)
    }
  }

  const handleReactivate = async () => {
    if (!account) return
    setIsSubmitting(true)
    try {
      const res = await fetch(`/api/finans/accounts/${account.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: account.code,
          name: account.name,
          type: account.type,
          bankName: account.bankName,
          accountNumber: account.accountNumber,
          iban: account.iban,
          currency: account.currency,
          isActive: true,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast({ title: "Etkinleştirilemedi", description: data.error || "İşlem başarısız", variant: "destructive" })
        return
      }
      toast({ title: "Hesap etkinleştirildi" })
      fetchAccount()
    } finally {
      setIsSubmitting(false)
    }
  }

  // Ekstre satırları: hesabın mevcut bakiyesinden geriye doğru yürüyen bakiye
  // hesaplanır. Liste API'den DESC (en yeni → en eski) geldiği için en üstteki
  // satırın bakiyesi mevcut bakiyedir; her satırda kendi etkisini "geri sarıp"
  // bir alttaki (daha eski) satırın bakiyesini elde ederiz.
  const enrichedRows = useMemo(() => {
    if (!account) return []
    let running = Number(account.balance || 0)
    return account.transactions.map((tx) => {
      const amount = Number(tx.amount)
      const isTransferLeg = Boolean(tx.reference?.startsWith("TRANSFER:"))
      const isTransferOut = tx.type === "TRANSFER"
      const isTransferIn = tx.type === "INCOME" && isTransferLeg
      const isIncome = tx.type === "INCOME" && !isTransferLeg
      const isExpense = tx.type === "EXPENSE"

      // Bu satırın hesap bakiyesine etkisi (bakiyeyi nasıl değiştirdi).
      const effect = isIncome || isTransferIn ? +amount : isExpense || isTransferOut ? -amount : 0
      const balanceAfter = running
      running -= effect

      const isLinked = isTransferLeg || Boolean(tx.linkedPayroll)
      return {
        tx,
        amount,
        isIncome,
        isExpense,
        isTransferIn,
        isTransferOut,
        isTransferLeg,
        isLinked,
        balanceAfter,
      }
    })
  }, [account])

  const totalIn = enrichedRows.reduce((s, r) => s + (r.isIncome || r.isTransferIn ? r.amount : 0), 0)
  const totalOut = enrichedRows.reduce((s, r) => s + (r.isExpense || r.isTransferOut ? r.amount : 0), 0)

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!account) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" asChild>
          <Link href={backHref}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Geri
          </Link>
        </Button>
        <div className="flex items-center justify-center p-8">
          <p className="text-muted-foreground">Hesap bulunamadı</p>
        </div>
      </div>
    )
  }

  const balance = Number(account.balance || 0)
  const isCash = account.type === "CASH"

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild>
            <Link href={backHref} aria-label="Geri">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div className="flex items-center gap-3">
            <span
              className={
                isCash
                  ? "flex h-11 w-11 items-center justify-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
                  : "flex h-11 w-11 items-center justify-center rounded-xl bg-kobipo-blue/10 text-kobipo-blue dark:bg-primary/15 dark:text-primary"
              }
            >
              {isCash ? <Banknote className="h-5 w-5" /> : <CreditCard className="h-5 w-5" />}
            </span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-bold">{account.name}</h1>
                <Badge variant="secondary">{accountTypeLabel(account.type)}</Badge>
                {!account.isActive && <Badge variant="destructive">Pasif</Badge>}
              </div>
              <p className="text-sm text-muted-foreground">
                {account.bankName ? account.bankName : "Kasa hesabı"}
                {account.code ? ` · Kod: ${account.code}` : ""}
              </p>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={openEdit}>
            <Edit className="mr-2 h-4 w-4" /> Düzenle
          </Button>
          {account.isActive ? (
            <>
              <Button onClick={() => setShowTransaction(true)}>
                <Plus className="mr-2 h-4 w-4" /> Yeni Hareket
              </Button>
              <Button
                variant="outline"
                className="text-rose-600 hover:text-rose-700 dark:text-rose-400 dark:hover:text-rose-300"
                onClick={handleDeactivate}
                disabled={isSubmitting}
              >
                <PowerOff className="mr-2 h-4 w-4" /> Pasifleştir
              </Button>
            </>
          ) : (
            <Button onClick={handleReactivate} disabled={isSubmitting}>
              <Power className="mr-2 h-4 w-4" /> Etkinleştir
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="flex items-start justify-between gap-3 p-5">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Mevcut Bakiye</p>
              <p
                className={`mt-1 font-mono text-2xl font-bold tabular-nums ${
                  balance < 0 ? "text-red-600 dark:text-red-400" : "text-foreground"
                }`}
              >
                {formatAmount(balance, account.currency)}
              </p>
            </div>
            <span className="rounded-xl bg-kobipo-blue/10 p-2.5 text-kobipo-blue dark:bg-primary/15 dark:text-primary">
              <Wallet className="h-5 w-5" />
            </span>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-start justify-between gap-3 p-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Hareket Sayısı</p>
              <p className="mt-1 font-mono text-2xl font-bold tabular-nums">
                {account._count?.transactions ?? account.transactions.length}
              </p>
            </div>
            <span className="rounded-xl bg-kobipo-green/10 p-2.5 text-kobipo-green-dark dark:bg-emerald-900/30 dark:text-emerald-300">
              <TrendingUp className="h-5 w-5" />
            </span>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-start justify-between gap-3 p-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Oluşturulma</p>
              <p className="mt-1 text-lg font-semibold">
                {new Date(account.createdAt).toLocaleDateString("tr-TR")}
              </p>
              <p className="text-xs text-muted-foreground">
                Güncelleme: {new Date(account.updatedAt).toLocaleDateString("tr-TR")}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Hesap Bilgileri</CardTitle>
          <CardDescription>
            {isCash ? "Kasa hesabı detayları" : "Banka hesabı detayları"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
            <Field label="Ad">{account.name}</Field>
            <Field label="Tür">{accountTypeLabel(account.type)}</Field>
            <Field label="Para Birimi">{account.currency}</Field>
            <Field label="Durum">{account.isActive ? "Aktif" : "Pasif"}</Field>
            {account.code ? <Field label="Kod">{account.code}</Field> : null}
            {!isCash && (
              <>
                {account.bankName ? <Field label="Banka">{account.bankName}</Field> : null}
                {account.accountNumber ? (
                  <Field label="Hesap No">{account.accountNumber}</Field>
                ) : null}
                {account.iban ? (
                  <Field label="IBAN" full>
                    <span className="font-mono">{account.iban}</span>
                  </Field>
                ) : null}
              </>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>Hesap Ekstresi</CardTitle>
              <CardDescription>
                {enrichedRows.length === 0
                  ? "Henüz hareket yok"
                  : `Son ${enrichedRows.length} hareket · en yeniden en eskiye`}
              </CardDescription>
            </div>
            {enrichedRows.length > 0 && (
              <div className="flex flex-wrap gap-4 text-xs">
                <span className="text-muted-foreground">
                  Giriş:{" "}
                  <span className="font-mono font-semibold text-green-600 tabular-nums">
                    +{formatAmount(totalIn, account.currency)}
                  </span>
                </span>
                <span className="text-muted-foreground">
                  Çıkış:{" "}
                  <span className="font-mono font-semibold text-red-600 tabular-nums">
                    -{formatAmount(totalOut, account.currency)}
                  </span>
                </span>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {enrichedRows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Bu hesaba ait henüz hareket bulunmuyor.
            </p>
          ) : (
            <StyledTableContainer>
              <Table>
                <TableHeader>
                  <StyledTableHeaderRow>
                    <StyledTableHead>Tarih</StyledTableHead>
                    <StyledTableHead>Tip</StyledTableHead>
                    <StyledTableHead>Açıklama</StyledTableHead>
                    <StyledTableHead>Cari</StyledTableHead>
                    <StyledTableHead className="text-right">Giriş</StyledTableHead>
                    <StyledTableHead className="text-right">Çıkış</StyledTableHead>
                    <StyledTableHead className="text-right">Bakiye</StyledTableHead>
                    <StyledTableHead className="w-10 text-right"></StyledTableHead>
                  </StyledTableHeaderRow>
                </TableHeader>
                <TableBody>
                  {enrichedRows.map((row, idx) => {
                    const { tx, amount, isIncome, isExpense, isTransferIn, isTransferOut, isTransferLeg, isLinked, balanceAfter } = row
                    const party = tx.customer || tx.supplier
                    const isDeletingThis = deletingTxId === tx.id
                    const payrollPeriod = tx.linkedPayroll
                      ? `${String(tx.linkedPayroll.periodMonth).padStart(2, "0")}/${tx.linkedPayroll.periodYear}`
                      : null
                    return (
                      <StyledTableRow
                        key={tx.id}
                        index={idx}
                        className="cursor-pointer"
                        onClick={() =>
                          router.push(
                            `/finans/hareketler/${tx.id}?company=${encodeURIComponent(companyId || "")}&from=${encodeURIComponent(`/finans/kanallar/${account.id}`)}`,
                          )
                        }
                      >
                        <TableCell className="whitespace-nowrap text-xs">
                          {new Date(tx.date).toLocaleDateString("tr-TR")}
                        </TableCell>
                        <TableCell>
                          {isTransferOut ? (
                            <span className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700 dark:bg-slate-500/15 dark:text-slate-300">
                              <Repeat className="h-3 w-3" /> Virman Çıkış
                            </span>
                          ) : isTransferIn ? (
                            <span className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700 dark:bg-slate-500/15 dark:text-slate-300">
                              <Repeat className="h-3 w-3" /> Virman Giriş
                            </span>
                          ) : isIncome ? (
                            <span className="inline-flex items-center gap-1 rounded bg-green-100 px-2 py-0.5 text-xs text-green-800 dark:bg-green-500/15 dark:text-green-300">
                              <ArrowDownLeft className="h-3 w-3" /> {tx.customer ? "Tahsilat" : "Gelir"}
                            </span>
                          ) : isExpense ? (
                            payrollPeriod ? (
                              <span className="inline-flex items-center gap-1 rounded bg-violet-100 px-2 py-0.5 text-xs text-violet-800 dark:bg-violet-500/15 dark:text-violet-300" title={`Bordro dönemi ${payrollPeriod}`}>
                                <ArrowUpRight className="h-3 w-3" /> Bordro · {payrollPeriod}
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 rounded bg-red-100 px-2 py-0.5 text-xs text-red-800 dark:bg-red-500/15 dark:text-red-300">
                                <ArrowUpRight className="h-3 w-3" /> {tx.supplier ? "Ödeme" : "Gider"}
                              </span>
                            )
                          ) : (
                            <Badge variant="secondary">{tx.type}</Badge>
                          )}
                        </TableCell>
                        <TableCell className="max-w-[260px] truncate text-xs" title={tx.description || tx.reference || ""}>
                          {tx.description || tx.reference || "-"}
                        </TableCell>
                        <TableCell className="text-xs">
                          {party ? party.name : <span className="text-muted-foreground">-</span>}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right font-mono text-sm tabular-nums text-green-600">
                          {isIncome || isTransferIn ? `+${formatAmount(amount, account.currency)}` : ""}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right font-mono text-sm tabular-nums text-red-600">
                          {isExpense || isTransferOut ? `-${formatAmount(amount, account.currency)}` : ""}
                        </TableCell>
                        <TableCell
                          className={`whitespace-nowrap text-right font-mono text-sm font-semibold tabular-nums ${
                            balanceAfter < 0 ? "text-red-600 dark:text-red-400" : "text-foreground"
                          }`}
                        >
                          {formatAmount(balanceAfter, account.currency)}
                        </TableCell>
                        <TableCell className="text-right">
                          {isLinked ? (
                            <span
                              className="inline-block h-7 w-7"
                              aria-hidden
                              title={
                                isTransferLeg
                                  ? "Virman işlemleri buradan silinemez"
                                  : payrollPeriod
                                    ? `Bordro ödemesine bağlı (${payrollPeriod}) — önce bordrodan ödemeyi geri alın`
                                    : undefined
                              }
                            />
                          ) : (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:text-rose-400 dark:hover:bg-rose-950/40 dark:hover:text-rose-300"
                              aria-label="Hareketi sil"
                              disabled={isDeletingThis}
                              onClick={(e) => {
                                e.stopPropagation()
                                handleDeleteTransaction(tx)
                              }}
                            >
                              {isDeletingThis ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Trash2 className="h-3.5 w-3.5" />
                              )}
                            </Button>
                          )}
                        </TableCell>
                      </StyledTableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </StyledTableContainer>
          )}
        </CardContent>
      </Card>

      <Dialog open={showEdit} onOpenChange={setShowEdit}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Hesabı Düzenle</DialogTitle>
            <DialogDescription>Hesap bilgilerini güncelleyin</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid gap-2">
              <Label>Tür</Label>
              <Select
                value={editForm.type}
                onValueChange={(v) => setEditForm({ ...editForm, type: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="BANK">Banka</SelectItem>
                  <SelectItem value="CASH">Kasa</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Ad *</Label>
              <Input
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
              />
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label>Kod</Label>
                <Input
                  value={editForm.code}
                  onChange={(e) => setEditForm({ ...editForm, code: e.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <Label>Para Birimi</Label>
                <Select
                  value={editForm.currency}
                  onValueChange={(v) => setEditForm({ ...editForm, currency: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="TRY">TRY</SelectItem>
                    <SelectItem value="USD">USD</SelectItem>
                    <SelectItem value="EUR">EUR</SelectItem>
                    <SelectItem value="GBP">GBP</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {editForm.type === "BANK" && (
              <>
                <div className="grid gap-2">
                  <Label>Banka Adı</Label>
                  <Input
                    value={editForm.bankName}
                    onChange={(e) => setEditForm({ ...editForm, bankName: e.target.value })}
                  />
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="grid gap-2">
                    <Label>Hesap No</Label>
                    <Input
                      value={editForm.accountNumber}
                      onChange={(e) => setEditForm({ ...editForm, accountNumber: e.target.value })}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label>IBAN</Label>
                    <Input
                      value={editForm.iban}
                      onChange={(e) => setEditForm({ ...editForm, iban: e.target.value })}
                    />
                  </div>
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEdit(false)} disabled={isSubmitting}>
              Vazgeç
            </Button>
            <Button onClick={handleSaveEdit} disabled={isSubmitting}>
              {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Kaydet
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {companyId && (
        <TransactionDialog
          open={showTransaction}
          onOpenChange={setShowTransaction}
          companyId={companyId}
          title="Yeni Hareket"
          description={`${account.name} hesabı için yeni hareket`}
          accounts={[{ id: account.id, name: account.name, bankName: account.bankName || undefined }]}
          onSuccess={fetchAccount}
        />
      )}
    </div>
  )
}

function Field({
  label,
  children,
  full,
}: {
  label: string
  children: React.ReactNode
  full?: boolean
}) {
  return (
    <div className={full ? "sm:col-span-2" : undefined}>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="mt-0.5 text-sm">{children}</div>
    </div>
  )
}
