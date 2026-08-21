"use client"

// Kapanmış (ya da iptal edilmiş) adisyonun DETAY sayfası — salt okunur.
// Kararlar: docs/restoran/ADISYON-DETAY.md
//
// Açık adisyonda soru "ne ekleyeyim, nasıl tahsil edeyim"dir ve cevabı POS
// ekranıdır (ticket-screen.tsx). Kapandıktan sonra soru değişir: "bu hesapta
// ne oldu" — kim açtı, kim kapattı, kim indirim verdi, nasıl tahsil edildi,
// eksik kalan var mı. Bu ekran yalnız o soruyu cevaplar.
//
// `TicketPanel` bilinçli olarak KULLANILMIYOR: o bileşen dar bir POS sütunudur
// ve ara toplam/KDV dökümünü kasten atmıştır (ticket-panel.tsx ~286). Denetim
// sayfasının ihtiyacı tam tersi; düzen fisler/[id] sayfasını izler.

import { useMemo } from "react"
import { AlertTriangle, ArrowLeft, Clock, Printer, Receipt, User, Users } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { FetchErrorText } from "@/components/ui/fetch-error"
import { Table, TableBody, TableCell, TableHeader } from "@/components/ui/table"
import {
  StyledTableContainer,
  StyledTableHeaderRow,
  StyledTableHead,
  StyledTableRow,
} from "@/components/ui/styled-table"
import { useToast } from "@/components/ui/use-toast"
import { CompanyLink } from "@/components/dashboard/company-link"
import { useDashboardCompany } from "@/components/dashboard/dashboard-company-provider"
import { useReceiptTemplate } from "@/lib/swr/use-company-data"
import { useTicketDetail, type TicketDetail } from "@/lib/swr/use-restoran"
import { currency, type ReceiptData } from "@/lib/fis/receipt-html"
import { printReceipt } from "@/lib/fis/print-receipt"
import { ticketDiscountLabel, type TicketItemStatus } from "@/lib/restoran/ticket-constants"
import { cn } from "@/lib/utils"
import { ExportAction } from "@/components/dashboard/write-guard"

const STATUS_BADGE: Record<Exclude<TicketItemStatus, "NORMAL">, { label: string; cls: string }> = {
  COMP: { label: "İKRAM", cls: "border-amber-400 text-amber-700 dark:text-amber-300" },
  WASTE: { label: "ZAYİ", cls: "border-red-400 text-red-700 dark:text-red-300" },
  VOID: { label: "İPTAL", cls: "border-muted-foreground/40 text-muted-foreground" },
}

const time = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" }) : "—"

const dateTime = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("tr-TR", {
        day: "2-digit",
        month: "long",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—"

const duration = (mins: number | null) =>
  mins === null ? null : mins < 60 ? `${mins} dk` : `${Math.floor(mins / 60)} sa ${mins % 60} dk`

const qty = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/\.?0+$/, ""))

export function TicketDetailScreen({ ticketId }: { ticketId: string }) {
  const { selectedCompanyId: companyId, selectedCompany } = useDashboardCompany()
  const { toast } = useToast()
  const { ticket, error, isLoading } = useTicketDetail(companyId, ticketId)
  const { template: receiptTemplate, company: receiptCompany } = useReceiptTemplate(companyId)

  /**
   * Fişin YENİDEN basımı. Kapanış anındakinden iki farkı var ve ikisi de
   * bilinçli: tarih `closedAt`tır (şimdi değil) ve para üstü YAZILMAZ —
   * sonradan basımda müşterinin ne verdiği bilinmiyor (bkz. ReceiptData.change).
   */
  const receipt = useMemo<ReceiptData | null>(() => {
    if (!ticket) return null
    const inv = ticket.invoice
    const payments = inv?.payments ?? []
    return {
      direction: "outgoing",
      invoiceNo: inv?.invoiceNo ?? null,
      date: ticket.closedAt ?? ticket.openedAt,
      companyName: selectedCompany?.name ?? "",
      company: receiptCompany,
      counterpartyName: ticket.customerName,
      notes: [ticket.tableName ? `Masa ${ticket.tableName}` : null, ticket.code]
        .filter(Boolean)
        .join(" · "),
      // Fişte yalnız ÖDENEN kalemler: ikram/zayi/iptal müşterinin hesabı değil.
      items: ticket.items
        .filter((i) => i.status === "NORMAL")
        .map((i) => ({
          description: [i.description, i.options.map((o) => o.optionName).join(" · "), i.note]
            .filter(Boolean)
            .join(" · "),
          quantity: i.quantity,
          unit: i.unit,
          unitPrice: i.unitPrice,
          vatRate: i.vatRate,
          total: i.quantity * i.unitPrice * (1 + i.vatRate / 100),
        })),
      net: inv?.netAmount ?? ticket.totals.net,
      vat: inv?.vatAmount ?? ticket.totals.vat,
      total: inv?.totalAmount ?? ticket.totals.total,
      discount:
        ticket.totals.discount > 0
          ? { label: ticketDiscountLabel(ticket) ?? "İskonto", amount: ticket.totals.discount }
          : null,
      paymentLabel:
        payments.length === 0
          ? "Veresiye"
          : payments.length === 1
            ? payments[0].methodLabel
            : "Parçalı",
      tendered: inv?.paidTotal ?? 0,
      isCredit: payments.length === 0,
      parts:
        payments.length > 1
          ? payments.map((p) => ({ label: p.methodLabel, amount: p.amount }))
          : undefined,
    }
  }, [ticket, receiptCompany, selectedCompany])

  const print = (autoPrint: boolean) => {
    if (!receipt) return
    if (!printReceipt(receipt, autoPrint, receiptTemplate)) {
      toast({
        title: "Açılır pencere engellendi",
        description: "Fiş için bu siteye açılır pencere izni verin.",
        variant: "destructive",
      })
    }
  }

  if (!companyId) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <p className="text-muted-foreground">Lütfen bir firma seçin</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-4">
        <BackLink />
        <Card>
          <CardContent className="py-16 text-center text-sm text-red-600 dark:text-red-400">
            <FetchErrorText error={error} subject="Adisyon" />
          </CardContent>
        </Card>
      </div>
    )
  }

  if (isLoading || !ticket) {
    return (
      <div className="space-y-4">
        <BackLink />
        <Card>
          <CardContent className="py-16 text-center text-sm text-muted-foreground">
            Adisyon yükleniyor…
          </CardContent>
        </Card>
      </div>
    )
  }

  const merged = ticket.status === "CANCELLED" && !!ticket.mergedIntoId
  const inv = ticket.invoice

  return (
    <div className="space-y-4">
      {/* Başlık */}
      <div className="space-y-1">
        <BackLink />
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h1 className="text-3xl font-bold">
              {ticket.tableName ? `Masa ${ticket.tableName}` : "Paket / Gel-al"}
            </h1>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              <span className="font-medium">{ticket.code}</span>
              <span className="flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" />
                {time(ticket.openedAt)}
                {ticket.closedAt ? ` – ${time(ticket.closedAt)}` : ""}
                {/* Süre SABİTTİR: açılış→kapanış. POS ekranındaki canlı sayaç
                    burada sonsuza dek artan anlamsız bir rakama dönüşüyordu. */}
                {duration(ticket.durationMin) ? ` · ${duration(ticket.durationMin)}` : ""}
              </span>
              {ticket.guestCount ? (
                <span className="flex items-center gap-1">
                  <Users className="h-3.5 w-3.5" />
                  {ticket.guestCount} kişi
                </span>
              ) : null}
              {ticket.customerName ? (
                <span className="flex items-center gap-1">
                  <User className="h-3.5 w-3.5" />
                  {ticket.customerName}
                </span>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              <StatusBadge ticket={ticket} />
              {inv && <PaymentBadge status={inv.paymentStatus} />}
            </div>
          </div>

          {inv && (
            <div className="flex flex-wrap items-center gap-2">
              {/* Fişi göstermek de yazdırmak da belgeyi ekranın dışına taşır
                  (yeni pencere/yazıcı) — ikisi de çıktı kapısında. */}
              <ExportAction>
                <Button variant="outline" onClick={() => print(false)}>
                  <Receipt className="mr-1.5 h-4 w-4" />
                  Fişi göster
                </Button>
                <Button variant="outline" onClick={() => print(true)}>
                  <Printer className="mr-1.5 h-4 w-4" />
                  Yazdır
                </Button>
              </ExportAction>
              {/* Mali belgenin kendisi Fişler ekranındadır: iptal, faturaya
                  dönüştürme ve tahsilat tamamlama orada yapılır. */}
              <CompanyLink href={`/fisler/${inv.slug || inv.id}`}>
                <Button>{inv.invoiceNo}</Button>
              </CompanyLink>
            </div>
          )}
        </div>
      </div>

      {ticket.note ? (
        <Card>
          <CardContent className="p-3 text-sm">
            <span className="text-muted-foreground">Adisyon notu: </span>
            {ticket.note}
          </CardContent>
        </Card>
      ) : null}

      {/* Tahsilatı eksik kalan hesap — kapanışta bir parça yazılamamış olabilir.
          Sessiz kalırsa para kimseye yazılmadan kaybolur. */}
      {inv && inv.remaining > 0.005 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50/60 p-3 text-sm dark:border-amber-700/60 dark:bg-amber-950/20">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <div>
            <p className="font-semibold text-amber-800 dark:text-amber-200">
              Tahsilat eksik: {currency(inv.remaining)}
            </p>
            <p className="text-muted-foreground">
              Fiş kesildi ama tahsilatın tamamı yazılamadı. Kalan tutar{" "}
              <CompanyLink
                href={`/fisler/${inv.slug || inv.id}`}
                className="underline underline-offset-2"
              >
                fiş sayfasından
              </CompanyLink>{" "}
              tamamlanabilir.
            </p>
          </div>
        </div>
      )}

      <div className="grid items-start gap-4 xl:grid-cols-[1fr_360px]">
        {/* SOL: kalemler */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Kalemler</CardTitle>
          </CardHeader>
          <CardContent>
            <StyledTableContainer>
              <Table>
                <TableHeader>
                  <StyledTableHeaderRow>
                    <StyledTableHead className="w-16">Saat</StyledTableHead>
                    <StyledTableHead>Ürün</StyledTableHead>
                    <StyledTableHead className="text-right">Adet</StyledTableHead>
                    <StyledTableHead className="text-right">Birim</StyledTableHead>
                    <StyledTableHead className="text-right">KDV</StyledTableHead>
                    <StyledTableHead className="text-right">Tutar</StyledTableHead>
                    <StyledTableHead>Ekleyen</StyledTableHead>
                  </StyledTableHeaderRow>
                </TableHeader>
                <TableBody>
                  {ticket.items.map((item) => {
                    const status = (item.status ?? "NORMAL") as TicketItemStatus
                    const badge = status === "NORMAL" ? null : STATUS_BADGE[status]
                    const gross = item.unitPrice * (1 + item.vatRate / 100)
                    const optionText = (item.options ?? []).map((o) => o.optionName).join(" · ")
                    return (
                      <StyledTableRow
                        key={item.id}
                        className={cn(status === "VOID" && "opacity-60")}
                      >
                        <TableCell className="text-muted-foreground tabular-nums">
                          {time(item.createdAt)}
                        </TableCell>
                        <TableCell>
                          <span className="flex flex-wrap items-center gap-1.5">
                            <span className="font-medium">{item.description}</span>
                            {badge && (
                              <span
                                className={cn(
                                  "rounded border px-1 py-px text-[10px] font-bold",
                                  badge.cls,
                                )}
                              >
                                {badge.label}
                              </span>
                            )}
                          </span>
                          {(() => {
                            // İkramı VEREN personel sebebin yanında durur: "kim
                            // verdi" sorusunun cevabı ikramın kendisiyle aynı
                            // satırda olmalı, ayrı bir bloğa düşerse eşleştirmek
                            // okuyucunun işi olurdu.
                            const compBy =
                              status === "COMP" ? ticket.itemCompEmployees?.[item.id] : null
                            const alt = [
                              optionText,
                              item.note,
                              item.reasonLabel,
                              item.reason,
                              compBy ? `ikramı veren: ${compBy}` : null,
                            ].filter(Boolean)
                            return alt.length > 0 ? (
                              <span className="block text-xs text-muted-foreground">
                                {alt.join(" · ")}
                              </span>
                            ) : null
                          })()}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {qty(item.quantity)} {item.unit}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{currency(gross)}</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          %{item.vatRate}
                        </TableCell>
                        <TableCell
                          className={cn(
                            "text-right font-semibold tabular-nums",
                            status !== "NORMAL" && "text-muted-foreground line-through",
                          )}
                        >
                          {currency(status === "COMP" ? 0 : item.quantity * gross)}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {ticket.itemCreators[item.id] ?? "—"}
                        </TableCell>
                      </StyledTableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </StyledTableContainer>
          </CardContent>
        </Card>

        {/* SAĞ: tutar, tahsilat, iz */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Tutarlar</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5 text-sm">
              <Row label="Ara toplam" value={currency(ticket.totals.net)} />
              <Row label="KDV" value={currency(ticket.totals.vat)} />
              {ticket.totals.discount > 0 && (
                <div className="flex items-start justify-between gap-3 text-kobipo-green">
                  <span className="min-w-0">{ticketDiscountLabel(ticket) ?? "İskonto"}</span>
                  <span className="shrink-0 tabular-nums">
                    −{currency(ticket.totals.discount)}
                  </span>
                </div>
              )}
              <div className="flex items-center justify-between border-t pt-1.5 text-lg font-bold">
                <span>TOPLAM</span>
                <span className="tabular-nums">{currency(ticket.totals.total)}</span>
              </div>
            </CardContent>
          </Card>

          {inv && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Tahsilat</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5 text-sm">
                {inv.payments.length === 0 ? (
                  <p className="text-muted-foreground">
                    Tahsilat kaydı yok — veresiye / açık hesap.
                  </p>
                ) : (
                  inv.payments.map((p) => (
                    <div key={p.id} className="flex items-start justify-between gap-3">
                      <span className="min-w-0">
                        {p.methodLabel}
                        <span className="block text-xs text-muted-foreground">
                          {[time(p.paymentDate), p.accountName, p.notes]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </span>
                      <span className="shrink-0 font-semibold tabular-nums">
                        {currency(p.amount)}
                      </span>
                    </div>
                  ))
                )}
                {inv.remaining > 0.005 && (
                  <div className="flex items-center justify-between border-t pt-1.5 font-semibold text-amber-600 dark:text-amber-400">
                    <span>Kalan</span>
                    <span className="tabular-nums">{currency(inv.remaining)}</span>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Personel izi</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5 text-sm">
              <Row
                label="Açan"
                value={ticket.staff.openedBy?.name ?? "—"}
                hint={time(ticket.openedAt)}
              />
              {ticket.staff.billRequestedBy && (
                <Row
                  label="Hesap isteyen"
                  value={ticket.staff.billRequestedBy.name}
                  hint={time(ticket.billRequestedAt)}
                />
              )}
              {ticket.discountEmployeeName && (
                <Row
                  label="İskontoyu uygulayan"
                  value={ticket.discountEmployeeName}
                  // Seçilen personel (İK kartı) ile kaydı yazan oturum AYRI
                  // sorulardır — ikisi de gösterilir. Bkz. SATIS-EKRANI.md K3.1.
                  hint={
                    ticket.staff.discountBy
                      ? `kaydeden: ${ticket.staff.discountBy.name} · ${time(ticket.discountAt)}`
                      : time(ticket.discountAt)
                  }
                />
              )}
              {/* Ekran açık adisyonda da açılabiliyor (salt-okunur yetki, bkz.
                  ticket-page.tsx): hesap henüz kapanmadıysa "İptal eden — —" diye
                  yanlış bir satır basmak yerine satırı hiç basmıyoruz. */}
              {(ticket.closedAt || ticket.staff.closedBy) && (
                <Row
                  label={merged ? "Birleştiren" : ticket.status === "CLOSED" ? "Kapatan" : "İptal eden"}
                  value={ticket.staff.closedBy?.name ?? "—"}
                  hint={time(ticket.closedAt)}
                />
              )}
            </CardContent>
          </Card>

          {(ticket.merge.into || ticket.merge.from.length > 0) && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Birleştirme</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5 text-sm">
                {/* Birleştirilen adisyon `CANCELLED` görünür ama İPTAL DEĞİLDİR:
                    cirosu kaybolmadı, hedefe geçti. */}
                {ticket.merge.into && (
                  <p>
                    Bu adisyon{" "}
                    <CompanyLink
                      href={`/restoran/adisyon/${ticket.merge.into.id}`}
                      className="font-medium underline underline-offset-2"
                    >
                      {ticket.merge.into.code}
                    </CompanyLink>{" "}
                    hesabına birleştirildi — cirosu orada.
                  </p>
                )}
                {ticket.merge.from.map((m) => (
                  <div key={m.id} className="flex items-center justify-between gap-3">
                    <CompanyLink
                      href={`/restoran/adisyon/${m.id}`}
                      className="underline underline-offset-2"
                    >
                      {m.code}
                    </CompanyLink>
                    <span className="tabular-nums text-muted-foreground">
                      buraya birleştirildi · {currency(m.total)}
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {ticket.status === "CANCELLED" && !merged && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">İptal</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                <p className="font-medium">{ticket.cancelReasonLabel ?? "Sebep belirtilmemiş"}</p>
                {ticket.cancelReason && (
                  <p className="text-muted-foreground">{ticket.cancelReason}</p>
                )}
              </CardContent>
            </Card>
          )}

          {ticket.reservation && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Rezervasyon</CardTitle>
              </CardHeader>
              <CardContent className="text-sm">
                <p className="font-medium">{ticket.reservation.guestName}</p>
                <p className="text-muted-foreground">{dateTime(ticket.reservation.reservedAt)}</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}

function BackLink() {
  return (
    <CompanyLink
      href="/restoran/adisyonlar"
      className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" />
      Adisyonlar
    </CompanyLink>
  )
}

function Row({ label, value, hint }: { label: string; value: string; hint?: string | null }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 text-right">
        <span className="font-medium">{value}</span>
        {hint ? <span className="block text-xs text-muted-foreground">{hint}</span> : null}
      </span>
    </div>
  )
}

function StatusBadge({ ticket }: { ticket: TicketDetail }) {
  if (ticket.status === "CLOSED") return <Badge variant="odendi">Kapandı</Badge>
  if (ticket.mergedIntoId) return <Badge variant="secondary">Birleştirildi</Badge>
  return <Badge variant="destructive">İptal</Badge>
}

function PaymentBadge({ status }: { status: "PAID" | "PARTIAL" | "OPEN" }) {
  if (status === "PAID") return <Badge variant="odendi">Tahsil edildi</Badge>
  if (status === "PARTIAL") return <Badge variant="bekliyor">Kısmî tahsilat</Badge>
  return <Badge variant="secondary">Açık hesap</Badge>
}
