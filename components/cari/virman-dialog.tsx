"use client"

import { useEffect, useMemo, useState } from "react"
import { ArrowLeftRight, Info, Printer } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SearchSelect } from "@/components/ui/search-select"
import { useToast } from "@/components/ui/use-toast"
import { ToastAction } from "@/components/ui/toast"
import { downloadVirmanMakbuz } from "@/components/cari/virman-makbuz"
import { toDateInput } from "@/lib/format"
import { useCustomers, useSuppliers } from "@/lib/swr/use-company-data"
import {
  VIRMAN_SIDE_LABEL,
  oppositeSide,
  virmanBakiyeEtkisi,
  virmanEtkiCumlesi,
  type CariKind,
  type VirmanSide,
} from "@/lib/cari/virman"

const formatTRY = (value: number) =>
  new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(value)

type VirmanDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  companyId: string
  /** Fişin girildiği cari (çözülmüş id — slug değil). */
  party: { kind: CariKind; id: string; name: string }
  /** Carinin kartındaki güncel bakiye; kayıt sonrası bakiye önizlemesi için. */
  currentBalance: number
  onSuccess?: () => Promise<void> | void
}

type KarsiTur = "none" | CariKind

/**
 * CARİ VİRMAN FİŞİ penceresi — kural `lib/cari/virman.ts`, uç `/api/cari/virman`.
 *
 * Bu carinin yönü seçilir (Virman Borç / Virman Alacak); karşı cari seçilirse
 * ona TERS yönde bacak yazılır. Karşı cari isteğe bağlıdır: seçilmezse fiş tek
 * taraflıdır ve pencere bunu açıkça söyler.
 */
export function VirmanDialog({ open, onOpenChange, companyId, party, currentBalance, onSuccess }: VirmanDialogProps) {
  const { toast } = useToast()
  const [side, setSide] = useState<VirmanSide>("CREDIT")
  const [karsiTur, setKarsiTur] = useState<KarsiTur>("none")
  const [karsiId, setKarsiId] = useState("")
  const [amount, setAmount] = useState("")
  const [date, setDate] = useState(() => toDateInput(new Date()))
  const [description, setDescription] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Liste yalnız karşı cari türü seçilince çekilir (SWR anahtarı null → istek yok).
  const { customers } = useCustomers(open && karsiTur === "customer" ? companyId : null)
  const { suppliers } = useSuppliers(open && karsiTur === "supplier" ? companyId : null)

  useEffect(() => {
    if (!open) return
    setSide("CREDIT")
    setKarsiTur("none")
    setKarsiId("")
    setAmount("")
    setDate(toDateInput(new Date()))
    setDescription("")
  }, [open])

  const karsiOptions = useMemo(() => {
    const list = karsiTur === "customer" ? customers : karsiTur === "supplier" ? suppliers : []
    return list
      // Fişin girildiği cari kendi karşısı olamaz.
      .filter((c) => !(karsiTur === party.kind && c.id === party.id))
      .map((c) => ({ id: c.id, name: c.nickname ? `${c.name} (${c.nickname})` : c.name, hint: c.taxNumber }))
  }, [karsiTur, customers, suppliers, party.kind, party.id])

  const numericAmount = Number(amount.replace(",", "."))
  const amountValid = Number.isFinite(numericAmount) && numericAmount > 0
  const newBalance = amountValid
    ? currentBalance + virmanBakiyeEtkisi(party.kind, side, numericAmount)
    : currentBalance
  const karsiSide = oppositeSide(side)
  const karsiSecili = karsiTur !== "none" && karsiId !== ""
  const karsiAdi = karsiOptions.find((o) => o.id === karsiId)?.name ?? null

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!amountValid) {
      toast({ title: "Hata", description: "Tutar 0'dan büyük olmalı", variant: "destructive" })
      return
    }
    if (karsiTur !== "none" && !karsiId) {
      toast({ title: "Hata", description: "Karşı cariyi seçin ya da türü “Yok” yapın", variant: "destructive" })
      return
    }
    setIsSubmitting(true)
    try {
      const response = await fetch("/api/cari/virman", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId,
          party: { kind: party.kind, id: party.id },
          side,
          counterparty: karsiSecili ? { kind: karsiTur, id: karsiId } : null,
          amount: numericAmount,
          date,
          description: description.trim() || null,
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || "Virman fişi kaydedilemedi")
      toast({
        title: "Virman fişi kaydedildi",
        description: `${data.virmanNo ?? ""} · ${formatTRY(numericAmount)}${
          karsiSecili ? "" : " · tek taraflı"
        }`,
        action: data.id ? (
          <ToastAction
            altText="Makbuz indir"
            onClick={() =>
              downloadVirmanMakbuz(data.id).catch((e) =>
                toast({ title: "Makbuz oluşturulamadı", description: e?.message, variant: "destructive" }),
              )
            }
          >
            <Printer className="mr-1 h-3.5 w-3.5" />
            Makbuz
          </ToastAction>
        ) : undefined,
      })
      onOpenChange(false)
      await onSuccess?.()
    } catch (error) {
      toast({
        title: "Hata",
        description: error instanceof Error ? error.message : "Bir hata oluştu",
        variant: "destructive",
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  const sideButton = (value: VirmanSide) => (
    <button
      type="button"
      onClick={() => setSide(value)}
      aria-pressed={side === value}
      className={`flex-1 rounded-md border px-3 py-2 text-left text-sm transition-colors ${
        side === value
          ? "border-primary bg-primary/5 ring-1 ring-primary"
          : "border-input hover:bg-muted/60"
      }`}
    >
      <div className="font-medium">{VIRMAN_SIDE_LABEL[value]}</div>
      <div className="text-xs text-muted-foreground">{virmanEtkiCumlesi(party.kind, value)}</div>
    </button>
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Virman Fişi</DialogTitle>
          <DialogDescription>
            Kasa/banka hareketi oluşmaz; bakiye cari hesaplar arasında aktarılır.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>{party.name} için *</Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              {sideButton("DEBIT")}
              {sideButton("CREDIT")}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Karşı cari</Label>
            <div className="grid gap-2 sm:grid-cols-[9rem_1fr]">
              <Select
                value={karsiTur}
                onValueChange={(value) => {
                  setKarsiTur(value as KarsiTur)
                  setKarsiId("")
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Yok</SelectItem>
                  <SelectItem value="customer">Müşteri</SelectItem>
                  <SelectItem value="supplier">Tedarikçi</SelectItem>
                </SelectContent>
              </Select>
              {karsiTur !== "none" && (
                <SearchSelect
                  options={karsiOptions}
                  value={karsiId}
                  onChange={setKarsiId}
                  placeholder={karsiTur === "customer" ? "Müşteri ara…" : "Tedarikçi ara…"}
                  emptyText="Eşleşen cari yok"
                />
              )}
            </div>
            {karsiTur === "none" ? (
              <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-900/40 dark:bg-amber-950/30">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <p className="text-amber-900 dark:text-amber-200">
                  Karşı cari seçilmedi: fiş <strong>tek taraflıdır</strong>, bu carinin bakiyesi
                  karşılıksız değişir.
                </p>
              </div>
            ) : karsiSecili ? (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <ArrowLeftRight className="h-3.5 w-3.5" />
                {karsiAdi ?? "Karşı cari"} → <strong>{VIRMAN_SIDE_LABEL[karsiSide]}</strong> (
                {virmanEtkiCumlesi(karsiTur, karsiSide).toLocaleLowerCase("tr-TR")})
              </p>
            ) : null}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Tutar (₺) *</Label>
              <Input
                type="number"
                inputMode="decimal"
                min="0.01"
                step="0.01"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                placeholder="0,00"
                required
              />
            </div>
            <div className="space-y-2">
              <Label>Tarih *</Label>
              <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} required />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Açıklama</Label>
            <Input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={500}
              placeholder="Ör. ABC'nin XYZ'ye yaptığı ödeme"
            />
          </div>

          <div className="rounded-lg border bg-muted/40 p-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Güncel bakiye</span>
              <span className="tabular-nums">{formatTRY(currentBalance)}</span>
            </div>
            <div className="flex items-center justify-between font-medium">
              <span>Kayıt sonrası</span>
              <span className="tabular-nums">{formatTRY(newBalance)}</span>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              İptal
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Kaydediliyor…" : "Kaydet"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
