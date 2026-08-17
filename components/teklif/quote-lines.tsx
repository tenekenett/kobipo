"use client"

import { useState } from "react"
import { Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ProductCombobox } from "@/components/ui/product-combobox"
import { useToast } from "@/components/ui/use-toast"
import { quickCreateProduct } from "@/lib/stock/quick-create-product"

/**
 * Teklif kalem ızgarası — SATIŞ ve SATIN ALMA teklifleri bunu paylaşır.
 *
 * Neden ortak: iki ekran aynı tabloyu ayrı ayrı yazıyordu ve ayrışmıştı. Satın
 * alma tarafında etiketler input'ların ÜSTÜNDEYDİ; "Birim fiyat" iki satıra
 * sarılınca o hücre aşağı kayıyor, satır hizası bozuluyordu. Burada masaüstünde
 * TEK bir başlık satırı var ve satırlar onunla aynı grid şablonunu kullanıyor —
 * etiket sarması hizayı bozamaz. Mobilde başlık gizlenir, her hücre kendi küçük
 * etiketini taşır.
 */

export type QuoteLine = {
  productId: string
  description: string
  /** Satır açıklaması — ürün adının altına basılır (PDF dahil), opsiyonel. */
  note: string
  quantity: string
  unitPrice: string
  vatRate: string
  discountRate: string
  /**
   * Referans fiyat (salt okunur): satışta ürünün ortalama ALIŞ maliyeti, satın
   * almada ürün kartındaki kayıtlı alış fiyatı. Kâr/sapma kontrolü için.
   */
  refPrice: string
}

export const emptyQuoteLine = (): QuoteLine => ({
  productId: "",
  description: "",
  note: "",
  quantity: "1",
  unitPrice: "0",
  vatRate: "20",
  discountRate: "0",
  refPrice: "",
})

export type QuoteProduct = {
  id: string
  name: string
  salePrice?: number | null
  purchasePrice?: number | null
  avgPurchasePrice?: number | null
  currency?: string | null
  vatRate?: number | null
}

// Kalem grid kolon şablonu — başlık satırı ile input satırları aynı hizada olsun
// diye TEK yerden yönetilir. (Ürün | Miktar | B.Fiyat | İsk% | KDV% | Ref | Tutar | Sil)
const GRID_COLS = "md:grid-cols-[minmax(0,1fr)_60px_104px_58px_58px_90px_112px_32px]"

// Para (2 ondalık) ve birim fiyat (6 ondalık — e-Fatura hassasiyeti) yuvarlaması.
export const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100
export const round6 = (n: number) => Math.round((Number(n) || 0) * 1_000_000) / 1_000_000

/** Bir kalemin brüt/iskonto/net/kdv/toplam değerleri. */
export function calcQuoteLine(row: QuoteLine) {
  const qty = Number(row.quantity) || 0
  const price = Number(row.unitPrice) || 0
  const disc = Number(row.discountRate) || 0
  const vat = Number(row.vatRate) || 0
  const gross = qty * price
  const discount = gross * (disc / 100)
  const net = gross - discount
  const vatAmount = net * (vat / 100)
  return { gross, discount, net, vatAmount, total: net + vatAmount }
}

/** Tüm satırların toplamı (modal altındaki özet). */
export function calcQuoteTotals(lines: QuoteLine[]) {
  return lines.reduce(
    (acc, row) => {
      const c = calcQuoteLine(row)
      acc.gross += c.gross
      acc.discount += c.discount
      acc.vat += c.vatAmount
      acc.total += c.total
      return acc
    },
    { gross: 0, discount: 0, vat: 0, total: 0 },
  )
}

export const currencySymbol = (cur: string): string =>
  ({ TRY: "₺", USD: "$", EUR: "€" } as Record<string, string>)[cur] || cur

const fmt = (n: number) =>
  n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Grid içinde etiketli sayı girişi (etiket yalnızca mobilde; masaüstünde başlık satırı var). */
function GridNumber({
  label,
  value,
  onChange,
  prefix,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  prefix?: string
}) {
  return (
    <div>
      <span className="mb-1 block text-[11px] text-muted-foreground md:hidden">{label}</span>
      <div className="relative">
        {prefix && (
          <span className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
            {prefix}
          </span>
        )}
        <Input
          type="number"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`h-9 text-right [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none ${prefix ? "pl-5" : ""}`}
        />
      </div>
    </div>
  )
}

export function QuoteLinesEditor({
  lines,
  onChange,
  products,
  onProductsChange,
  companyId,
  currency,
  /** "sale" → ürünün satış fiyatı doldurulur, referans sütunu maliyettir.
   *  "purchase" → alış fiyatı doldurulur, referans sütunu kayıtlı alış fiyatıdır. */
  priceMode,
  /** Ürün başka para biriminde ise fiyatı belge para birimine çevirir; yoksa null. */
  convert,
}: {
  lines: QuoteLine[]
  onChange: (lines: QuoteLine[]) => void
  products: QuoteProduct[]
  onProductsChange: (updater: (prev: QuoteProduct[]) => QuoteProduct[]) => void
  companyId: string
  currency: string
  priceMode: "sale" | "purchase"
  convert?: (value: number, from: string, to: string) => number | null
}) {
  const { toast } = useToast()
  // Tutar hücresi düzenlenirken kullanıcının ham girdisini tutar (recompute ile
  // çakışmasın diye). Odak varken input bu değeri gösterir; birim fiyat arka
  // planda tutar/miktar olarak güncellenir.
  const [amountEdit, setAmountEdit] = useState<{ index: number; value: string } | null>(null)

  const curSym = currencySymbol(currency)
  const refLabel = priceMode === "sale" ? "Maliyet" : "Kayıtlı Alış"
  const refTitle =
    priceMode === "sale"
      ? "Birim maliyet (ortalama alış)"
      : "Ürün kartındaki kayıtlı alış fiyatı"

  const updateLine = (index: number, patch: Partial<QuoteLine>) => {
    onChange(lines.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }

  const applyProductToLine = (index: number, productId: string) => {
    const p = products.find((x) => x.id === productId)
    const prodCur = (p?.currency || "TRY").toUpperCase()
    const docCur = (currency || "TRY").toUpperCase()

    const basePrice = priceMode === "sale" ? p?.salePrice : p?.purchasePrice
    const baseRef = priceMode === "sale" ? p?.avgPurchasePrice : p?.purchasePrice

    let unitPrice = basePrice != null ? Number(basePrice) : Number(lines[index]?.unitPrice || 0)
    let ref = baseRef != null ? Number(baseRef) : null

    // Ürün para birimi belge para biriminden farklıysa fiyatı VE referansı çevir.
    if (convert && prodCur !== docCur && (basePrice != null || ref != null)) {
      const cp = convert(unitPrice, prodCur, docCur)
      if (cp != null) {
        if (basePrice != null) {
          toast({
            title: "Döviz çevrildi",
            description: `${Number(basePrice).toLocaleString("tr-TR")} ${prodCur} → ${round6(cp).toLocaleString("tr-TR")} ${docCur}`,
          })
        }
        unitPrice = round6(cp)
        if (ref != null) {
          const cr = convert(ref, prodCur, docCur)
          if (cr != null) ref = round6(cr)
        }
      } else {
        toast({
          title: "Kur bulunamadı",
          description: `${prodCur} güncel kuru alınamadı; fiyat çevrilmeden eklendi.`,
          variant: "destructive",
        })
      }
    }

    updateLine(index, {
      productId,
      description: p?.name || "",
      unitPrice: String(unitPrice),
      refPrice: ref != null ? String(round6(ref)) : "",
      ...(p?.vatRate != null ? { vatRate: String(Number(p.vatRate)) } : {}),
    })
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <Label>Kalemler</Label>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => onChange([...lines, emptyQuoteLine()])}
        >
          <Plus className="mr-1 h-3 w-3" />
          Satır
        </Button>
      </div>

      <div className="rounded-md border p-3">
        {/* Başlık satırı (masaüstü) — satırlarla aynı grid şablonu */}
        <div
          className={`hidden gap-2 px-1 pb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground md:grid ${GRID_COLS}`}
        >
          <div>Ürün / Açıklama</div>
          <div className="text-right">Miktar</div>
          <div className="text-right">Birim Fiyat</div>
          <div className="text-right">İsk %</div>
          <div className="text-right">KDV %</div>
          <div className="text-right">{refLabel}</div>
          <div className="text-right">Tutar</div>
          <div />
        </div>

        <div className="space-y-3 md:space-y-2">
          {lines.map((row, index) => {
            const c = calcQuoteLine(row)
            return (
              <div
                key={index}
                className={`grid grid-cols-2 items-start gap-2 rounded-md border p-2 md:rounded-none md:border-0 md:border-b md:p-0 md:pb-2 md:last:border-0 ${GRID_COLS}`}
              >
                <div className="col-span-2 space-y-1 md:col-span-1">
                  <span className="mb-1 block text-[11px] text-muted-foreground md:hidden">
                    Ürün / Açıklama
                  </span>
                  <ProductCombobox
                    products={products}
                    value={row.description}
                    onTextChange={(text) => updateLine(index, { description: text, productId: "" })}
                    onSelectProduct={(p) => applyProductToLine(index, p.id)}
                    onCreateProduct={async (name) => {
                      if (!companyId) return false
                      try {
                        const created = await quickCreateProduct({
                          companyId,
                          name,
                          ...(priceMode === "sale"
                            ? { salePrice: row.unitPrice }
                            : { purchasePrice: row.unitPrice }),
                          vatRate: row.vatRate,
                        })
                        onProductsChange((prev) => [...prev, created])
                        const createdPrice =
                          priceMode === "sale" ? created.salePrice : created.purchasePrice
                        updateLine(index, {
                          productId: created.id,
                          description: created.name,
                          unitPrice: createdPrice != null ? String(createdPrice) : row.unitPrice,
                          refPrice: "",
                        })
                        return true
                      } catch (e) {
                        toast({
                          title: "Hata",
                          description: e instanceof Error ? e.message : "Ürün eklenemedi",
                          variant: "destructive",
                        })
                        return false
                      }
                    }}
                  />
                  {/* Satır açıklaması — ürün adını kirletmeden teklif/PDF'te
                      kalemin altına basılan serbest metin. */}
                  <Input
                    value={row.note}
                    onChange={(e) => updateLine(index, { note: e.target.value })}
                    placeholder="Satır açıklaması (opsiyonel)"
                    className="h-8 text-xs"
                  />
                </div>

                <GridNumber
                  label="Miktar"
                  value={row.quantity}
                  onChange={(v) => updateLine(index, { quantity: v })}
                />
                <GridNumber
                  label="Birim Fiyat"
                  value={row.unitPrice}
                  onChange={(v) => updateLine(index, { unitPrice: v })}
                  prefix={curSym}
                />
                <GridNumber
                  label="İsk %"
                  value={row.discountRate}
                  onChange={(v) => updateLine(index, { discountRate: v })}
                />
                <GridNumber
                  label="KDV %"
                  value={row.vatRate}
                  onChange={(v) => updateLine(index, { vatRate: v })}
                />

                <div>
                  <span className="mb-1 block text-[11px] text-muted-foreground md:hidden">
                    {refLabel}
                  </span>
                  <div
                    className="flex h-9 items-center justify-end px-1 text-xs text-muted-foreground tabular-nums"
                    title={refTitle}
                  >
                    {row.refPrice && row.refPrice.trim() !== ""
                      ? `${curSym} ${fmt(Number(row.refPrice))}`
                      : "—"}
                  </div>
                </div>

                <div>
                  <span className="mb-1 block text-[11px] text-muted-foreground md:hidden">
                    Tutar
                  </span>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                      {curSym}
                    </span>
                    <Input
                      type="number"
                      className="h-9 pl-5 text-right font-medium [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                      value={amountEdit?.index === index ? amountEdit.value : String(round2(c.gross))}
                      onFocus={() => setAmountEdit({ index, value: String(round2(c.gross)) })}
                      onChange={(e) => {
                        const v = e.target.value
                        setAmountEdit({ index, value: v })
                        const qty = Number(row.quantity) || 0
                        if (qty > 0 && v.trim() !== "") {
                          const up = Number(v) / qty
                          if (Number.isFinite(up)) updateLine(index, { unitPrice: String(round6(up)) })
                        }
                      }}
                      onBlur={() => setAmountEdit(null)}
                      title="Satır tutarı — düzenlenince birim fiyat (tutar ÷ miktar) otomatik hesaplanır"
                    />
                  </div>
                </div>

                <div className="col-span-2 flex justify-end md:col-span-1 md:justify-center">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 text-muted-foreground hover:text-destructive"
                    disabled={lines.length <= 1}
                    onClick={() => onChange(lines.filter((_, i) => i !== index))}
                    title="Satırı sil"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/** Modal altındaki toplam özeti (iki ekranda da aynı). */
export function QuoteTotalsSummary({
  lines,
  currency,
}: {
  lines: QuoteLine[]
  currency: string
}) {
  const totals = calcQuoteTotals(lines)
  return (
    <div className="mt-3 flex justify-end">
      <div className="w-full max-w-xs space-y-1 rounded-lg bg-muted/50 p-3 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Ara Toplam</span>
          <span className="tabular-nums">
            {fmt(totals.gross)} {currency}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">İskonto</span>
          <span className="tabular-nums">
            {totals.discount > 0 ? "-" : ""}
            {fmt(totals.discount)} {currency}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">KDV</span>
          <span className="tabular-nums">
            {fmt(totals.vat)} {currency}
          </span>
        </div>
        <div className="mt-1 flex justify-between border-t pt-2 text-base font-semibold">
          <span>Genel Toplam</span>
          <span className="tabular-nums">
            {fmt(totals.total)} {currency}
          </span>
        </div>
      </div>
    </div>
  )
}
