"use client"

import { useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
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
import { useToast } from "@/components/ui/use-toast"
import { useConfirm } from "@/components/ui/confirm-dialog-provider"
import { Plus, Send, FileText, Eye, Pencil, Inbox, Loader2, Download } from "lucide-react"
import Link from "next/link"
import { WriteAction } from "@/components/dashboard/write-guard"

interface Invoice {
  id: string
  slug?: string
  invoiceNo: string
  type: string
  invoiceType: string
  status: string
  date: string
  totalAmount: number
  customer?: { name: string }
  supplier?: { name: string }
  uuid?: string
}

interface CompanySettings {
  id: string
  slug?: string
  isEDonusumEnabled?: boolean
}

export default function EDönüşümPage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const companyId = searchParams.get("company")
  const { toast } = useToast()
  const { confirm } = useConfirm()

  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [companySettings, setCompanySettings] = useState<CompanySettings | null>(null)
  // Gelen fatura keşfi (Beta) — Mysoft InvoiceInbox endpoint'ini test eder,
  // ham JSON yanıtını gösterir. Listeyi/akışı etkilemez.
  const [isDiscoveringInbox, setIsDiscoveringInbox] = useState(false)
  const [inboxDiscovery, setInboxDiscovery] = useState<any>(null)
  // Gelen fatura listeleme (Beta) — Mysoft InvoiceInbox/...ForPeriod çağrısı.
  // DB'ye yazmaz, sadece ham + mapped sonucu gösterir.
  const [isLoadingInbox, setIsLoadingInbox] = useState(false)
  const [inboxResult, setInboxResult] = useState<any>(null)

  /** Eski paylaşılan linkler: ?edit= ve ?manual=1 */
  useEffect(() => {
    if (!companyId) return
    const edit = searchParams.get("edit")
    if (edit) {
      router.replace(`/e-donusum/${edit}/duzenle?company=${encodeURIComponent(companyId)}`)
      return
    }
    if (searchParams.get("manual") === "1") {
      router.replace(`/e-donusum/yeni?company=${encodeURIComponent(companyId)}&manual=1`)
    }
  }, [companyId, searchParams, router])

  useEffect(() => {
    if (companyId) {
      fetchInvoices()
      fetchCompanySettings()
    }
  }, [companyId])

  const fetchInvoices = async () => {
    if (!companyId) return
    try {
      const response = await fetch(`/api/e-donusum/invoices?companyId=${companyId}`)
      if (response.ok) {
        const data = await response.json()
        setInvoices(data)
      }
    } catch (error) {
      console.error("Error fetching invoices:", error)
    }
  }

  const fetchCompanySettings = async () => {
    if (!companyId) return
    try {
      const response = await fetch("/api/companies")
      if (!response.ok) return
      const companies = (await response.json()) as CompanySettings[]
      setCompanySettings(companies.find((company) => company.id === companyId || company.slug === companyId) || null)
    } catch (error) {
      console.error("Error fetching company settings:", error)
    }
  }

  const handleSendInvoice = async (invoiceId: string) => {
    if (!(await confirm({ title: "Faturayı gönder", description: "Faturayı göndermek istediğinize emin misiniz? Gönderildikten sonra fatura yasal olarak kesilmiş sayılır.", confirmLabel: "Gönder" }))) {
      return
    }

    setIsLoading(true)
    try {
      const response = await fetch(`/api/e-donusum/invoices/${invoiceId}`, {
        method: "POST",
      })

      if (response.ok) {
        toast({
          title: "Başarılı",
          description: "Fatura gönderildi",
        })
        fetchInvoices()
      } else {
        const data = await response.json()
        throw new Error(data.error || "Gönderilemedi")
      }
    } catch (error: any) {
      toast({
        title: "Hata",
        description: error.message || "Bir hata oluştu",
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

  const legacyEdit = searchParams.get("edit")
  const legacyManual = searchParams.get("manual") === "1"
  if (legacyEdit || legacyManual) {
    return (
      <div className="flex items-center justify-center p-8">
        <p className="text-muted-foreground">Yönlendiriliyor…</p>
      </div>
    )
  }

  const goNewInvoice = () => {
    router.push(`/e-donusum/yeni?company=${encodeURIComponent(companyId)}`)
  }

  const handleFetchInbox = async () => {
    if (!companyId) return
    setIsLoadingInbox(true)
    setInboxResult(null)
    try {
      const response = await fetch(
        `/api/e-donusum/inbox?companyId=${encodeURIComponent(companyId)}&days=30&raw=1`,
      )
      const data = await response.json()
      if (!response.ok) {
        toast({
          title: "Liste alınamadı",
          description: data.error || "Bilinmeyen hata",
          variant: "destructive",
        })
        setInboxResult({ error: data.error, rawResponse: data.rawResponse })
        return
      }
      setInboxResult(data)
      toast({
        title: data.count > 0 ? `${data.count} gelen fatura` : "Gelen fatura bulunamadı",
        description:
          data.count > 0
            ? "Şema doğru — DB modeli için ham JSON aşağıda."
            : "Bu aralıkta inbox boş — daha geniş tarih aralığı deneyin.",
      })
    } catch (error: any) {
      toast({
        title: "Hata",
        description: error?.message || "Liste alınırken hata oluştu",
        variant: "destructive",
      })
    } finally {
      setIsLoadingInbox(false)
    }
  }

  const handleDiscoverInbox = async () => {
    if (!companyId) return
    setIsDiscoveringInbox(true)
    setInboxDiscovery(null)
    try {
      const response = await fetch("/api/e-donusum/discover-inbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId }),
      })
      const data = await response.json()
      if (!response.ok) {
        toast({
          title: "Keşif başarısız",
          description: data.error || "Bilinmeyen hata",
          variant: "destructive",
        })
        setInboxDiscovery({ error: data.error || "Bilinmeyen hata" })
        return
      }
      setInboxDiscovery(data)
      if (data.firstSuccess !== null && data.firstSuccess !== undefined) {
        toast({
          title: "Inbox endpoint bulundu",
          description: data.summary?.[data.firstSuccess]?.label || "",
        })
      } else {
        toast({
          title: "Hiçbir endpoint çalışmadı",
          description: "Aşağıdaki paneldeki raporu kontrol edin.",
          variant: "destructive",
        })
      }
    } catch (error: any) {
      toast({
        title: "Hata",
        description: error?.message || "Keşif sırasında hata oluştu",
        variant: "destructive",
      })
    } finally {
      setIsDiscoveringInbox(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">E-Dönüşüm</h1>
          <p className="text-muted-foreground">E-Fatura ve E-Arşiv fatura yönetimi</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <WriteAction>
          <Button
            variant="outline"
            onClick={handleFetchInbox}
            disabled={isLoadingInbox}
            title="Mysoft Inbox API'sinden son 30 günde gelen faturaları çeker (Beta — DB'ye yazılmaz)"
          >
            {isLoadingInbox ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-2 h-4 w-4" />
            )}
            Gelen Faturaları Çek (Beta)
          </Button>
          <Button
            variant="outline"
            onClick={handleDiscoverInbox}
            disabled={isDiscoveringInbox}
            title="Mysoft InvoiceInbox API'sinin gerçek şemasını keşfeder (Beta — yalnızca okuma, hiçbir şey kaydetmez)"
          >
            {isDiscoveringInbox ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Inbox className="mr-2 h-4 w-4" />
            )}
            Endpoint Keşfi (Beta)
          </Button>
          <Button onClick={goNewInvoice}>
            <Plus className="mr-2 h-4 w-4" />
            Yeni Fatura
          </Button>
          </WriteAction>
        </div>
      </div>

      {inboxResult && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Gelen Faturalar — Ham Sonuç (Beta)</CardTitle>
            <CardDescription>
              {inboxResult.error
                ? "Hata oluştu"
                : `${inboxResult.count} kayıt · ${
                    inboxResult.dateRange
                      ? `${new Date(inboxResult.dateRange.startDate).toLocaleDateString("tr-TR")} — ${new Date(
                          inboxResult.dateRange.endDate,
                        ).toLocaleDateString("tr-TR")}`
                      : ""
                  }`}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {inboxResult.error ? (
              <p className="text-sm text-red-600">{inboxResult.error}</p>
            ) : inboxResult.count === 0 ? (
              <p className="text-sm text-muted-foreground">
                Bu aralıkta inbox boş. Test hesabında gerçek gelen fatura yoksa bu beklenen sonuçtur.
              </p>
            ) : (
              <StyledTableContainer>
              <Table>
                <TableHeader>
                  <StyledTableHeaderRow>
                    <StyledTableHead>Tarih</StyledTableHead>
                    <StyledTableHead>Fatura No</StyledTableHead>
                    <StyledTableHead>Gönderici VKN</StyledTableHead>
                    <StyledTableHead>Gönderici</StyledTableHead>
                    <StyledTableHead>Profil</StyledTableHead>
                    <StyledTableHead>Tip</StyledTableHead>
                    <StyledTableHead className="text-right">Net</StyledTableHead>
                    <StyledTableHead className="text-right">KDV</StyledTableHead>
                    <StyledTableHead className="text-right">Toplam</StyledTableHead>
                    <StyledTableHead>Durum</StyledTableHead>
                  </StyledTableHeaderRow>
                </TableHeader>
                <TableBody>
                  {(inboxResult.data || []).map((row: any, idx: number) => {
                    const fmt = (v: number | null | undefined) =>
                      v === null || v === undefined
                        ? "-"
                        : new Intl.NumberFormat("tr-TR", {
                            style: "currency",
                            currency: row.currency || "TRY",
                          }).format(Number(v))
                    return (
                      <StyledTableRow key={row.uuid || Math.random()} index={idx}>
                        <TableCell className="text-xs whitespace-nowrap">
                          {row.date ? new Date(row.date).toLocaleDateString("tr-TR") : "-"}
                        </TableCell>
                        <TableCell><MonoCell value={row.invoiceNo} /></TableCell>
                        <TableCell><MonoCell value={row.sender?.taxNumber} /></TableCell>
                        <TableCell className="text-xs">
                          <EntityCell name={row.sender?.name} />
                        </TableCell>
                        <TableCell className="text-xs">
                          {row.profile === "TICARIFATURA"
                            ? "Ticari"
                            : row.profile === "TEMELFATURA"
                              ? "Temel"
                              : row.profile || "-"}
                        </TableCell>
                        <TableCell className="text-xs">{row.invoiceType || "-"}</TableCell>
                        <TableCell className="text-right text-xs whitespace-nowrap">{fmt(row.taxExclusiveAmount)}</TableCell>
                        <TableCell className="text-right text-xs whitespace-nowrap">{fmt(row.vatAmount)}</TableCell>
                        <TableCell className="text-right text-xs font-semibold whitespace-nowrap">
                          {fmt(row.totalAmount)}
                        </TableCell>
                        <TableCell>
                          <span
                            className={`rounded px-2 py-0.5 text-[10px] font-medium ${
                              row.status === "KABUL"
                                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300"
                                : row.status === "RED"
                                  ? "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300"
                                  : "bg-slate-100 text-slate-700 dark:bg-slate-500/15 dark:text-slate-300"
                            }`}
                          >
                            {row.status || "-"}
                          </span>
                        </TableCell>
                      </StyledTableRow>
                    )
                  })}
                </TableBody>
              </Table>
              </StyledTableContainer>
            )}
            {inboxResult.rawResponse && (
              <details className="rounded border bg-slate-50 p-2 dark:bg-muted/40">
                <summary className="cursor-pointer text-sm font-medium">
                  Mysoft ham JSON yanıtı
                </summary>
                <pre className="mt-2 max-h-96 overflow-auto text-[10px]">
                  {JSON.stringify(inboxResult.rawResponse, null, 2)}
                </pre>
              </details>
            )}
          </CardContent>
        </Card>
      )}

      {inboxDiscovery && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Mysoft Inbox Keşif Sonucu (Beta)</CardTitle>
            <CardDescription>
              Mysoft tarafında hangi InvoiceInbox endpoint'inin çalıştığını test eder.
              Yanıt ham JSON — gelen fatura modülü implementasyonu bunun üstüne kurulacak.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {inboxDiscovery.error ? (
              <p className="text-sm text-red-600">{inboxDiscovery.error}</p>
            ) : (
              <>
                <div className="grid gap-1 text-sm">
                  <p>
                    <span className="text-muted-foreground">Base URL:</span>{" "}
                    <span className="font-mono">{inboxDiscovery.baseUrl}</span>
                  </p>
                  {inboxDiscovery.dateRange && (
                    <p>
                      <span className="text-muted-foreground">Aralık:</span>{" "}
                      {new Date(inboxDiscovery.dateRange.startDate).toLocaleDateString("tr-TR")} —{" "}
                      {new Date(inboxDiscovery.dateRange.endDate).toLocaleDateString("tr-TR")}
                    </p>
                  )}
                  {inboxDiscovery.tenantVkn && (
                    <p>
                      <span className="text-muted-foreground">Tenant VKN:</span>{" "}
                      <span className="font-mono">{inboxDiscovery.tenantVkn}</span>
                    </p>
                  )}
                </div>
                {inboxDiscovery.swagger?.hit && (
                  <div className="rounded border border-blue-200 bg-blue-50 p-2 text-xs">
                    <p className="font-medium text-blue-900">
                      Swagger bulundu: {inboxDiscovery.swagger.hit.path} ({inboxDiscovery.swagger.hit.pathCount} endpoint)
                    </p>
                    {inboxDiscovery.swagger.hit.inboxPaths?.length > 0 ? (
                      <div className="mt-1">
                        <p className="text-blue-800">Inbox/Incoming path'leri:</p>
                        <ul className="ml-3 list-disc">
                          {inboxDiscovery.swagger.hit.inboxPaths.map((ip: any, i: number) => (
                            <li key={i} className="font-mono">
                              {ip.methods.join(",")} {ip.path}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : (
                      <p className="mt-1 text-blue-800">
                        Hiç "inbox/incoming/received" içeren path bulunamadı — Mysoft hesabınızda Inbox yetkisi olmayabilir.
                      </p>
                    )}
                    <details className="mt-1">
                      <summary className="cursor-pointer text-blue-700">
                        Tüm path'leri göster (ilk 80)
                      </summary>
                      <pre className="mt-1 max-h-64 overflow-auto text-[10px]">
                        {(inboxDiscovery.swagger.hit.allPaths || []).join("\n")}
                      </pre>
                    </details>
                  </div>
                )}
                {!inboxDiscovery.swagger?.hit && (
                  <div className="rounded border border-amber-200 bg-amber-50 p-2 text-xs">
                    <p className="text-amber-900">
                      Swagger JSON erişilemedi. Denemeler:
                    </p>
                    <ul className="ml-3 mt-1 list-disc">
                      {(inboxDiscovery.swagger?.attempts || []).map((a: any, i: number) => (
                        <li key={i} className="font-mono">
                          {a.path} → HTTP {a.status}
                          {a.note ? ` (${a.note})` : ""}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  Denenen: {inboxDiscovery.attemptStats?.triedCount ?? 0} · 404:{" "}
                  {inboxDiscovery.attemptStats?.notFoundCount ?? 0} · Anlamlı:{" "}
                  {inboxDiscovery.attemptStats?.interestingCount ?? 0} ·{" "}
                  {inboxDiscovery.attemptStats?.usedSwaggerPaths
                    ? "swagger path'leri kullanıldı"
                    : "generic isim sweep'i kullanıldı"}
                </p>
                <div>
                  <p className="mb-1 text-sm font-medium">Anlamlı denemeler:</p>
                  {(inboxDiscovery.summary || []).length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      Tüm denemeler 404 döndü — endpoint adlandırması farklı olabilir veya hesabın Inbox yetkisi yok.
                    </p>
                  ) : (
                    <ul className="space-y-1 text-xs">
                      {(inboxDiscovery.summary || []).map((s: any, i: number) => (
                        <li
                          key={i}
                          className={`rounded border px-2 py-1 ${
                            s.ok ? "border-emerald-300 bg-emerald-50" : "border-slate-200 bg-slate-50"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <span className="font-mono">
                              {s.method} {s.url}
                            </span>
                            <span className="shrink-0 text-muted-foreground">
                              HTTP {s.status} · succeed={String(s.succeed)} · items={s.itemCount ?? "?"}
                            </span>
                          </div>
                          {s.sampleKeys && s.sampleKeys.length > 0 && (
                            <div className="mt-1 text-[10px] text-muted-foreground">
                              keys: {s.sampleKeys.join(", ")}
                            </div>
                          )}
                          {s.message && (
                            <div className="mt-1 text-[10px] text-amber-700">{s.message}</div>
                          )}
                          {s.bodySnippet && (
                            <div className="mt-1 text-[10px] text-slate-600">
                              body: {s.bodySnippet}
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {inboxDiscovery.successRaw && (
                  <details className="rounded border bg-slate-50 p-2">
                    <summary className="cursor-pointer text-sm font-medium">
                      İlk başarılı yanıt — ham JSON
                    </summary>
                    <pre className="mt-2 max-h-96 overflow-auto text-[10px]">
                      {JSON.stringify(inboxDiscovery.successRaw, null, 2)}
                    </pre>
                  </details>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Faturalar</CardTitle>
          <CardDescription>Toplam {invoices.length} fatura</CardDescription>
        </CardHeader>
        <CardContent>
          <StyledTableContainer>
          <Table>
            <TableHeader>
              <StyledTableHeaderRow>
                <StyledTableHead>Fatura No</StyledTableHead>
                <StyledTableHead>Tip</StyledTableHead>
                <StyledTableHead>Tür</StyledTableHead>
                <StyledTableHead>Tarih</StyledTableHead>
                <StyledTableHead>Müşteri/Tedarikçi</StyledTableHead>
                <StyledTableHead className="text-right">Tutar</StyledTableHead>
                <StyledTableHead>Durum</StyledTableHead>
                <StyledTableHead>İşlemler</StyledTableHead>
              </StyledTableHeaderRow>
            </TableHeader>
            <TableBody>
              {invoices.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-8 text-center">
                    <FileText className="mx-auto mb-4 h-12 w-12 text-muted-foreground/50" />
                    <p className="text-muted-foreground">Henüz fatura oluşturulmamış</p>
                    <Button variant="link" onClick={goNewInvoice}>
                      İlk faturanızı oluşturun
                    </Button>
                  </TableCell>
                </TableRow>
              ) : (
                invoices.map((invoice, idx) => (
                  <StyledTableRow
                    key={invoice.id}
                    index={idx}
                    className="cursor-pointer"
                    onClick={() => router.push(`/e-donusum/${invoice.slug || invoice.id}?company=${companyId}`)}
                  >
                    <TableCell className="font-mono text-xs text-kobipo-blue font-medium">{invoice.invoiceNo}</TableCell>
                    <TableCell className="text-xs">
                      {invoice.type === "SALES"
                        ? "Satış"
                        : invoice.type === "PURCHASE"
                          ? "Alış"
                          : invoice.type === "RETURN"
                            ? "İade"
                            : invoice.type}
                    </TableCell>
                    <TableCell className="text-xs">
                      {invoice.invoiceType === "E_INVOICE"
                        ? "E-Fatura"
                        : invoice.invoiceType === "E_ARCHIVE"
                          ? "E-Arsiv"
                          : "Manuel"}
                    </TableCell>
                    <TableCell className="text-xs whitespace-nowrap">{new Date(invoice.date).toLocaleDateString("tr-TR")}</TableCell>
                    <TableCell>
                      <EntityCell name={invoice.customer?.name || invoice.supplier?.name} />
                    </TableCell>
                    <TableCell className="text-right font-semibold whitespace-nowrap">
                      {new Intl.NumberFormat("tr-TR", {
                        style: "currency",
                        currency: "TRY",
                      }).format(Number(invoice.totalAmount))}
                    </TableCell>
                    <TableCell>
                      <span
                        className={`rounded px-2 py-1 text-xs ${
                          invoice.status === "SENT"
                            ? "bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300"
                            : invoice.status === "DRAFT"
                              ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-500/15 dark:text-yellow-300"
                              : "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300"
                        }`}
                      >
                        {invoice.status === "SENT" ? "Gönderildi" : invoice.status === "DRAFT" ? "Taslak" : invoice.status}
                      </span>
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center space-x-2">
                        <Link href={`/e-donusum/${invoice.slug || invoice.id}?company=${companyId}`}>
                          <Button variant="outline" size="sm">
                            <Eye className="mr-1 h-3 w-3" />
                            Önizle
                          </Button>
                        </Link>
                        {/* Alışta SENT de düzenlenebilir: gelen e-faturadan dönüştürülen
                            kayıt onay adımı olmasın diye SENT tutulur, GİB'e gönderilmiş
                            bir belge değildir (bkz. PUT /api/e-donusum/invoices/[id]). */}
                        {(invoice.status === "DRAFT" ||
                          (invoice.type === "PURCHASE" && invoice.status === "SENT")) && (
                          <WriteAction>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                router.push(
                                  `/e-donusum/${invoice.id}/duzenle?company=${encodeURIComponent(companyId)}`
                                )
                              }
                            >
                              <Pencil className="mr-1 h-3 w-3" />
                              Düzenle
                            </Button>
                          </WriteAction>
                        )}
                        {companySettings?.isEDonusumEnabled &&
                          invoice.status === "DRAFT" &&
                          invoice.type === "SALES" &&
                          (invoice.invoiceType === "E_INVOICE" || invoice.invoiceType === "E_ARCHIVE") && (
                            <WriteAction>
                              <Button variant="outline" size="sm" onClick={() => handleSendInvoice(invoice.id)} disabled={isLoading}>
                                <Send className="mr-1 h-3 w-3" />
                                Gönder
                              </Button>
                            </WriteAction>
                          )}
                      </div>
                    </TableCell>
                  </StyledTableRow>
                ))
              )}
            </TableBody>
          </Table>
          </StyledTableContainer>
        </CardContent>
      </Card>
    </div>
  )
}
