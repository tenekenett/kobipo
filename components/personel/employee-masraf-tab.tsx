"use client"

// Personel kartı — MASRAFLAR sekmesi (çalışan masraf defteri).
//
// Çalışanın firma adına cebinden ödediği alış faturaları ve firmanın ona yaptığı
// geri ödemeler. Kural ve bakiye sunucuda (lib/personel/masraf-defteri.ts); burası
// yalnız gösterir, "Çalışana öde" ile geri ödeme yazar ve geri alır.

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { Loader2, Trash2, Wallet } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHeader } from "@/components/ui/table"
import {
  StyledTableContainer,
  StyledTableHeaderRow,
  StyledTableHead,
  StyledTableRow,
} from "@/components/ui/styled-table"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useToast } from "@/components/ui/use-toast"
import { useConfirm } from "@/components/ui/confirm-dialog-provider"
import { useCanEdit } from "@/components/dashboard/dashboard-company-provider"
import { useAccounts } from "@/lib/swr/use-company-data"
import { accountTypeLabel } from "@/lib/finans/account-types"
import { withCompanyHref } from "@/lib/company/href"
import { toDateInput } from "@/lib/format"
import type { EmployeeLedger } from "@/lib/personel/masraf-defteri"

const money = (n: number) =>
  `${n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₺`
const day = (d: string) => new Date(d).toLocaleDateString("tr-TR")

export function EmployeeMasrafTab({
  employeeId,
  employeeName,
  companyId,
}: {
  employeeId: string
  employeeName: string
  companyId: string | null
}) {
  const { toast } = useToast()
  const { confirm } = useConfirm()
  // Geri ödeme kasadan para çıkarır: bordro ödemesiyle aynı yetki (lib/page-access.ts).
  const canPay = useCanEdit("/personel/maas")
  const { accounts } = useAccounts(canPay ? companyId : null)

  const [ledger, setLedger] = useState<EmployeeLedger | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [payOpen, setPayOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ amount: "", accountId: "", date: toDateInput(new Date()), notes: "" })

  const load = useCallback(async () => {
    if (!companyId) return
    setLoadError(null)
    try {
      const res = await fetch(
        `/api/personel/masraf?companyId=${encodeURIComponent(companyId)}&employeeId=${encodeURIComponent(employeeId)}`,
      )
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || "Masraf kayıtları alınamadı")
      setLedger(data)
    } catch (e: any) {
      setLoadError(e?.message || "Masraf kayıtları alınamadı")
    }
  }, [companyId, employeeId])

  useEffect(() => {
    load()
  }, [load])

  function openPay() {
    const kasa = accounts.find((a) => a.type === "CASH") ?? accounts[0]
    setForm({
      amount: ledger && ledger.balance > 0 ? ledger.balance.toFixed(2) : "",
      accountId: kasa?.id ?? "",
      date: toDateInput(new Date()),
      notes: "",
    })
    setPayOpen(true)
  }

  async function savePay() {
    if (!companyId) return
    setSaving(true)
    try {
      const res = await fetch("/api/personel/masraf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId,
          employeeId,
          amount: Number(String(form.amount).replace(",", ".")),
          accountId: form.accountId,
          date: form.date,
          notes: form.notes,
        }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || "Ödeme kaydedilemedi")
      toast({ title: "Ödeme kaydedildi", description: `${employeeName} adına masraf iadesi kasadan düşüldü` })
      setPayOpen(false)
      load()
    } catch (e: any) {
      toast({ title: "Hata", description: e?.message || "Ödeme kaydedilemedi", variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  async function revert(entryId: string, amount: number) {
    if (!companyId) return
    const ok = await confirm({
      title: "Geri ödeme geri alınsın mı?",
      description: `${money(amount)} tutarındaki kasa hareketi silinir ve hesabın bakiyesi geri yazılır. Çalışana olan borç yeniden açılır.`,
      confirmLabel: "Geri al",
      variant: "destructive",
    })
    if (!ok) return
    const res = await fetch(`/api/personel/masraf/${entryId}?companyId=${encodeURIComponent(companyId)}`, {
      method: "DELETE",
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      toast({ title: "Hata", description: data?.error || "Geri alınamadı", variant: "destructive" })
      return
    }
    toast({ title: "Geri alındı" })
    load()
  }

  if (loadError) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-destructive">{loadError}</CardContent>
      </Card>
    )
  }
  if (!ledger) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Yükleniyor…
      </div>
    )
  }

  const rows = [...ledger.rows].reverse() // en yeni üstte; bakiye sütunu eskiden yeniye yürür

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Cebinden ödediği</p>
            <p className="text-xl font-bold">{money(ledger.totalExpense)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Geri ödenen</p>
            <p className="text-xl font-bold">{money(ledger.totalReimbursed)}</p>
          </CardContent>
        </Card>
        <Card className={ledger.balance > 0 ? "border-amber-300 dark:border-amber-800" : undefined}>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">
              {ledger.balance >= 0 ? "Firmanın çalışana borcu" : "Çalışanın firmaya borcu"}
            </p>
            <p className="text-xl font-bold">{money(Math.abs(ledger.balance))}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">Masraf Hareketleri</CardTitle>
            {canPay && ledger.balance > 0 && (
              <Button size="sm" onClick={openPay}>
                <Wallet className="mr-1 h-4 w-4" /> Çalışana Öde
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Alış faturasında &quot;Çalışan Cebinden Ödedi&quot; seçilince fatura kapanır ve tutar buraya
            firmanın borcu olarak yazılır. Geri ödeme kasadan/bankadan çıkar ama gider olarak ikinci
            kez sayılmaz; gider faturanın kendisidir.
          </p>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <div className="text-sm text-muted-foreground">Bu çalışanın masraf kaydı yok.</div>
          ) : (
            <StyledTableContainer>
              <Table>
                <TableHeader>
                  <StyledTableHeaderRow>
                    <StyledTableHead>Tarih</StyledTableHead>
                    <StyledTableHead>İşlem</StyledTableHead>
                    <StyledTableHead>Açıklama</StyledTableHead>
                    <StyledTableHead className="text-right">Tutar</StyledTableHead>
                    <StyledTableHead className="text-right">Bakiye</StyledTableHead>
                    <StyledTableHead className="w-[50px]" />
                  </StyledTableHeaderRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r, idx) => (
                    <StyledTableRow key={r.id} index={idx}>
                      <TableCell className="whitespace-nowrap">{day(r.date)}</TableCell>
                      <TableCell>
                        {r.kind === "EXPENSE" ? (
                          <Badge variant="secondary">Cebinden ödedi</Badge>
                        ) : (
                          <Badge variant="default">Geri ödendi</Badge>
                        )}
                      </TableCell>
                      <TableCell className="min-w-0">
                        {r.invoice ? (
                          <Link
                            href={withCompanyHref(`/faturalar/${r.invoice.slug}/onizleme`, companyId)}
                            className="font-medium text-kobipo-navy underline-offset-2 hover:underline dark:text-foreground"
                          >
                            {r.invoice.invoiceNo}
                          </Link>
                        ) : r.account ? (
                          <span>{r.account.name}</span>
                        ) : null}
                        {r.invoice?.supplierName && (
                          <span className="block text-xs text-muted-foreground">{r.invoice.supplierName}</span>
                        )}
                        {r.kind === "REIMBURSEMENT" && r.notes && (
                          <span className="block text-xs text-muted-foreground">{r.notes}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {r.kind === "EXPENSE" ? "+" : "−"}
                        {money(r.amount)}
                      </TableCell>
                      <TableCell className="text-right">{money(r.runningBalance)}</TableCell>
                      <TableCell className="text-right">
                        {r.kind === "REIMBURSEMENT" && canPay && (
                          <Button
                            size="sm"
                            variant="ghost"
                            title="Geri ödemeyi geri al"
                            onClick={() => revert(r.id, r.amount)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        )}
                      </TableCell>
                    </StyledTableRow>
                  ))}
                </TableBody>
              </Table>
            </StyledTableContainer>
          )}
        </CardContent>
      </Card>

      <Dialog open={payOpen} onOpenChange={(o) => !saving && setPayOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Çalışana Öde — {employeeName}</DialogTitle>
            <DialogDescription>
              Çalışanın cebinden ödediği masraflar için firmanın borcu {money(ledger.balance)}. Tutar
              seçilen hesaptan düşülür.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="masraf-tutar">Tutar (₺)</Label>
              <Input
                id="masraf-tutar"
                inputMode="decimal"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Hesap</Label>
              {accounts.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Kasa/banka hesabı bulunamadı. Finans → Kanallar ekranından hesap açın.
                </p>
              ) : (
                <Select value={form.accountId || undefined} onValueChange={(v) => setForm({ ...form, accountId: v })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Kasa / banka seçin" />
                  </SelectTrigger>
                  <SelectContent>
                    {accounts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name} ({accountTypeLabel(a.type)})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="masraf-tarih">Tarih</Label>
              <Input
                id="masraf-tarih"
                type="date"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="masraf-not">Not</Label>
              <Input
                id="masraf-not"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="İsteğe bağlı"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayOpen(false)} disabled={saving}>
              İptal
            </Button>
            <Button onClick={savePay} disabled={saving || !form.accountId || !(Number(form.amount.replace(",", ".")) > 0)}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Öde
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
