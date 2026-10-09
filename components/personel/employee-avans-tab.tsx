"use client"

// Personel kartı — AVANSLAR sekmesi (lib/personel/avans.ts).
//
// Maaştan önce verilen avans kasadan çıkar (Transaction.purpose = ADVANCE), bordrodaki
// "Avans" alanı aynı avansı maaştan düşer. Açık avans = verilen − geri alınan − bordrodan
// düşülen. Yazma yetkisi bordro ve masraf iadesiyle aynı sayfaya bağlı (/personel/maas).

import { useCallback, useEffect, useState } from "react"
import { Banknote, Loader2, Trash2, Undo2 } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHeader } from "@/components/ui/table"
import { StyledTableContainer, StyledTableHeaderRow, StyledTableHead, StyledTableRow } from "@/components/ui/styled-table"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useToast } from "@/components/ui/use-toast"
import { useConfirm } from "@/components/ui/confirm-dialog-provider"
import { useCanEdit } from "@/components/dashboard/dashboard-company-provider"
import { useAccounts } from "@/lib/swr/use-company-data"
import { accountTypeLabel } from "@/lib/finans/account-types"
import { toDateInput } from "@/lib/format"
import type { AvansSatiri } from "@/lib/personel/avans"

const money = (n: number) => `${n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₺`
const day = (d: string) => new Date(d).toLocaleDateString("tr-TR")

type Defter = { satirlar: AvansSatiri[]; bakiye: number }

export function EmployeeAvansTab({
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
  const canPay = useCanEdit("/personel/maas")
  const { accounts } = useAccounts(canPay ? companyId : null)
  const tlHesaplar = accounts.filter((a) => (a.currency || "TRY").toUpperCase() === "TRY")

  const [defter, setDefter] = useState<Defter | null>(null)
  const [hata, setHata] = useState<string | null>(null)
  const [pencere, setPencere] = useState<"VER" | "GERI_AL" | null>(null)
  const [kaydediliyor, setKaydediliyor] = useState(false)
  const [form, setForm] = useState({ amount: "", accountId: "", date: toDateInput(new Date()), notes: "" })

  const yukle = useCallback(async () => {
    if (!companyId) return
    setHata(null)
    try {
      const res = await fetch(`/api/personel/avans?companyId=${encodeURIComponent(companyId)}&employeeId=${encodeURIComponent(employeeId)}`)
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || "Avans kayıtları alınamadı")
      setDefter(data)
    } catch (e: any) {
      setHata(e?.message || "Avans kayıtları alınamadı")
    }
  }, [companyId, employeeId])

  useEffect(() => {
    yukle()
  }, [yukle])

  function ac(yon: "VER" | "GERI_AL") {
    const kasa = tlHesaplar.find((a) => a.type === "CASH") ?? tlHesaplar[0]
    setForm({
      amount: yon === "GERI_AL" && defter && defter.bakiye > 0 ? defter.bakiye.toFixed(2) : "",
      accountId: kasa?.id ?? "",
      date: toDateInput(new Date()),
      notes: "",
    })
    setPencere(yon)
  }

  async function kaydet() {
    if (!companyId || !pencere) return
    setKaydediliyor(true)
    try {
      const res = await fetch("/api/personel/avans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId,
          employeeId,
          yon: pencere,
          amount: Number(String(form.amount).replace(",", ".")),
          accountId: form.accountId,
          date: form.date,
          notes: form.notes,
        }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || "Kaydedilemedi")
      toast({
        title: pencere === "VER" ? "Avans verildi" : "Avans geri alındı",
        description: `${employeeName} · açık avans ${money(data.bakiye)}`,
      })
      setPencere(null)
      yukle()
    } catch (e: any) {
      toast({ title: "Hata", description: e?.message || "Kaydedilemedi", variant: "destructive" })
    } finally {
      setKaydediliyor(false)
    }
  }

  async function sil(s: AvansSatiri) {
    if (!companyId) return
    const ok = await confirm({
      title: "Avans kaydı silinsin mi?",
      description: `${money(s.tutar)} tutarındaki kasa hareketi silinir ve hesabın bakiyesi geri yazılır.`,
      confirmLabel: "Sil",
      variant: "destructive",
    })
    if (!ok) return
    const res = await fetch(`/api/personel/avans/${s.id}?companyId=${encodeURIComponent(companyId)}`, { method: "DELETE" })
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      toast({ title: "Hata", description: data?.error || "Silinemedi", variant: "destructive" })
      return
    }
    toast({ title: "Avans kaydı silindi" })
    yukle()
  }

  if (hata) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-destructive">{hata}</CardContent>
      </Card>
    )
  }
  if (!defter) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Yükleniyor…
      </div>
    )
  }

  const toplam = (tur: AvansSatiri["tur"]) => defter.satirlar.filter((s) => s.tur === tur).reduce((a, s) => a + s.tutar, 0)
  const satirlar = [...defter.satirlar].reverse()

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Verilen avans</p>
            <p className="text-xl font-bold">{money(toplam("VERILDI"))}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Bordrodan düşülen / geri alınan</p>
            <p className="text-xl font-bold">{money(toplam("BORDRO") + toplam("GERI_ALINDI"))}</p>
          </CardContent>
        </Card>
        <Card className={defter.bakiye > 0 ? "border-amber-300 dark:border-amber-800" : undefined}>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">{defter.bakiye >= 0 ? "Açık avans (bordrodan düşülecek)" : "Fazla düşülen (çalışana borç)"}</p>
            <p className="text-xl font-bold">{money(Math.abs(defter.bakiye))}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">Avans Hareketleri</CardTitle>
            {canPay && (
              <div className="flex gap-2">
                {defter.bakiye > 0 && (
                  <Button size="sm" variant="outline" onClick={() => ac("GERI_AL")}>
                    <Undo2 className="mr-1 h-4 w-4" /> Geri al
                  </Button>
                )}
                <Button size="sm" onClick={() => ac("VER")}>
                  <Banknote className="mr-1 h-4 w-4" /> Avans ver
                </Button>
              </div>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Verilen avans kasadan çıkar ama gider sayılmaz; maaşın peşin ödenen kısmıdır. Bordroyu girerken &quot;Avans&quot; alanına yazılan
            tutar açık avanstan düşer.
          </p>
        </CardHeader>
        <CardContent>
          {satirlar.length === 0 ? (
            <div className="text-sm text-muted-foreground">Bu çalışana avans verilmemiş.</div>
          ) : (
            <StyledTableContainer>
              <Table>
                <TableHeader>
                  <StyledTableHeaderRow>
                    <StyledTableHead>Tarih</StyledTableHead>
                    <StyledTableHead>Hareket</StyledTableHead>
                    <StyledTableHead>Açıklama</StyledTableHead>
                    <StyledTableHead className="text-right">Tutar</StyledTableHead>
                    <StyledTableHead className="w-10" />
                  </StyledTableHeaderRow>
                </TableHeader>
                <TableBody>
                  {satirlar.map((s) => (
                    <StyledTableRow key={`${s.tur}:${s.id}`}>
                      <TableCell>{day(s.tarih)}</TableCell>
                      <TableCell>
                        {s.tur === "VERILDI" ? (
                          <Badge variant="outline">Verildi</Badge>
                        ) : s.tur === "GERI_ALINDI" ? (
                          <Badge variant="secondary">Geri alındı</Badge>
                        ) : (
                          <Badge variant="secondary">Bordrodan düşüldü</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {s.aciklama}
                        {s.tur !== "BORDRO" && s.hesap ? ` · ${s.hesap.ad}` : ""}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{money(s.tutar)}</TableCell>
                      <TableCell>
                        {canPay && s.tur !== "BORDRO" && (
                          <Button size="icon" variant="ghost" onClick={() => sil(s)} aria-label="Sil">
                            <Trash2 className="h-4 w-4" />
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

      <Dialog open={pencere !== null} onOpenChange={(o) => !o && setPencere(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{pencere === "GERI_AL" ? "Avansı geri al" : "Avans ver"}</DialogTitle>
            <DialogDescription>
              {pencere === "GERI_AL"
                ? `${employeeName} avansın bir kısmını ya da tamamını nakit iade ediyor.`
                : `${employeeName} adına maaştan önce ödeme. Bordroda "Avans" alanından düşülür.`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Tutar</Label>
              <Input inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>{pencere === "GERI_AL" ? "Paranın girdiği hesap" : "Paranın çıktığı hesap"}</Label>
              <Select value={form.accountId} onValueChange={(v) => setForm({ ...form, accountId: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="Kasa / banka seçin" />
                </SelectTrigger>
                <SelectContent>
                  {tlHesaplar.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name} · {accountTypeLabel(a.type)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Tarih</Label>
              <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Not</Label>
              <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="İsteğe bağlı" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPencere(null)} disabled={kaydediliyor}>
              Vazgeç
            </Button>
            <Button onClick={kaydet} disabled={kaydediliyor || !form.amount || !form.accountId}>
              {kaydediliyor && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Kaydet
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
