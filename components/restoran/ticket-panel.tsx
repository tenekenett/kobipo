"use client"

// Hesap paneli — adisyon ve kahveci satış ekranının ORTAK sağ sütunu.
// Kararlar: docs/restoran/SATIS-EKRANI.md (§4.1, K1, K8)
//
// Neden ortak: ikram/zayi, iskonto, seçenek ve hesap fişi yetenekleri iki
// ekranda da lazım. İki kopya olsaydı biri "ikram stoktan düşer" kuralını
// unuttuğu an iki ekran farklı davranırdı.
//
// Görünür kontrol BÜTÇESİ (İş 9 yöntemi): kalem satırında düğme YOKTUR; işlemler
// listenin altındaki tek blokta toplanır ve seçili kalem(ler)e uygulanır. Eskiden
// satırda dört kontrol (− sayı + çöp) duruyordu ve yeni yetenekler eklendikçe
// satır okunamaz hale gelmişti. Satırdaki tek kalıntı "⋮" ve o da yalnızca seyrek
// işleri (not, satır silme) taşıyor.
//
// Seçim ÇOKLUDUR: üç kalemi birden iptal/ikram etmek servisin sıradan işi ve tek
// tek yapıldığında sebep diyaloğu üç kez açılıyordu. Sebep bir kez sorulur,
// hepsine uygulanır.

import { useEffect, useState } from "react"
import { Check, MoreVertical, Receipt } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
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
import { QuantityStepper } from "@/components/ui/quantity-stepper"
import { currency } from "@/lib/fis/receipt-html"
import { qty } from "@/lib/format"
// Saf sabit modülü: tickets.ts prisma import ediyor, istemciye giremez.
import {
  TICKET_ITEM_REASONS,
  TICKET_REASON_NOTE_MAX,
  requiresReasonNote,
  type TicketItemStatus,
} from "@/lib/restoran/ticket-constants"
import type { RefEmployee } from "@/lib/swr/use-company-data"
import { cn } from "@/lib/utils"

export type PanelItem = {
  id: string
  description: string
  note?: string | null
  options?: Array<{ optionName: string }>
  quantity: number
  /** NET birim fiyat — panel brüte çevirip gösterir (ekranda daima KDV dahil). */
  unitPrice: number
  vatRate: number
  status?: TicketItemStatus
  reasonLabel?: string | null
}

export type PanelTotals = {
  /** İskonto öncesi, KDV dahil. */
  gross: number
  /** Uygulanan iskonto (KDV dahil). */
  discount: number
  total: number
}

const STATUS_BADGE: Record<Exclude<TicketItemStatus, "NORMAL">, { label: string; cls: string }> = {
  COMP: {
    label: "İKRAM",
    cls: "bg-kobipo-green/15 text-kobipo-green border-kobipo-green/40",
  },
  WASTE: {
    label: "ZAYİ",
    cls: "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-700",
  },
  VOID: {
    label: "İPTAL",
    cls: "bg-muted text-muted-foreground border-border",
  },
}

/**
 * Açıklama kutusunun ipucu — durum başına AYRI, çünkü zorunlu bir alanın
 * yanında "Kısa not" yazması kasiyeri sebep kodunu tekrar yazmaya itiyor
 * ("personel", "döküldü"). Soru sorulunca cevap ayrıntı oluyor.
 */
const NOTE_PLACEHOLDER: Record<Exclude<TicketItemStatus, "NORMAL">, string> = {
  COMP: "Kime / niçin ikram edildi?",
  WASTE: "Ne oldu, nasıl bozuldu?",
  VOID: "Niçin iptal edildi?",
}

export function TicketPanel({
  title = "Adisyon",
  items,
  totals,
  discountLabel,
  readOnly = false,
  allowStatus = true,
  allowDelete = false,
  emptyText = "Menüden ürün seçin",
  employees = [],
  footer,
  onQuantity,
  onSetStatus,
  onEditNote,
  className,
}: {
  title?: string
  items: PanelItem[]
  totals: PanelTotals
  /** "İskonto %10" gibi — iskonto satırının etiketi. */
  discountLabel?: string | null
  readOnly?: boolean
  /** İkram/zayi/iptal işaretleme (sebep sorulur). */
  allowStatus?: boolean
  /**
   * Satır tamamen silinebilir mi — ve adet 0'a inebilir mi.
   *
   * Kahveci sepetinde EVET: sepet yalnız tarayıcıda yaşar, henüz hiçbir şey
   * olmamıştır. Adisyonda HAYIR: kalem sunucuda kayıtlıdır ve silinmesi iz
   * bırakmaz — yanlış giren satır ⋮ menüsündeki "İptal" ile SEBEBİYLE
   * kaydedilir (docs/restoran/SATIS-EKRANI.md K2). Adet düşürücünün 0'a inmesi
   * bu kuralın sessiz kaçış yoluydu.
   */
  allowDelete?: boolean
  emptyText?: string
  /**
   * Aktif personel — İKRAM verilirken "kim verdi" bunlardan seçilir.
   *
   * BOŞ ise seçici hiç çizilmez ve zorunluluk düşer: `hr` modülünü kullanmayan
   * bir kafede ikramın tek alan yüzünden kilitlenmesi kabul edilemez. Aynı
   * koşullu zorunluluk iskontoda da var (SATIS-EKRANI.md K3.1).
   */
  employees?: RefEmployee[]
  footer?: React.ReactNode
  onQuantity: (id: string, quantity: number) => void
  /**
   * Promise döndürebilir: çoklu seçimde panel kalemleri SIRAYLA uygular ve her
   * birini bekler (adisyon ucu her yanıtta adisyonun tamamını döndürüyor).
   */
  onSetStatus?: (
    id: string,
    status: TicketItemStatus,
    reasonCode: string | null,
    reason: string | null,
    /** Yalnız COMP'ta dolu — ikramı veren personelin İK kartı. */
    employeeId?: string | null,
  ) => void | Promise<void>
  onEditNote?: (id: string) => void
  className?: string
}) {
  /** Sebep diyaloğu ÇOK kaleme birden uygulanabilir (`items`). */
  const [reasonFor, setReasonFor] = useState<{
    items: PanelItem[]
    status: Exclude<TicketItemStatus, "NORMAL">
    code: string
    note: string
    employeeId: string | null
  } | null>(null)
  /** Sıralı uygulama sürerken "Uygula" kilitli — çift gönderim adisyonu bozar. */
  const [applying, setApplying] = useState(false)

  // Personel YALNIZ ikramda sorulur. Zayi bir kayıp kaydıdır (döküldü/bozuldu),
  // iptal ise yanlış girişin izi — ikisinde de "kim verdi" diye bir muhatap yok.
  const needsEmployee = reasonFor?.status === "COMP" && employees.length > 0
  // Açıklama ÜÇ durumda da zorunlu (ticket-constants `requiresReasonNote`) —
  // koşulsuz: personelin aksine bunun için bir kart/modül gerekmiyor.
  const needsNote = requiresReasonNote(reasonFor?.status)
  const canApply =
    !!reasonFor?.code &&
    (!needsEmployee || !!reasonFor?.employeeId) &&
    (!needsNote || !!reasonFor?.note.trim())

  /**
   * Adet ve ikram/zayi/iptal ⋮ menüsünden ÇIKARILDI (2026-08-07): serviste sık
   * kullanılan işler iki dokunuş arkasında duruyordu — İşlemler tepsisinde
   * 2026-08-06'da verilen kararın kalem tarafındaki eşi (SATIS-EKRANI.md K1 notu).
   *
   * Seçim ÇOKLU: masadan üç kalem birden iptal etmek ya da ikram etmek servisin
   * sıradan işi ve tek tek yapıldığında sebep diyaloğu üç kez açılıyordu. Satıra
   * bir onay kutusu eklendi — satırın tamamı hâlâ tıklanabilir (dokunmatikte
   * hedef büyük kalsın), kutu yalnızca durumu görünür kılıyor.
   */
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const selectedItems = items.filter((i) => selectedIds.includes(i.id))
  /** Tek seçimde adet düzenlenebilir; çoklu seçimde adet kalem başınadır. */
  const single = selectedItems.length === 1 ? selectedItems[0] : null

  // Seçili kalem listeden düşerse (silindi, adisyon kapandı) seçim de düşmeli;
  // aksi halde blok olmayan bir kalemi göstermeye devam ederdi.
  useEffect(() => {
    setSelectedIds((prev) => {
      const next = prev.filter((id) => items.some((i) => i.id === id))
      return next.length === prev.length ? prev : next
    })
  }, [items])

  const toggleSelected = (id: string) =>
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))

  /** Seçimde durum değiştirilebilecek kalemler — zaten iptal/ikram olanlar hariç. */
  const normalSelected = selectedItems.filter((i) => (i.status ?? "NORMAL") === "NORMAL")
  const markedSelected = selectedItems.filter((i) => (i.status ?? "NORMAL") !== "NORMAL")

  /**
   * Sebep diyaloğunu seçili kalemler için açar. Sebep TEK kez sorulur ve hepsine
   * aynı sebeple uygulanır — zaten "üç kalem de yanlış girildi" gibi durumlar
   * için var; kalem kalem farklı sebep isteyen tek tek seçer.
   */
  const askReason = (status: Exclude<TicketItemStatus, "NORMAL">) => {
    if (normalSelected.length === 0) return
    setReasonFor({
      items: normalSelected,
      status,
      code: "",
      note: "",
      employeeId: status === "COMP" && employees.length === 1 ? employees[0].id : null,
    })
  }

  const billableCount = items
    .filter((i) => (i.status ?? "NORMAL") === "NORMAL")
    .reduce((s, i) => s + i.quantity, 0)

  const grossOf = (item: PanelItem) => item.unitPrice * (1 + item.vatRate / 100)

  return (
    <Card className={cn("xl:sticky xl:top-4", className)}>
      <CardContent className="space-y-3 p-3">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-sm font-semibold">
            <Receipt className="h-4 w-4 text-kobipo-blue dark:text-primary" />
            {title}
          </span>
          <span className="text-xs text-muted-foreground">{qty(billableCount)} adet</span>
        </div>

        {/* Toplu seçim kısayolu — birkaç kalemden fazlası olduğunda tek tek
            tıklamak yerine hepsini işaretleyip tek işlem yapılabilsin. */}
        {!readOnly && items.length > 1 && (
          <div className="flex items-center justify-end gap-3 text-xs">
            <button
              type="button"
              onClick={() => setSelectedIds(items.map((i) => i.id))}
              disabled={selectedIds.length === items.length}
              className="font-medium text-kobipo-blue hover:underline disabled:text-muted-foreground disabled:no-underline dark:text-primary"
            >
              Tümünü seç
            </button>
            {selectedIds.length > 0 && (
              <button
                type="button"
                onClick={() => setSelectedIds([])}
                className="font-medium text-muted-foreground hover:underline"
              >
                Seçimi bırak
              </button>
            )}
          </div>
        )}

        {items.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">{emptyText}</p>
        ) : (
          <div className="max-h-[52vh] space-y-1.5 overflow-y-auto pr-1">
            {items.map((item) => {
              const status = (item.status ?? "NORMAL") as TicketItemStatus
              const badge = status === "NORMAL" ? null : STATUS_BADGE[status]
              const lineTotal = item.quantity * grossOf(item)
              const optionText = (item.options ?? []).map((o) => o.optionName).join(" · ")
              const isSelected = selectedIds.includes(item.id)
              const select = () => toggleSelected(item.id)
              return (
                <div
                  key={item.id}
                  // Satır SEÇİLEBİLİR: adet ve durum düğmeleri artık panelde ve
                  // hangi kaleme uygulanacağını bu seçim söylüyor.
                  {...(readOnly
                    ? {}
                    : {
                        role: "button" as const,
                        tabIndex: 0,
                        onClick: select,
                        onKeyDown: (e: React.KeyboardEvent) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault()
                            select()
                          }
                        },
                      })}
                  className={cn(
                    "flex items-start gap-2 rounded-lg border p-2",
                    !readOnly && "cursor-pointer transition-colors hover:bg-muted/50",
                    isSelected &&
                      "border-kobipo-blue bg-kobipo-blue/5 dark:border-primary dark:bg-primary/10",
                    status === "VOID" && "opacity-50",
                    status === "WASTE" && "opacity-70",
                  )}
                >
                  {/* Seçim durumunu görünür kılan kutu. Tıklama hedefi satırın
                      tamamı — kutu küçük olduğu için dokunmatikte tek başına
                      hedef olamaz; burada yalnızca "seçilebilir ve seçili"
                      bilgisini taşıyor. */}
                  {!readOnly && (
                    <span
                      aria-hidden
                      className={cn(
                        "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
                        isSelected
                          ? "border-kobipo-blue bg-kobipo-blue text-white dark:border-primary dark:bg-primary dark:text-primary-foreground"
                          : "border-input",
                      )}
                    >
                      {isSelected && <Check className="h-3 w-3" strokeWidth={3} />}
                    </span>
                  )}

                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 text-sm font-medium">
                      <span className="tabular-nums text-muted-foreground">
                        {qty(item.quantity)} ×
                      </span>
                      <span className="truncate">{item.description}</span>
                      {badge && (
                        <span
                          className={cn(
                            "shrink-0 rounded border px-1 py-px text-[10px] font-bold",
                            badge.cls,
                          )}
                        >
                          {badge.label}
                        </span>
                      )}
                    </p>
                    {(optionText || item.note) && (
                      <p className="truncate text-xs text-muted-foreground">
                        {[optionText, item.note].filter(Boolean).join(" · ")}
                      </p>
                    )}
                    {item.reasonLabel && (
                      <p className="truncate text-xs text-muted-foreground">{item.reasonLabel}</p>
                    )}
                  </div>

                  <span
                    className={cn(
                      "shrink-0 text-sm font-semibold tabular-nums",
                      status !== "NORMAL" && "text-muted-foreground line-through",
                    )}
                  >
                    {currency(status === "COMP" ? 0 : lineTotal)}
                  </span>

                  {/* ⋮ artık yalnız SEYREK işleri taşıyor. Adet ve ikram/zayi/iptal
                      panele taşındı; ikisi de olmayan bir ekranda menü hiç çizilmez. */}
                  {!readOnly && (onEditNote || allowDelete) && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          aria-label="Kalem işlemleri"
                          // Menüyü açmak satırı SEÇMESİN: iki farklı niyet.
                          onClick={(e) => e.stopPropagation()}
                          className="-mr-1 shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted"
                        >
                          <MoreVertical className="h-4 w-4" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-56">
                        {onEditNote && (
                          <DropdownMenuItem onClick={() => onEditNote(item.id)}>
                            Not düzenle
                          </DropdownMenuItem>
                        )}
                        {allowDelete && (
                          <>
                            {onEditNote && <DropdownMenuSeparator />}
                            <DropdownMenuItem
                              className="text-red-600 dark:text-red-400"
                              onClick={() => onQuantity(item.id, 0)}
                            >
                              Satırı sil
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* SEÇİLİ KALEM işlemleri — eskiden ⋮ menüsünün içindeydi.
            Kalem listesinin hemen altında duruyor: hedefi (seçili satır) hemen
            üstünde olmayan bir düğme "neye uygulanıyor" sorusunu doğururdu. */}
        {!readOnly && items.length > 0 && (
          <div className="space-y-2 rounded-lg border border-dashed p-2">
            {selectedItems.length > 0 ? (
              <>
                <p className="truncate text-xs text-muted-foreground">
                  {single ? (
                    <>
                      Seçili:{" "}
                      <span className="font-medium text-foreground">{single.description}</span>
                    </>
                  ) : (
                    <span className="font-medium text-foreground">
                      {selectedItems.length} kalem seçili
                    </span>
                  )}
                </p>

                {/* Adet KALEM BAŞINA bir sayıdır; çoklu seçimde hepsini aynı
                    adede çekmek beklenmeyen bir toplu değişiklik olurdu. */}
                {single ? (
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">Adet</span>
                    <QuantityStepper
                      value={single.quantity}
                      onChange={(v) => onQuantity(single.id, v)}
                      min={allowDelete ? 0 : 1}
                    />
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Adet değiştirmek için tek kalem seçin.
                  </p>
                )}

                {allowStatus && onSetStatus && (
                  <div className="space-y-1.5">
                    {/* İki düğme grubu BİRLİKTE görünebilir: seçimde hem normal
                        hem işaretli kalemler varsa ikisi de anlamlı ve her biri
                        yalnız kendi payına uygulanır — sayı düğmede yazıyor. */}
                    {normalSelected.length > 0 && (
                      // Kısa etiketler: hangi işlemin ne demek olduğunu sebep
                      // diyaloğunun açıklaması zaten söylüyor.
                      <div className="grid grid-cols-3 gap-1.5">
                        <Button
                          variant="outline"
                          size="sm"
                          title="Hazırlanmadı — hesapta görünmez, stok etkilenmez"
                          onClick={() => askReason("VOID")}
                        >
                          İptal
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          title="Para alınmaz — hesapta 0,00 görünür, malzemesi stoktan düşer"
                          onClick={() => askReason("COMP")}
                        >
                          İkram
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          title="Döküldü / bozuldu — hesapta görünmez, malzemesi stoktan düşer"
                          onClick={() => askReason("WASTE")}
                        >
                          Zayi
                        </Button>
                      </div>
                    )}
                    {markedSelected.length > 0 && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full"
                        disabled={applying}
                        onClick={async () => {
                          setApplying(true)
                          try {
                            // SIRAYLA: adisyon ucu her yanıtta adisyonun tamamını
                            // döndürüp ekrana basıyor; paralel gönderimde geç
                            // dönen eski anlık görüntü yenisini eziyordu.
                            for (const item of markedSelected) {
                              await onSetStatus(item.id, "NORMAL", null, null)
                            }
                            setSelectedIds([])
                          } finally {
                            setApplying(false)
                          }
                        }}
                      >
                        Geri al (hesaba dön)
                        {markedSelected.length > 1 ? ` — ${markedSelected.length} kalem` : ""}
                      </Button>
                    )}
                  </div>
                )}

                {/* Sepette toplu silme: kahveci sepeti yalnız tarayıcıda yaşadığı
                    için iz kaybı yok (adisyonda `allowDelete` kapalı, orada iptal
                    sebebiyle kaydediliyor — SATIS-EKRANI.md K2). */}
                {allowDelete && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full text-destructive hover:text-destructive"
                    disabled={applying}
                    onClick={() => {
                      for (const item of selectedItems) onQuantity(item.id, 0)
                      setSelectedIds([])
                    }}
                  >
                    {selectedItems.length > 1
                      ? `Seçili ${selectedItems.length} satırı sil`
                      : "Satırı sil"}
                  </Button>
                )}
              </>
            ) : (
              <p className="py-1 text-center text-xs text-muted-foreground">
                Adet, ikram, zayi ve iptal için kalem seçin — birden fazla seçebilirsiniz
              </p>
            )}
          </div>
        )}

        {/* Toplam bloğu TEK satır: ara toplam/KDV dökümü kasiyerin kararını
            değiştirmiyordu, müşterinin sorduğu tek şey toplam. Döküm hesap
            fişinde ve fişte duruyor. */}
        <div className="space-y-1 border-t pt-2">
          {totals.discount > 0 && (
            <div className="flex justify-between text-sm text-kobipo-green">
              <span>{discountLabel || "İskonto"}</span>
              <span className="tabular-nums">−{currency(totals.discount)}</span>
            </div>
          )}
          <div className="flex justify-between text-lg font-bold">
            <span>TOPLAM</span>
            <span className="tabular-nums">{currency(totals.total)}</span>
          </div>
        </div>

        {footer}
      </CardContent>

      {/* Sebep KODU zorunlu: serbest metin olsaydı rapor gruplanamazdı. Serbest
          açıklama kodun yanında durur ve O DA zorunludur — kod işlemin türünü
          söyler, hikâyesini söylemez (K2.1). */}
      <Dialog open={!!reasonFor} onOpenChange={(open) => !open && setReasonFor(null)}>
        <DialogContent className="sm:max-w-md">
          {reasonFor && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {reasonFor.status === "COMP"
                    ? "İkram"
                    : reasonFor.status === "WASTE"
                      ? "Zayi"
                      : "Kalemi iptal et"}{" "}
                  —{" "}
                  {reasonFor.items.length === 1
                    ? reasonFor.items[0].description
                    : `${reasonFor.items.length} kalem`}
                </DialogTitle>
                <DialogDescription>
                  {reasonFor.status === "COMP"
                    ? "Hesapta 0,00 olarak görünür; malzemesi stoktan düşer."
                    : reasonFor.status === "WASTE"
                      ? "Hesapta görünmez; malzemesi stoktan düşer."
                      : "Hesapta görünmez; stok etkilenmez (ürün hazırlanmadı)."}
                  {reasonFor.items.length > 1 &&
                    " Seçilen kalemlerin hepsine aynı sebeple uygulanır."}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                {/* Çoklu uygulamada hangi kalemlerin etkileneceği açıkça yazılır:
                    "3 kalem" başlığı tek başına hangi üçü olduğunu söylemiyor. */}
                {reasonFor.items.length > 1 && (
                  <ul className="max-h-24 space-y-0.5 overflow-y-auto rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
                    {reasonFor.items.map((i) => (
                      <li key={i.id} className="truncate">
                        {qty(i.quantity)} × {i.description}
                      </li>
                    ))}
                  </ul>
                )}
                <div className="grid gap-1.5">
                  {TICKET_ITEM_REASONS[reasonFor.status].map((r) => (
                    <button
                      key={r.code}
                      type="button"
                      onClick={() => setReasonFor({ ...reasonFor, code: r.code })}
                      className={cn(
                        "rounded-lg border p-2.5 text-left text-sm font-medium transition-colors",
                        reasonFor.code === r.code
                          ? "border-kobipo-blue bg-kobipo-blue/10 text-kobipo-blue dark:border-primary dark:bg-primary/15 dark:text-primary"
                          : "hover:bg-muted",
                      )}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
                {needsEmployee && (
                  <div>
                    <Label className="text-xs text-muted-foreground">İkramı veren personel</Label>
                    <Select
                      value={reasonFor.employeeId ?? ""}
                      onValueChange={(v) => setReasonFor({ ...reasonFor, employeeId: v || null })}
                    >
                      <SelectTrigger className="mt-1.5">
                        <SelectValue placeholder="Personel seçin" />
                      </SelectTrigger>
                      <SelectContent>
                        {employees.map((e) => (
                          <SelectItem key={e.id} value={e.id}>
                            {e.name}
                            {e.position ? ` · ${e.position}` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div>
                  <Label className="text-xs text-muted-foreground">Açıklama (zorunlu)</Label>
                  <Input
                    value={reasonFor.note}
                    onChange={(e) => setReasonFor({ ...reasonFor, note: e.target.value })}
                    // Soru duruma göre değişiyor: "Kısa not" denince kasiyer sebep
                    // kodunu tekrar yazıyor ("personel"), oysa istenen ayrıntı.
                    placeholder={NOTE_PLACEHOLDER[reasonFor.status]}
                    maxLength={TICKET_REASON_NOTE_MAX}
                    className="mt-1.5"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setReasonFor(null)}>
                  Vazgeç
                </Button>
                <Button
                  disabled={!canApply || applying}
                  onClick={async () => {
                    setApplying(true)
                    try {
                      // SIRAYLA — paralel gönderimde adisyon ucunun her yanıtta
                      // döndürdüğü tam anlık görüntüler birbirini eziyor.
                      for (const item of reasonFor.items) {
                        await onSetStatus?.(
                          item.id,
                          reasonFor.status,
                          reasonFor.code,
                          reasonFor.note.trim() || null,
                          reasonFor.status === "COMP" ? reasonFor.employeeId : null,
                        )
                      }
                      setReasonFor(null)
                      setSelectedIds([])
                    } finally {
                      setApplying(false)
                    }
                  }}
                >
                  {applying ? "Uygulanıyor…" : "Uygula"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  )
}
