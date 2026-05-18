"use client"

import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/components/ui/use-toast"
import { Banknote, CreditCard, Plus, Wallet } from "lucide-react"

interface Account {
  id: string
  code?: string | null
  name: string
  type: string
  bankName?: string | null
  accountNumber?: string | null
  iban?: string | null
  currency: string
  balance: number | string
  isActive: boolean
}

const accountTypeLabel = (type: string) =>
  type === "CASH" ? "Kasa" : type === "BANK" ? "Banka" : type

export default function FinansKanallariPage() {
  const searchParams = useSearchParams()
  const companyId = searchParams.get("company")
  const { toast } = useToast()

  const [accounts, setAccounts] = useState<Account[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [form, setForm] = useState({
    code: "",
    name: "",
    type: "BANK",
    bankName: "",
    accountNumber: "",
    iban: "",
    currency: "TRY",
  })

  const fetchAccounts = async () => {
    if (!companyId) return
    setIsLoading(true)
    try {
      const res = await fetch(`/api/finans/accounts?companyId=${companyId}`, { cache: "no-store" })
      if (res.ok) {
        const data = (await res.json()) as Account[]
        setAccounts(data)
      }
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchAccounts()
  }, [companyId])

  const handleCreate = async () => {
    if (!companyId) return
    if (!form.name) {
      toast({ title: "Hata", description: "Hesap adı zorunludur", variant: "destructive" })
      return
    }
    setIsSaving(true)
    try {
      const res = await fetch("/api/finans/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, ...form }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.error || "Kanal oluşturulamadı")
      }
      toast({ title: "Başarılı", description: "Finans kanalı eklendi" })
      setShowCreate(false)
      setForm({ code: "", name: "", type: "BANK", bankName: "", accountNumber: "", iban: "", currency: "TRY" })
      fetchAccounts()
    } catch (e) {
      toast({ title: "Hata", description: e instanceof Error ? e.message : "Bilinmeyen hata", variant: "destructive" })
    } finally {
      setIsSaving(false)
    }
  }

  if (!companyId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Finans Kanalları</CardTitle>
          <CardDescription>Lütfen bir firma seçin</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  const totalBalance = accounts.reduce((sum, a) => sum + Number(a.balance || 0), 0)
  const bankCount = accounts.filter((a) => a.type === "BANK").length
  const cashCount = accounts.filter((a) => a.type === "CASH").length

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-kobipo-navy dark:text-foreground">Finans Kanalları</h1>
          <p className="text-sm text-muted-foreground">Kasa ve banka hesaplarınızı yönetin</p>
        </div>
        <Button onClick={() => setShowCreate(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Yeni Kanal
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="flex items-start justify-between gap-3 p-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Toplam Bakiye</p>
              <p className="mt-1 font-mono text-2xl font-bold tabular-nums">
                ₺{totalBalance.toLocaleString("tr-TR", { minimumFractionDigits: 2 })}
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
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Banka Hesabı</p>
              <p className="mt-1 font-mono text-2xl font-bold tabular-nums">{bankCount}</p>
            </div>
            <span className="rounded-xl bg-kobipo-green/10 p-2.5 text-kobipo-green-dark dark:bg-emerald-900/30 dark:text-emerald-300">
              <CreditCard className="h-5 w-5" />
            </span>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-start justify-between gap-3 p-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Kasa</p>
              <p className="mt-1 font-mono text-2xl font-bold tabular-nums">{cashCount}</p>
            </div>
            <span className="rounded-xl bg-amber-100 p-2.5 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
              <Banknote className="h-5 w-5" />
            </span>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Hesaplar</CardTitle>
          <CardDescription>Toplam {accounts.length} aktif kanal</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Yükleniyor…</p>
          ) : accounts.length === 0 ? (
            <div className="py-10 text-center">
              <p className="text-sm font-medium">Henüz kanal eklenmemiş</p>
              <p className="mt-1 text-xs text-muted-foreground">
                İlk kasa veya banka hesabınızı ekleyerek nakit hareketlerini takip etmeye başlayın.
              </p>
              <Button className="mt-4" onClick={() => setShowCreate(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Yeni Kanal
              </Button>
            </div>
          ) : (
            <div className="divide-y rounded-lg border">
              {accounts.map((acc) => (
                <div key={acc.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <span
                      className={
                        acc.type === "BANK"
                          ? "flex h-9 w-9 items-center justify-center rounded-lg bg-kobipo-blue/10 text-kobipo-blue dark:bg-primary/15 dark:text-primary"
                          : "flex h-9 w-9 items-center justify-center rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
                      }
                    >
                      {acc.type === "BANK" ? <CreditCard className="h-4 w-4" /> : <Banknote className="h-4 w-4" />}
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="truncate font-medium">{acc.name}</p>
                        <Badge variant="secondary">{accountTypeLabel(acc.type)}</Badge>
                      </div>
                      <p className="truncate text-xs text-muted-foreground">
                        {acc.bankName ? `${acc.bankName}` : "Kasa hesabı"}
                        {acc.iban ? ` · ${acc.iban}` : acc.accountNumber ? ` · ${acc.accountNumber}` : ""}
                      </p>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-mono text-sm font-semibold tabular-nums">
                      {Number(acc.balance || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2 })}{" "}
                      <span className="text-xs text-muted-foreground">{acc.currency}</span>
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Yeni Finans Kanalı</DialogTitle>
            <DialogDescription>Kasa veya banka hesabı ekleyin</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid gap-2">
              <Label>Tür</Label>
              <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
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
                placeholder="Ana Banka Hesabı"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label>Kod</Label>
                <Input
                  placeholder="100"
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <Label>Para Birimi</Label>
                <Select value={form.currency} onValueChange={(v) => setForm({ ...form, currency: v })}>
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
            {form.type === "BANK" && (
              <>
                <div className="grid gap-2">
                  <Label>Banka Adı</Label>
                  <Input
                    placeholder="Garanti BBVA"
                    value={form.bankName}
                    onChange={(e) => setForm({ ...form, bankName: e.target.value })}
                  />
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="grid gap-2">
                    <Label>Hesap No</Label>
                    <Input
                      value={form.accountNumber}
                      onChange={(e) => setForm({ ...form, accountNumber: e.target.value })}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label>IBAN</Label>
                    <Input
                      placeholder="TR…"
                      value={form.iban}
                      onChange={(e) => setForm({ ...form, iban: e.target.value })}
                    />
                  </div>
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)} disabled={isSaving}>
              Vazgeç
            </Button>
            <Button onClick={handleCreate} disabled={isSaving}>
              {isSaving ? "Kaydediliyor…" : "Kaydet"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
