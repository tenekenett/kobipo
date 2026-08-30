"use client"

import { useEffect, useState, useCallback, useMemo, useRef } from "react"
import Link from "next/link"
import { useSearchParams, useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
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
} from "@/components/ui/styled-table"
import { useToast } from "@/components/ui/use-toast"
import { useConfirm } from "@/components/ui/confirm-dialog-provider"
import {
  Download,
  Loader2,
  RefreshCw,
  Inbox,
  Search,
  FileDown,
  CheckCircle2,
  XCircle,
  Clock,
  Link2,
  Building2,
  Hash,
  SlidersHorizontal,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  CalendarRange,
  X,
} from "lucide-react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { parseTrNumber } from "@/lib/format"
import { ExportAction, WriteAction } from "@/components/dashboard/write-guard"

interface IncomingRow {
  id: string
  uuid: string
  invoiceNo: string | null
  date: string | null
  sentDate: string | null
  sender: { name: string | null; taxNumber: string | null }
  profile: string | null
  invoiceType: string | null
  currency: string | null
  taxExclusiveAmount: string | number | null
  vatAmount: string | number | null
  totalAmount: string | number | null
  status: string | null
  envelopeStatusDesc: string | null
  isArchived: boolean
  isLinkedToPurchase: boolean
  linkedInvoiceId: string | null
  syncedAt: string
}

const fmtCurrency = (v: string | number | null, ccy = "TRY") =>
  v === null || v === undefined
    ? "-"
    : new Intl.NumberFormat("tr-TR", { style: "currency", currency: ccy }).format(Number(v))

const fmtDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString("tr-TR") : "-"

// Saati yalnızca anlamlıysa (gece yarısı 00:00 değilse) döndür — Mysoft fatura
// tarihini çoğu zaman saatsiz (00:00) gönderir; o durumda saat satırı gizlenir.
const fmtTimeIfMeaningful = (d: string | null) => {
  if (!d) return null
  const dt = new Date(d)
  if (dt.getHours() === 0 && dt.getMinutes() === 0) return null
  return dt.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })
}

const fmtDateTime = (d: string | null) =>
  d
    ? new Date(d).toLocaleString("tr-TR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "-"

/**
 * Tutar kutusuna yalnız rakam ve ondalık/binlik ayracı girilebilir.
 *
 * Serbest metin kabul ediliyordu ve sonucu görünenden kötüydü: "sadadasdadda"
 * sunucuya gidiyor, orada sayıya çevrilemediği için filtre SESSİZCE düşüyordu —
 * rozet "3 filtre" derken gerçekte biri uygulanıyordu. Karakteri kapıda kesmek
 * hatayı en başta engelliyor; ayraçtan ibaret kalıntı ("," gibi) da alanın
 * altında uyarı olarak görünür ve isteğe eklenmez.
 */
const sanitizeAmountInput = (raw: string) => raw.replace(/[^\d.,]/g, "")

/**
 * Kutudaki metni API'ye gidecek tek biçime çevirir ("1.500,50" → "1500.5").
 * Çözülemeyen değer boş döner, yani istek parametresi hiç eklenmez.
 */
const canonicalAmount = (raw: string) => {
  const value = parseTrNumber(raw)
  return value === null ? "" : String(value)
}

/** Hazır dönemler — hem seçicide hem "aralığı genişlet" önerisinde kullanılır. */
const RANGE_PRESETS = [
  { days: 7, label: "Son 7 gün" },
  { days: 30, label: "Son 30 gün" },
  { days: 90, label: "Son 90 gün" },
  { days: 180, label: "Son 6 ay" },
  { days: 365, label: "Son 1 yıl" },
] as const

const DAY_MS = 24 * 60 * 60 * 1000
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY_MS)
const toDateInput = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`

// Mysoft dönem uçları 90 günden uzun aralığı reddediyor; sunucu isteği 90 günlük
// pencerelere bölerek çekiyor (bkz. mysoft-provider.listIncomingInvoices). Ekranda
// yalnızca "uzun sürebilir" uyarısı için kullanılır.
const MYSOFT_WINDOW_DAYS = 90

type Bucket = { count: number; sum: number }
interface Stats {
  total: Bucket
  accepted: Bucket
  rejected: Bucket
  pending: Bucket
  linked: Bucket
  // Özet tutarlar ₺ karşılığıdır; kaç faturanın döviz olduğu ve kaçının kuru
  // olmadığı için toplam dışında kaldığı buradan gelir.
  currency?: { foreign: number; unconverted: number }
}
const emptyStats = (): Stats => ({
  total: { count: 0, sum: 0 },
  accepted: { count: 0, sum: 0 },
  rejected: { count: 0, sum: 0 },
  pending: { count: 0, sum: 0 },
  linked: { count: 0, sum: 0 },
  currency: { foreign: 0, unconverted: 0 },
})

export default function GelenEFaturalarPage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const companyId = searchParams.get("company")
  const { toast } = useToast()
  const { confirm, prompt } = useConfirm()

  const [rows, setRows] = useState<IncomingRow[]>([])
  const [isLoading, setIsLoading] = useState(false)
  /** Yarışan liste isteklerinde yalnız en sonuncusunun yanıtı yazılsın diye sıra no. */
  const requestSeq = useRef(0)
  const [isSyncing, setIsSyncing] = useState(false)
  const [downloadingPdfUuid, setDownloadingPdfUuid] = useState<string | null>(null)
  const [respondingUuid, setRespondingUuid] = useState<string | null>(null)

  // --- Tarih aralığı: hazır dönem YA DA elle girilen aralık --------------------
  // dateField, aralığın hangi tarihe uygulanacağını seçer: belge tarihi mi, zarfın
  // GİB'e düştüğü an mı? Geçen ay düzenlenip bu hafta gönderilen fatura ikisinde
  // farklı aralıklara düşer.
  const [dateField, setDateField] = useState<"docDate" | "sentDate">("docDate")
  const [days, setDays] = useState(30)
  const [customRange, setCustomRange] = useState(false)
  const [startDate, setStartDate] = useState(() => toDateInput(addDays(new Date(), -30)))
  const [endDate, setEndDate] = useState(() => toDateInput(new Date()))

  // --- Filtreler: metin alanları debounce'lanır, seçimler anında uygulanır -----
  const [showFilters, setShowFilters] = useState(false)
  const [search, setSearch] = useState("")
  const [senderFilter, setSenderFilter] = useState("")
  const [taxNumberFilter, setTaxNumberFilter] = useState("")
  const [minAmount, setMinAmount] = useState("")
  const [maxAmount, setMaxAmount] = useState("")
  const [statusFilter, setStatusFilter] = useState<string>("")
  const [profileFilter, setProfileFilter] = useState<string>("")
  const [linkFilter, setLinkFilter] = useState<string>("")

  const [debouncedText, setDebouncedText] = useState({
    q: "",
    sender: "",
    taxNumber: "",
    minAmount: "",
    maxAmount: "",
  })
  useEffect(() => {
    const t = setTimeout(() => {
      const next = {
        q: search.trim(),
        sender: senderFilter.trim(),
        taxNumber: taxNumberFilter.trim(),
        minAmount: canonicalAmount(minAmount),
        maxAmount: canonicalAmount(maxAmount),
      }
      // Değer aynıysa ÖNCEKİ nesneyi koru: yeni bir nesne kimliği fetchList'i
      // (dolayısıyla gereksiz bir isteği) tetiklerdi — açılışta ikinci kez sorgu.
      setDebouncedText((prev) =>
        (Object.keys(next) as Array<keyof typeof next>).every((k) => prev[k] === next[k])
          ? prev
          : next,
      )
    }, 400)
    return () => clearTimeout(t)
  }, [search, senderFilter, taxNumberFilter, minAmount, maxAmount])

  // --- Sayfalama ve özet: ikisi de SUNUCUDAN gelir ----------------------------
  // Filtreleme sunucuda yapıldığı için özet kartlar sayfayı değil, filtreye uyan
  // TÜM kayıtları sayar.
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(100)
  const [total, setTotal] = useState(0)
  const [stats, setStats] = useState<Stats>(emptyStats)
  // Gönderilme tarihi ölçütünde, o tarihi hiç olmayan kayıt sayısı — sessizce
  // kaybolmasınlar diye ekranda uyarı olarak gösterilir.
  const [missingSentDate, setMissingSentDate] = useState(0)
  // Liste boşken: kayıt gerçekten yok mu, yoksa aralığın dışında mı?
  const [emptyHint, setEmptyHint] = useState<{
    latestDate: string | null
    count: number
  } | null>(null)

  // Seçilen aralığın ISO karşılığı. Elle aralıkta bitiş GÜNÜN SONUNA kadar dahildir
  // (23:59:59); yoksa "bitişi bugün seçtim ama bugünün faturaları yok" olurdu.
  const range = useMemo(() => {
    if (customRange) {
      const s = new Date(`${startDate}T00:00:00`)
      const e = new Date(`${endDate}T23:59:59.999`)
      const valid =
        !Number.isNaN(s.getTime()) && !Number.isNaN(e.getTime()) && s.getTime() <= e.getTime()
      return {
        startDate: valid ? s.toISOString() : "",
        endDate: valid ? e.toISOString() : "",
        valid,
      }
    }
    const e = new Date()
    return { startDate: addDays(e, -days).toISOString(), endDate: e.toISOString(), valid: true }
  }, [customRange, startDate, endDate, days])

  const rangeDays = range.valid
    ? Math.round(
        (new Date(range.endDate).getTime() - new Date(range.startDate).getTime()) / DAY_MS,
      )
    : 0

  // Sayıya çevrilemeyen tutar isteğe EKLENMEZ; alanın altında uyarı görünür.
  const minAmountValue = minAmount.trim() ? parseTrNumber(minAmount) : null
  const maxAmountValue = maxAmount.trim() ? parseTrNumber(maxAmount) : null
  const minAmountInvalid = minAmount.trim() !== "" && minAmountValue === null
  const maxAmountInvalid = maxAmount.trim() !== "" && maxAmountValue === null

  // Rozet yalnız GERÇEKTEN uygulanan filtreleri sayar — okunamayan tutarı da
  // saymak "3 filtre var" deyip ikisini uygulamamak olurdu.
  const activeFilterCount =
    [search, senderFilter, taxNumberFilter, statusFilter, profileFilter, linkFilter].filter(
      (v) => v.trim() !== "",
    ).length +
    (minAmountValue !== null ? 1 : 0) +
    (maxAmountValue !== null ? 1 : 0)

  const resetFilters = () => {
    setSearch("")
    setSenderFilter("")
    setTaxNumberFilter("")
    setMinAmount("")
    setMaxAmount("")
    setStatusFilter("")
    setProfileFilter("")
    setLinkFilter("")
    setPage(1)
  }

  const fetchList = useCallback(async () => {
    if (!companyId) return
    // Geçersiz aralıkta istek atmıyoruz; uyarı tarih alanlarının altında görünür.
    if (!range.valid) return
    // Filtreler hızlı değişince istekler yarışıyor ve GEÇ dönen ESKİ yanıt yeniyi
    // ezebiliyordu: ekranda "Beklemede" seçiliyken tüm faturaların listesi kalırdı.
    // Her isteğe sıra numarası verip yalnız en sonuncunun yanıtını yazıyoruz.
    const seq = ++requestSeq.current
    setIsLoading(true)
    try {
      const params = new URLSearchParams({
        companyId,
        source: "db",
        startDate: range.startDate,
        endDate: range.endDate,
        dateField,
        page: String(page),
        pageSize: String(pageSize),
      })
      if (statusFilter) params.set("status", statusFilter)
      if (profileFilter) params.set("profile", profileFilter)
      if (linkFilter) params.set("linked", linkFilter)
      if (debouncedText.q) params.set("q", debouncedText.q)
      if (debouncedText.sender) params.set("sender", debouncedText.sender)
      if (debouncedText.taxNumber) params.set("taxNumber", debouncedText.taxNumber)
      if (debouncedText.minAmount) params.set("minAmount", debouncedText.minAmount)
      if (debouncedText.maxAmount) params.set("maxAmount", debouncedText.maxAmount)
      const res = await fetch(`/api/e-donusum/inbox?${params.toString()}`)
      const data = await res.json()
      if (seq !== requestSeq.current) return
      if (!res.ok) {
        toast({
          title: "Liste alınamadı",
          description: data.error || "Bilinmeyen hata",
          variant: "destructive",
        })
        return
      }
      setRows(data.data || [])
      setTotal(Number(data.total || 0))
      setStats(data.stats || emptyStats())
      setMissingSentDate(Number(data.missingSentDate || 0))
      setEmptyHint(data.emptyHint ?? null)
    } catch (e: any) {
      if (seq !== requestSeq.current) return
      toast({
        title: "Hata",
        description: e?.message || "Liste yüklenirken hata",
        variant: "destructive",
      })
    } finally {
      // Daha yeni bir istek varsa yükleniyor göstergesini O kapatsın.
      if (seq === requestSeq.current) setIsLoading(false)
    }
  }, [
    companyId,
    range,
    dateField,
    page,
    pageSize,
    statusFilter,
    profileFilter,
    linkFilter,
    debouncedText,
    toast,
  ])

  useEffect(() => {
    fetchList()
  }, [fetchList])

  const handleDownloadPdf = async (uuid: string, invoiceNo: string | null) => {
    if (!companyId) return
    setDownloadingPdfUuid(uuid)
    try {
      const res = await fetch(
        `/api/e-donusum/inbox/${encodeURIComponent(uuid)}/pdf?companyId=${encodeURIComponent(
          companyId,
        )}`,
      )
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast({
          title: "PDF indirilemedi",
          description: data.error || "Bilinmeyen hata",
          variant: "destructive",
        })
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      window.open(url, "_blank", "noopener")
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
      toast({ title: `PDF açıldı${invoiceNo ? ` · ${invoiceNo}` : ""}` })
    } catch (e: any) {
      toast({
        title: "Hata",
        description: e?.message || "PDF açılırken hata oluştu",
        variant: "destructive",
      })
    } finally {
      setDownloadingPdfUuid(null)
    }
  }

  const handleRespond = async (
    uuid: string,
    action: "accept" | "reject",
    invoiceNo: string | null,
  ) => {
    if (!companyId) return
    let rejectReason = ""
    if (action === "reject") {
      const input = await prompt({
        title: "Faturayı reddet",
        description: `Bu faturayı reddetmek istediğinize emin misiniz? Yanıt GİB'e iletilir.${invoiceNo ? ` (${invoiceNo})` : ""}`,
        label: "Red nedeni (en az 3 karakter)",
        placeholder: "Örn. Hatalı düzenlenmiş",
        minLength: 3,
        confirmLabel: "Reddet",
        variant: "destructive",
      })
      if (input === null) return
      rejectReason = input.trim()
      if (rejectReason.length < 3) {
        toast({ title: "Red nedeni en az 3 karakter olmalı", variant: "destructive" })
        return
      }
    } else if (!(await confirm({ title: "Faturayı kabul et", description: `Bu faturayı KABUL etmek istediğinize emin misiniz?${invoiceNo ? ` (${invoiceNo})` : ""}`, confirmLabel: "Kabul et" }))) {
      return
    }
    setRespondingUuid(uuid)
    try {
      const res = await fetch(`/api/e-donusum/inbox/${encodeURIComponent(uuid)}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, action, rejectReason }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast({
          title: action === "accept" ? "Kabul başarısız" : "Red başarısız",
          description: data.error || "Bilinmeyen hata",
          variant: "destructive",
        })
        return
      }
      toast({
        title: action === "accept" ? "Fatura kabul edildi" : "Fatura reddedildi",
        description: data.message || undefined,
      })
      // Yerel satırı anında güncelle, sonra listeyi tazele.
      setRows((prev) =>
        prev.map((r) => (r.uuid === uuid ? { ...r, status: action === "accept" ? "KABUL" : "RED" } : r)),
      )
      await fetchList()
    } catch (e: any) {
      toast({ title: "Hata", description: e?.message || "İşlem sırasında hata", variant: "destructive" })
    } finally {
      setRespondingUuid(null)
    }
  }

  const handleSync = async () => {
    if (!companyId) return
    if (!range.valid) {
      toast({ title: "Tarih aralığı geçersiz", variant: "destructive" })
      return
    }
    setIsSyncing(true)
    try {
      // Aralığı AÇIKÇA gönderiyoruz: ekranda ne seçiliyse Mysoft'tan o çekilir.
      // 90 günü aşan aralığı sunucu 90 günlük pencerelere bölerek alır.
      const res = await fetch("/api/e-donusum/inbox/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId,
          startDate: range.startDate,
          endDate: range.endDate,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast({
          title: "Senkronizasyon başarısız",
          description: data.error || "Bilinmeyen hata",
          variant: "destructive",
        })
        return
      }
      // Kısmî başarı sessiz geçilmez: bir dönem parçası alınamadıysa liste eksiktir.
      const warnings: string[] = data.warnings || []
      toast({
        title: warnings.length ? "Senkronize edildi (eksik dönem var)" : "Senkronize edildi",
        description: `Toplam ${data.fetched} kayıt · ${data.inserted} yeni · ${data.updated} güncellendi${
          data.errors?.length ? ` · ${data.errors.length} hata` : ""
        }${warnings.length ? ` · Alınamayan dönem: ${warnings.join(" | ")}` : ""}`,
        variant: warnings.length ? "destructive" : undefined,
      })
      await fetchList()
    } catch (e: any) {
      toast({
        title: "Hata",
        description: e?.message || "Sync sırasında hata",
        variant: "destructive",
      })
    } finally {
      setIsSyncing(false)
    }
  }

  // Filtreleme ve özetleme SUNUCUDA yapılır (bkz. /api/e-donusum/inbox): sayfalama
  // varken istemcide filtrelemek "aradığım fatura bu sayfada olmadığı için yok
  // görünüyor" demek olurdu.
  // Liste boş ama filtreye uyan kayıt aralığın DIŞINDA duruyorsa, kullanıcıyı tek
  // tıkla oraya götür. Hazır dönemlerden yeteni seçilir; hiçbiri yetmiyorsa özel
  // aralık o tarihe kadar açılır.
  const widen = useMemo(() => {
    if (!emptyHint?.latestDate || emptyHint.count === 0) return null
    const latest = new Date(emptyHint.latestDate)
    if (Number.isNaN(latest.getTime())) return null
    const neededDays = Math.ceil((Date.now() - latest.getTime()) / DAY_MS) + 1
    return {
      latest,
      count: emptyHint.count,
      preset: RANGE_PRESETS.find((p) => p.days >= neededDays) ?? null,
    }
  }, [emptyHint])

  const applyWiden = () => {
    if (!widen) return
    setPage(1)
    if (widen.preset) {
      setCustomRange(false)
      setDays(widen.preset.days)
      return
    }
    setStartDate(toDateInput(addDays(widen.latest, -1)))
    setEndDate(toDateInput(new Date()))
    setCustomRange(true)
  }

  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const firstRowNo = total === 0 ? 0 : (page - 1) * pageSize + 1
  const lastRowNo = (page - 1) * pageSize + rows.length

  if (!companyId) {
    return (
      <div className="flex items-center justify-center p-8">
        <p className="text-muted-foreground">Lütfen bir firma seçin</p>
      </div>
    )
  }

  const fmtSum = (v: number) =>
    new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(v)

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Inbox className="h-7 w-7 text-kobipo-blue" />
            Gelen E-Faturalar
          </h1>
          <p className="text-sm text-muted-foreground">
            Mysoft InvoiceInbox üzerinden çekilen gelen e-fatura/e-arşiv listesi
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="rounded border px-2 py-1 text-sm"
              value={dateField}
              onChange={(e) => {
                setPage(1)
                setDateField(e.target.value as "docDate" | "sentDate")
              }}
              disabled={isSyncing}
              aria-label="Tarih ölçütü"
              title="Tarih aralığı hangi tarihe uygulansın?"
            >
              <option value="docDate">Fatura tarihine göre</option>
              <option value="sentDate">Gönderilme tarihine göre</option>
            </select>
            <select
              className="rounded border px-2 py-1 text-sm"
              value={customRange ? "custom" : String(days)}
              onChange={(e) => {
                setPage(1)
                if (e.target.value === "custom") {
                  // Hazır dönemden özel aralığa geçerken alanları o dönemle doldur;
                  // kullanıcı sıfırdan tarih yazmak zorunda kalmasın.
                  setStartDate(toDateInput(addDays(new Date(), -days)))
                  setEndDate(toDateInput(new Date()))
                  setCustomRange(true)
                  return
                }
                setCustomRange(false)
                setDays(Number(e.target.value))
              }}
              disabled={isSyncing}
            >
              {RANGE_PRESETS.map((preset) => (
                <option key={preset.days} value={preset.days}>
                  {preset.label}
                </option>
              ))}
              <option value="custom">Özel aralık…</option>
            </select>
            {customRange && (
              <div className="flex items-center gap-1.5">
                <Input
                  type="date"
                  value={startDate}
                  max={endDate || undefined}
                  onChange={(e) => {
                    setPage(1)
                    setStartDate(e.target.value)
                  }}
                  disabled={isSyncing}
                  className="h-8 w-[145px] text-sm"
                  aria-label="Başlangıç tarihi"
                />
                <span className="text-muted-foreground">–</span>
                <Input
                  type="date"
                  value={endDate}
                  min={startDate || undefined}
                  onChange={(e) => {
                    setPage(1)
                    setEndDate(e.target.value)
                  }}
                  disabled={isSyncing}
                  className="h-8 w-[145px] text-sm"
                  aria-label="Bitiş tarihi"
                />
              </div>
            )}
            {/* Senkronizasyon gelen kutusuna KAYIT YAZAR; kabul/red ise GİB'e cevap
                gönderir. İkisi de salt-okunur yetkide gizlenir. */}
            <WriteAction>
              <Button onClick={handleSync} disabled={isSyncing || !range.valid}>
                {isSyncing ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Download className="mr-2 h-4 w-4" />
                )}
                Mysoft'tan Senkronize Et
              </Button>
            </WriteAction>
            <Button variant="outline" onClick={fetchList} disabled={isLoading || !range.valid}>
              {isLoading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              Yenile
            </Button>
          </div>
          {!range.valid ? (
            <p className="flex items-center gap-1 text-xs font-medium text-red-600 dark:text-red-400">
              <AlertTriangle className="h-3.5 w-3.5" />
              Başlangıç tarihi bitiş tarihinden sonra olamaz.
            </p>
          ) : rangeDays > MYSOFT_WINDOW_DAYS ? (
            <p className="max-w-[460px] text-right text-[11px] text-muted-foreground">
              {rangeDays} günlük aralık Mysoft tarafına 90 günlük parçalar hâlinde sorulur
              — senkronizasyon biraz uzun sürebilir.
            </p>
          ) : null}
          {/* Gönderilme tarihi ham yanıttan türetilir; hiç gelmediyse o kayıt bu
              ölçütte listelenemez. Sayıyı söylemek, sessizce eksik liste vermekten iyi. */}
          {dateField === "sentDate" && missingSentDate > 0 && (
            <p className="max-w-[460px] text-right text-[11px] text-amber-700 dark:text-amber-300">
              {missingSentDate} kayıtta gönderilme tarihi yok (Mysoft göndermemiş); bu
              ölçütte listelenmezler. Fatura tarihine geçerek görebilirsiniz.
            </p>
          )}
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
        <Card className="border-slate-200 dark:border-slate-700/60">
          <CardContent className="flex items-center justify-between pt-6">
            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground">
                Toplam
              </p>
              <p className="text-2xl font-bold">{stats.total.count}</p>
              <p className="text-xs text-muted-foreground">{fmtSum(stats.total.sum)}</p>
            </div>
            <Inbox className="h-8 w-8 text-slate-300 dark:text-slate-500" />
          </CardContent>
        </Card>
        <Card className="border-emerald-200 dark:border-emerald-500/30">
          <CardContent className="flex items-center justify-between pt-6">
            <div>
              <p className="text-xs uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
                Kabul
              </p>
              <p className="text-2xl font-bold text-emerald-800 dark:text-emerald-200">
                {stats.accepted.count}
              </p>
              <p className="text-xs text-emerald-700/80 dark:text-emerald-300/80">
                {fmtSum(stats.accepted.sum)}
              </p>
            </div>
            <CheckCircle2 className="h-8 w-8 text-emerald-300 dark:text-emerald-500/70" />
          </CardContent>
        </Card>
        <Card className="border-red-200 dark:border-red-500/30">
          <CardContent className="flex items-center justify-between pt-6">
            <div>
              <p className="text-xs uppercase tracking-wider text-red-700 dark:text-red-300">
                Red
              </p>
              <p className="text-2xl font-bold text-red-800 dark:text-red-200">
                {stats.rejected.count}
              </p>
              <p className="text-xs text-red-700/80 dark:text-red-300/80">
                {fmtSum(stats.rejected.sum)}
              </p>
            </div>
            <XCircle className="h-8 w-8 text-red-300 dark:text-red-500/70" />
          </CardContent>
        </Card>
        <Card className="border-amber-200 dark:border-amber-500/30">
          <CardContent className="flex items-center justify-between pt-6">
            <div>
              <p className="text-xs uppercase tracking-wider text-amber-700 dark:text-amber-300">
                Bekleyen
              </p>
              <p className="text-2xl font-bold text-amber-800 dark:text-amber-200">
                {stats.pending.count}
              </p>
              <p className="text-xs text-amber-700/80 dark:text-amber-300/80">
                {fmtSum(stats.pending.sum)}
              </p>
            </div>
            <Clock className="h-8 w-8 text-amber-300 dark:text-amber-500/70" />
          </CardContent>
        </Card>
      </div>

      {/* Döviz notu: özet kartlardaki ₺ rakamı fatura kuruyla çevrilmiş toplamdır.
          Kuru olmayan döviz faturası toplama katılmaz — sayısı ayrıca söylenir. */}
      {(stats.currency?.foreign ?? 0) > 0 && (
        <p className="text-[11px] text-muted-foreground">
          Özet tutarlar ₺ karşılığıdır: {stats.currency!.foreign} döviz faturası kendi
          kuruyla çevrildi.
          {(stats.currency?.unconverted ?? 0) > 0 && (
            <span className="ml-1 font-medium text-amber-700 dark:text-amber-300">
              {stats.currency!.unconverted} fatura kuru bilinmediği için toplama dahil
              edilmedi.
            </span>
          )}
        </p>
      )}

      {/* Linked banner */}
      {stats.linked.count > 0 && (
        <div className="flex items-center gap-2 rounded-md border border-sky-200 bg-sky-50 px-4 py-2 text-sm text-sky-900 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-200">
          <Link2 className="h-4 w-4" />
          <span>
            <strong>{stats.linked.count}</strong> fatura zaten alış faturasına dönüştürülmüş ·
            Toplam tutar: {fmtSum(stats.linked.sum)}
          </span>
        </div>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            {total} fatura listelendi
            {total > rows.length && (
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                ({firstRowNo}-{lastRowNo} arası gösteriliyor)
              </span>
            )}
          </CardTitle>
          <CardDescription>
            Liste DB'den okunur — güncel veri için "Mysoft'tan Senkronize Et" butonuna basın.
            Filtreler seçili tarih aralığının tamamına uygulanır. Bir satıra tıklayarak
            detay sayfasına gidebilirsiniz.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[220px] max-w-md">
              <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Fatura no / gönderici / VKN / ETTN ara..."
                value={search}
                onChange={(e) => {
                  setPage(1)
                  setSearch(e.target.value)
                }}
                className="pl-8"
              />
            </div>
            <select
              className="rounded border px-2 py-1.5 text-sm"
              value={statusFilter}
              onChange={(e) => {
                setPage(1)
                setStatusFilter(e.target.value)
              }}
            >
              <option value="">Tüm durumlar</option>
              <option value="KABUL">Kabul</option>
              <option value="RED">Red</option>
              <option value="BEKLEMEDE">Beklemede</option>
            </select>
            <Button
              type="button"
              variant={showFilters ? "default" : "outline"}
              size="sm"
              onClick={() => setShowFilters((v) => !v)}
            >
              <SlidersHorizontal className="mr-2 h-4 w-4" />
              Detaylı filtre
              {activeFilterCount > 0 && (
                <span className="ml-2 rounded-full bg-kobipo-blue px-1.5 text-[10px] font-semibold text-white dark:bg-kobipo-mid">
                  {activeFilterCount}
                </span>
              )}
            </Button>
            {activeFilterCount > 0 && (
              <Button type="button" variant="ghost" size="sm" onClick={resetFilters}>
                <X className="mr-1 h-4 w-4" />
                Temizle
              </Button>
            )}
          </div>

          {showFilters && (
            <div className="mb-4 grid gap-3 rounded-md border bg-muted/30 p-3 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <Label className="text-xs">Gönderici ünvanı</Label>
                <Input
                  value={senderFilter}
                  onChange={(e) => {
                    setPage(1)
                    setSenderFilter(e.target.value)
                  }}
                  placeholder="Örn. ABC Gıda"
                  className="h-8 text-sm"
                />
              </div>
              <div>
                <Label className="text-xs">Gönderici VKN / TCKN</Label>
                <Input
                  value={taxNumberFilter}
                  onChange={(e) => {
                    setPage(1)
                    setTaxNumberFilter(e.target.value)
                  }}
                  placeholder="Örn. 1234567890"
                  inputMode="numeric"
                  className="h-8 font-mono text-sm"
                />
              </div>
              <div>
                <Label className="text-xs">Profil</Label>
                <select
                  className="mt-0.5 h-8 w-full rounded border bg-background px-2 text-sm"
                  value={profileFilter}
                  onChange={(e) => {
                    setPage(1)
                    setProfileFilter(e.target.value)
                  }}
                >
                  <option value="">Tüm profiller</option>
                  <option value="TICARIFATURA">Ticari Fatura</option>
                  <option value="TEMELFATURA">Temel Fatura</option>
                  <option value="EARSIVFATURA">E-Arşiv</option>
                </select>
              </div>
              <div>
                <Label className="text-xs">Dönüştürme durumu</Label>
                <select
                  className="mt-0.5 h-8 w-full rounded border bg-background px-2 text-sm"
                  value={linkFilter}
                  onChange={(e) => {
                    setPage(1)
                    setLinkFilter(e.target.value)
                  }}
                >
                  <option value="">Tümü</option>
                  <option value="linked">Alış faturasına dönüştürülenler</option>
                  <option value="unlinked">Dönüştürülmeyenler</option>
                </select>
              </div>
              <div>
                <Label className="text-xs">Tutar (min)</Label>
                <Input
                  value={minAmount}
                  onChange={(e) => {
                    setPage(1)
                    setMinAmount(sanitizeAmountInput(e.target.value))
                  }}
                  placeholder="0"
                  inputMode="decimal"
                  aria-invalid={minAmountInvalid || undefined}
                  className="h-8 text-sm"
                />
                {minAmountInvalid && (
                  <p className="mt-0.5 text-[10px] text-red-600 dark:text-red-400">
                    Sayı girin — bu değerle filtrelenmedi.
                  </p>
                )}
              </div>
              <div>
                <Label className="text-xs">Tutar (max)</Label>
                <Input
                  value={maxAmount}
                  onChange={(e) => {
                    setPage(1)
                    setMaxAmount(sanitizeAmountInput(e.target.value))
                  }}
                  placeholder="Sınırsız"
                  inputMode="decimal"
                  aria-invalid={maxAmountInvalid || undefined}
                  className="h-8 text-sm"
                />
                {maxAmountInvalid && (
                  <p className="mt-0.5 text-[10px] text-red-600 dark:text-red-400">
                    Sayı girin — bu değerle filtrelenmedi.
                  </p>
                )}
              </div>
              <div>
                <Label className="text-xs">Sayfa boyutu</Label>
                <select
                  className="mt-0.5 h-8 w-full rounded border bg-background px-2 text-sm"
                  value={pageSize}
                  onChange={(e) => {
                    setPage(1)
                    setPageSize(Number(e.target.value))
                  }}
                >
                  <option value={50}>50 kayıt</option>
                  <option value={100}>100 kayıt</option>
                  <option value={250}>250 kayıt</option>
                  <option value={500}>500 kayıt</option>
                </select>
              </div>
              <div className="flex items-end">
                <p className="text-[11px] leading-snug text-muted-foreground">
                  Tarih ölçütü ve aralığı sağ üstten seçilir; filtreler o aralıktaki tüm
                  kayıtlara uygulanır.
                </p>
              </div>
            </div>
          )}

          <StyledTableContainer>
            <Table>
              <TableHeader>
                <StyledTableHeaderRow>
                  <StyledTableHead>
                    Fatura Tarihi
                    {dateField === "docDate" && <RangeMark />}
                  </StyledTableHead>
                  <StyledTableHead>
                    Gönderilme Tarihi
                    {dateField === "sentDate" && <RangeMark />}
                  </StyledTableHead>
                  <StyledTableHead>Fatura No</StyledTableHead>
                  <StyledTableHead>Gönderen Ünvanı</StyledTableHead>
                  <StyledTableHead>Firma VKN</StyledTableHead>
                  <StyledTableHead>Profil</StyledTableHead>
                  <StyledTableHead>Tip</StyledTableHead>
                  <StyledTableHead className="text-right">Net</StyledTableHead>
                  <StyledTableHead className="text-right">KDV</StyledTableHead>
                  <StyledTableHead className="text-right">Tutar</StyledTableHead>
                  <StyledTableHead>Durum</StyledTableHead>
                  <StyledTableHead>Senkronize</StyledTableHead>
                  <StyledTableHead className="text-right">İşlem</StyledTableHead>
                </StyledTableHeaderRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={13} className="py-10 text-center">
                      <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                ) : rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={13} className="py-10 text-center">
                      <Inbox className="mx-auto mb-3 h-12 w-12 text-muted-foreground/40" />
                      {widen ? (
                        // Kayıt var, yalnız seçili aralığın dışında. "Hiç fatura yok"
                        // demek yanlış olurdu: kullanıcı veri gelmemiş sanıyor.
                        <div className="space-y-2">
                          <p className="text-muted-foreground">
                            Seçili tarih aralığında kayıt yok — ama{" "}
                            {activeFilterCount > 0 ? "filtreye uyan " : ""}
                            <strong>{widen.count}</strong> fatura aralığın dışında. En son{" "}
                            {dateField === "sentDate" ? "gönderilen" : "düzenlenen"} fatura{" "}
                            <strong>{fmtDate(widen.latest.toISOString())}</strong> tarihli.
                          </p>
                          <Button variant="outline" size="sm" onClick={applyWiden}>
                            <CalendarRange className="mr-2 h-4 w-4" />
                            {widen.preset
                              ? `${widen.preset.label} göster`
                              : `${fmtDate(widen.latest.toISOString())} tarihine kadar genişlet`}
                          </Button>
                        </div>
                      ) : (emptyHint?.count ?? 0) > 0 ? (
                        // Kayıt VAR ama seçili ölçütte tarihi yok (Mysoft göndermemiş).
                        // "Hiç fatura yok" demek yanlış olurdu.
                        <p className="text-muted-foreground">
                          <strong>{emptyHint!.count}</strong> kayıt var ama hiçbirinde{" "}
                          {dateField === "sentDate" ? "gönderilme" : "fatura"} tarihi yok, bu
                          yüzden tarih aralığına düşmüyorlar.{" "}
                          {dateField === "sentDate"
                            ? "Ölçütü “Fatura tarihine göre” yapmayı deneyin."
                            : "Ölçütü “Gönderilme tarihine göre” yapmayı deneyin."}
                        </p>
                      ) : (
                        <p className="text-muted-foreground">
                          {activeFilterCount > 0
                            ? "Aramaya / filtreye uyan kayıt yok."
                            : "Bu firmada henüz çekilmiş gelen fatura yok. 'Mysoft'tan Senkronize Et' butonuna basın."}
                        </p>
                      )}
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((row, idx) => {
                    // Satır hedefi; "Belge No" hücresindeki gerçek bağlantı da bunu kullanır.
                    const rowHref = `/alis/gelen-e-faturalar/${encodeURIComponent(
                      row.uuid,
                    )}?company=${encodeURIComponent(companyId)}`
                    return (
                      <StyledTableRow
                        key={row.id}
                        index={idx}
                        className="cursor-pointer"
                        // Satırın tamamı bağlantı yüzeyi: sağ tık → "yeni sekmede aç".
                        href={rowHref}
                        hrefLabel={row.invoiceNo ? `${row.invoiceNo} detayı` : undefined}
                      >
                        <TableCell className="text-xs whitespace-nowrap">
                          <div>{fmtDate(row.date)}</div>
                          {fmtTimeIfMeaningful(row.date) && (
                            <div className="text-[11px] text-muted-foreground">
                              {fmtTimeIfMeaningful(row.date)}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
                          {row.sentDate ? fmtDateTime(row.sentDate) : "-"}
                        </TableCell>
                        <TableCell className="font-mono text-xs font-medium text-kobipo-blue dark:text-kobipo-mid">
                          {/* Gerçek bağlantı: sağ tık → "yeni sekmede aç" burada çalışır. */}
                          {row.invoiceNo ? (
                            <Link href={rowHref} className="hover:underline">
                              {row.invoiceNo}
                            </Link>
                          ) : (
                            "-"
                          )}
                        </TableCell>
                        <TableCell className="text-xs">
                          <div className="flex items-center gap-1.5">
                            <Building2 className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
                            <span className="truncate max-w-[260px]" title={row.sender.name || ""}>
                              {row.sender.name || "-"}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {row.sender.taxNumber || "-"}
                        </TableCell>
                        <TableCell>
                          <ProfileBadge profile={row.profile} />
                        </TableCell>
                        <TableCell>
                          <TypeBadge type={row.invoiceType} />
                        </TableCell>
                        <TableCell className="text-right text-xs whitespace-nowrap">
                          {fmtCurrency(row.taxExclusiveAmount, row.currency || "TRY")}
                        </TableCell>
                        <TableCell className="text-right text-xs whitespace-nowrap">
                          {fmtCurrency(row.vatAmount, row.currency || "TRY")}
                        </TableCell>
                        <TableCell className="text-right text-xs font-semibold whitespace-nowrap">
                          {fmtCurrency(row.totalAmount, row.currency || "TRY")}
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={row.status} />
                          {row.isLinkedToPurchase && (
                            <span
                              className="ml-1 inline-flex items-center gap-1 rounded border border-sky-300 bg-sky-50 px-1.5 py-0.5 text-[9px] font-medium text-sky-800 dark:border-sky-500/40 dark:bg-sky-500/15 dark:text-sky-200"
                              title="Bu fatura alış faturasına dönüştürülmüş"
                            >
                              <Link2 className="h-2.5 w-2.5" />
                              Bağlı
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-[10px] text-muted-foreground whitespace-nowrap">
                          {fmtDateTime(row.syncedAt)}
                        </TableCell>
                        {/* Aksiyon hücresi bağlantı kaplamasının dışında. */}
                        <TableCell data-row-link-skip className="text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-1">
                            {row.profile === "TICARIFATURA" &&
                              (row.status || "").toUpperCase() !== "KABUL" &&
                              (row.status || "").toUpperCase() !== "RED" && (
                                <WriteAction>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleRespond(row.uuid, "accept", row.invoiceNo)}
                                    disabled={respondingUuid === row.uuid}
                                    title="Kabul et"
                                    className="text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700 dark:text-emerald-300 dark:hover:bg-emerald-500/15 dark:hover:text-emerald-200"
                                  >
                                    {respondingUuid === row.uuid ? (
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                      <CheckCircle2 className="h-4 w-4" />
                                    )}
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleRespond(row.uuid, "reject", row.invoiceNo)}
                                    disabled={respondingUuid === row.uuid}
                                    title="Reddet"
                                    className="text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-300 dark:hover:bg-red-500/15 dark:hover:text-red-200"
                                  >
                                    <XCircle className="h-4 w-4" />
                                  </Button>
                                </WriteAction>
                              )}
                            <ExportAction>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleDownloadPdf(row.uuid, row.invoiceNo)}
                                disabled={downloadingPdfUuid === row.uuid}
                                title="PDF indir / aç"
                                className="text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:text-rose-300 dark:hover:bg-rose-500/15 dark:hover:text-rose-200"
                              >
                                {downloadingPdfUuid === row.uuid ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <FileDown className="h-4 w-4" />
                                )}
                              </Button>
                            </ExportAction>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => router.push(rowHref)}
                              title="Detay"
                              className="text-amber-600 hover:bg-amber-50 hover:text-amber-700 dark:text-amber-300 dark:hover:bg-amber-500/15 dark:hover:text-amber-200"
                            >
                              <Hash className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </StyledTableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </StyledTableContainer>

          {pageCount > 1 && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="text-muted-foreground">
                {firstRowNo}-{lastRowNo} / {total} kayıt · Sayfa {page}/{pageCount}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1 || isLoading}
                >
                  <ChevronLeft className="mr-1 h-4 w-4" />
                  Önceki
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                  disabled={page >= pageCount || isLoading}
                >
                  Sonraki
                  <ChevronRight className="ml-1 h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

/**
 * Tarih aralığının HANGİ sütuna uygulandığını başlıkta gösterir.
 *
 * Renkler başlık SATIRINA göre seçili: satır `bg-kobipo-blue` (koyu mavi) ve yazı
 * beyaz. Mavi zemine mavi rozet koymak onu görünmez yapıyordu — saydam beyaz zemin
 * + beyaz yazı hem açık hem koyu temada okunur kalıyor.
 */
function RangeMark() {
  return (
    <span
      className="ml-1.5 rounded border border-white/40 bg-white/20 px-1 py-0.5 text-[9px] font-semibold normal-case text-white dark:border-kobipo-text/40 dark:bg-kobipo-text/15 dark:text-kobipo-text"
      title="Seçili tarih aralığı bu sütuna uygulanıyor"
    >
      aralık
    </span>
  )
}

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-xs text-muted-foreground">-</span>
  const s = status.toUpperCase()
  const cls =
    s === "KABUL"
      ? "border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-500/15 dark:text-emerald-200"
      : s === "RED"
        ? "border-red-300 bg-red-100 text-red-800 dark:border-red-500/40 dark:bg-red-500/15 dark:text-red-200"
        : "border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-200"
  const label = s === "KABUL" ? "Kabul Edildi" : s === "RED" ? "Reddedildi" : status
  return (
    <span
      className={`inline-flex items-center rounded border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cls}`}
    >
      {label}
    </span>
  )
}

function ProfileBadge({ profile }: { profile: string | null }) {
  if (!profile) return <span className="text-xs text-muted-foreground">-</span>
  const map: Record<string, { label: string; cls: string }> = {
    TICARIFATURA: {
      label: "Ticari",
      cls: "bg-indigo-50 text-indigo-800 border-indigo-200 dark:bg-indigo-500/15 dark:text-indigo-200 dark:border-indigo-500/40",
    },
    TEMELFATURA: {
      label: "Temel",
      cls: "bg-slate-50 text-slate-700 dark:bg-slate-500/15 dark:text-slate-300 border-slate-200 dark:bg-slate-500/15 dark:text-slate-200 dark:border-slate-500/40",
    },
    EARSIVFATURA: {
      label: "E-Arşiv",
      cls: "bg-cyan-50 text-cyan-800 border-cyan-200 dark:bg-cyan-500/15 dark:text-cyan-200 dark:border-cyan-500/40",
    },
    EFATURA: {
      label: "E-Fatura",
      cls: "bg-sky-50 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300 border-sky-200 dark:bg-sky-500/15 dark:text-sky-200 dark:border-sky-500/40",
    },
  }
  const entry =
    map[profile] || {
      label: profile,
      cls: "bg-slate-50 text-slate-700 dark:bg-slate-500/15 dark:text-slate-300 border-slate-200 dark:bg-slate-500/15 dark:text-slate-200 dark:border-slate-500/40",
    }
  return (
    <span
      className={`inline-flex items-center rounded border px-2 py-0.5 text-[10px] font-medium ${entry.cls}`}
    >
      {entry.label}
    </span>
  )
}

function TypeBadge({ type }: { type: string | null }) {
  if (!type) return <span className="text-xs text-muted-foreground">-</span>
  const map: Record<string, string> = {
    SATIS:
      "bg-sky-50 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300 border-sky-200 dark:bg-sky-500/15 dark:text-sky-200 dark:border-sky-500/40",
    TEVKIFAT:
      "bg-purple-50 text-purple-800 border-purple-200 dark:bg-purple-500/15 dark:text-purple-200 dark:border-purple-500/40",
    IADE:
      "bg-red-50 text-red-800 dark:bg-red-500/15 dark:text-red-300 border-red-200 dark:bg-red-500/15 dark:text-red-200 dark:border-red-500/40",
    ISTISNA:
      "bg-amber-50 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300 border-amber-200 dark:bg-amber-500/15 dark:text-amber-200 dark:border-amber-500/40",
    OZELMATRAH:
      "bg-cyan-50 text-cyan-800 border-cyan-200 dark:bg-cyan-500/15 dark:text-cyan-200 dark:border-cyan-500/40",
    IHRACAT:
      "bg-blue-50 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300 border-blue-200 dark:bg-blue-500/15 dark:text-blue-200 dark:border-blue-500/40",
  }
  const cls =
    map[type] ||
    "bg-slate-50 text-slate-700 dark:bg-slate-500/15 dark:text-slate-300 border-slate-200 dark:bg-slate-500/15 dark:text-slate-200 dark:border-slate-500/40"
  return (
    <span
      className={`inline-flex items-center rounded border px-2 py-0.5 text-[10px] font-medium ${cls}`}
    >
      {type}
    </span>
  )
}
