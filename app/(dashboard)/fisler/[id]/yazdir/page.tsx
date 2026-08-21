"use client"

import { useCallback, useEffect, useState } from "react"
import { useParams, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { currency } from "@/lib/fis/receipt-html"
import { DEFAULT_RECEIPT_TEMPLATE, type ReceiptTemplate } from "@/lib/fis/receipt-template"
import { Loader2, Printer } from "lucide-react"
import { ExportOnlyScreen } from "@/components/dashboard/write-guard"

type FisDetail = {
  receiptNo: string
  direction: "outgoing" | "incoming"
  status: string
  date: string
  companyName: string
  receiptTemplate: ReceiptTemplate
  companyInfo: {
    address?: string | null
    phone?: string | null
    taxOffice?: string | null
    taxNumber?: string | null
  }
  counterpartyName: string | null
  netAmount: number
  vatAmount: number
  totalAmount: number
  paidAmount: number
  notes: string | null
  items: {
    id: string
    description: string
    quantity: number
    unit: string
    unitPrice: number
    vatRate: number
    totalAmount: number
  }[]
  payments: { id: string; paymentMethodLabel: string; amount: number }[]
}

const qtyFmt = (n: number) => n.toLocaleString("tr-TR", { maximumFractionDigits: 3 })

/**
 * Fişin A4 dökümü (yazdırılabilir). Fatura önizlemesi (/faturalar/:id/onizleme)
 * bu iş için kullanılamaz: orası GİB'e gönder / kesinleştir / resmî PDF akışına
 * bağlı fatura ekranıdır. Fiş resmî belge değildir — başlıkta "FİŞ" yazar ve
 * belgede vergi/GİB alanı bulunmaz.
 */
export default function FisYazdirPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const fisId = params.id as string
  const companyId = searchParams.get("company")

  const [fis, setFis] = useState<FisDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!companyId) {
      setError("Firma seçili değil.")
      setLoading(false)
      return
    }
    try {
      const res = await fetch(
        `/api/fisler/${encodeURIComponent(fisId)}?companyId=${encodeURIComponent(companyId)}`,
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || "Fiş yüklenemedi")
      setFis(data)
    } catch (e: any) {
      setError(e?.message || "Fiş yüklenemedi")
    } finally {
      setLoading(false)
    }
  }, [companyId, fisId])

  useEffect(() => {
    load()
  }, [load])

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12 text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Yükleniyor...
      </div>
    )
  }

  if (error || !fis) {
    return <div className="p-8 text-center text-muted-foreground">{error || "Fiş bulunamadı."}</div>
  }

  const isSales = fis.direction === "outgoing"
  const docTitle = isSales ? "SATIŞ FİŞİ" : "ALIŞ FİŞİ"
  const cariLabel = isSales ? "Müşteri" : "Tedarikçi"
  const cariName = fis.counterpartyName ?? (isSales ? "Perakende" : "Serbest")
  const kalan = fis.totalAmount - fis.paidAmount
  // A4 dökümü de fiş tasarımına uyar (termal fişle tutarlı olsun); yalnız kağıt
  // genişliği burada geçersizdir — bu belge A4'tür.
  const tpl = fis.receiptTemplate ?? DEFAULT_RECEIPT_TEMPLATE
  const headerTitle = tpl.headerText || fis.companyName

  return (
    <ExportOnlyScreen>
    <div className="mx-auto max-w-[210mm] p-4 print:p-0">
      <div className="mb-4 flex justify-end gap-2 print:hidden">
        <Button size="sm" onClick={() => window.print()}>
          <Printer className="mr-2 h-4 w-4" />
          Yazdır
        </Button>
      </div>

      <div className="rounded-lg border bg-white p-8 text-black shadow-sm print:rounded-none print:border-0 print:p-0 print:shadow-none">
        <div className="flex items-start justify-between border-b pb-4">
          <div>
            {tpl.logoDataUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={tpl.logoDataUrl} alt="" className="mb-2 h-12 w-auto max-w-[160px] object-contain" />
            )}
            <h1 className="text-lg font-bold">{headerTitle}</h1>
            {tpl.showAddress && fis.companyInfo?.address && (
              <p className="mt-1 max-w-[80mm] text-xs text-gray-700">{fis.companyInfo.address}</p>
            )}
            {tpl.showContact && (
              <p className="text-xs text-gray-700">
                {[
                  [fis.companyInfo?.taxOffice, fis.companyInfo?.taxNumber].filter(Boolean).join(" V.D. "),
                  fis.companyInfo?.phone ? `Tel: ${fis.companyInfo.phone}` : "",
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            )}
            <p className="mt-1 text-xs text-gray-600">
              Bu belge resmî fatura değildir; ön muhasebe fişidir.
            </p>
          </div>
          <div className="text-right">
            <p className="text-xl font-bold tracking-wide">{docTitle}</p>
            <p className="mt-1 font-mono text-sm">{fis.receiptNo}</p>
            {fis.status === "CANCELLED" && (
              <p className="mt-1 text-sm font-bold text-red-600">İPTAL EDİLDİ</p>
            )}
            {fis.status === "CONVERTED" && (
              <p className="mt-1 text-xs text-gray-600">Faturaya dönüştürüldü</p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 border-b py-4 text-sm">
          {tpl.showCounterparty ? (
            <div>
              <p className="text-gray-600">{cariLabel}</p>
              <p className="font-semibold">{cariName}</p>
            </div>
          ) : (
            <div />
          )}
          <div className="text-right">
            <p className="text-gray-600">Tarih</p>
            <p className="font-semibold">
              {new Date(fis.date).toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short" })}
            </p>
          </div>
        </div>

        <table className="mt-4 w-full text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="py-2">Açıklama</th>
              <th className="py-2 text-right">Miktar</th>
              <th className="py-2 text-right">Birim Fiyat</th>
              <th className="py-2 text-center">KDV</th>
              <th className="py-2 text-right">Tutar</th>
            </tr>
          </thead>
          <tbody>
            {fis.items.map((it) => (
              <tr key={it.id} className="border-b">
                <td className="py-2">{it.description}</td>
                <td className="py-2 text-right tabular-nums">
                  {qtyFmt(it.quantity)} {it.unit}
                </td>
                <td className="py-2 text-right tabular-nums">{currency(it.unitPrice)}</td>
                <td className="py-2 text-center tabular-nums">%{it.vatRate}</td>
                <td className="py-2 text-right tabular-nums">{currency(it.totalAmount)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-4 flex justify-end">
          <div className="w-64 space-y-1 text-sm">
            {tpl.showVat && (
              <>
                <div className="flex justify-between">
                  <span className="text-gray-600">Ara Toplam</span>
                  <span className="tabular-nums">{currency(fis.netAmount)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">KDV</span>
                  <span className="tabular-nums">{currency(fis.vatAmount)}</span>
                </div>
              </>
            )}
            <div className="flex justify-between border-t pt-1 text-base font-bold">
              <span>TOPLAM</span>
              <span className="tabular-nums">{currency(fis.totalAmount)}</span>
            </div>
            {fis.payments.length > 0 && (
              <>
                <div className="border-t pt-1" />
                {fis.payments.map((p) => (
                  <div key={p.id} className="flex justify-between text-gray-700">
                    <span>{p.paymentMethodLabel}</span>
                    <span className="tabular-nums">{currency(p.amount)}</span>
                  </div>
                ))}
              </>
            )}
            {kalan > 0.005 ? (
              <div className="flex justify-between font-semibold">
                <span>Kalan</span>
                <span className="tabular-nums">{currency(kalan)}</span>
              </div>
            ) : (
              fis.payments.length === 0 && (
                <div className="flex justify-between text-gray-700">
                  <span>Ödeme</span>
                  <span>{isSales ? "Veresiye / Açık Hesap" : "Açık Hesap"}</span>
                </div>
              )
            )}
          </div>
        </div>

        {tpl.showNotes && fis.notes && (
          <div className="mt-6 border-t pt-3 text-sm">
            <p className="text-gray-600">Not</p>
            <p>{fis.notes}</p>
          </div>
        )}

        {tpl.footerText && (
          <div className="mt-6 border-t pt-3 text-center text-sm text-gray-700">{tpl.footerText}</div>
        )}

        <div className="mt-8 flex justify-between text-xs text-gray-500">
          <span>{headerTitle}</span>
          <span>{fis.receiptNo}</span>
        </div>
      </div>
    </div>
    </ExportOnlyScreen>
  )
}
