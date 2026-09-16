"use client"

// İstemci tarafı tablo sayfalaması.
//
// Liste ekranlarının çoğu süzgeci istemcide uyguluyor ve SONUCUN TAMAMINI
// tabloya basıyordu: 750 ürünlü firmada 750 satır (her biri rozet, menü,
// bağlantı) tek seferde DOM'a giriyor ve her süzgeç tuşunda yeniden
// çiziliyordu. Bu hook süzgeçlenmiş diziyi sayfaya böler; süzgeç mantığına
// DOKUNMAZ — arama/sekme/kategori hepsi eskisi gibi tüm kayıt üzerinde çalışır,
// yalnız çizilen dilim değişir.
//
// `resetKey`: süzgeç durumunun özeti (ör. `${search}|${status}`). Değişince
// 1. sayfaya dönülür; aksi halde "arama yaptım, 7. sayfada boş tablo" olurdu.
// Veri yeniden çekildiğinde (kayıt düzenlendi) sayfa KORUNUR, yalnız sınır
// dışına taşarsa son sayfaya çekilir.

import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"

export const DEFAULT_PAGE_SIZE = 50

export function usePagedRows<T>(
  rows: readonly T[],
  opts?: { pageSize?: number; resetKey?: string },
) {
  const pageSize = opts?.pageSize ?? DEFAULT_PAGE_SIZE
  const resetKey = opts?.resetKey ?? ""
  const [page, setPage] = useState(1)

  useEffect(() => {
    setPage(1)
  }, [resetKey])

  const total = rows.length
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const safePage = Math.min(Math.max(1, page), pageCount)
  const pageRows = useMemo(
    () => rows.slice((safePage - 1) * pageSize, safePage * pageSize),
    [rows, safePage, pageSize],
  )

  return {
    page: safePage,
    setPage,
    pageCount,
    pageSize,
    total,
    pageRows,
    /** Görünen ilk/son kayıt sırası (1 tabanlı); boş listede 0. */
    from: total === 0 ? 0 : (safePage - 1) * pageSize + 1,
    to: Math.min(total, safePage * pageSize),
  }
}

type TablePaginationProps = Pick<
  ReturnType<typeof usePagedRows>,
  "page" | "setPage" | "pageCount" | "total" | "from" | "to"
> & {
  /** Tek sayfaya sığıyorsa kontrol hiç çizilmez (varsayılan). */
  hideWhenSingle?: boolean
  className?: string
}

export function TablePagination({
  page,
  setPage,
  pageCount,
  total,
  from,
  to,
  hideWhenSingle = true,
  className,
}: TablePaginationProps) {
  if (hideWhenSingle && pageCount <= 1) return null
  return (
    <div className={`mt-4 flex items-center justify-between gap-4 text-sm ${className ?? ""}`}>
      <span className="text-muted-foreground">
        {total === 0 ? "0 kayıt" : `${from}–${to} / ${total} kayıt`} · Sayfa {page}/{pageCount}
      </span>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
          Önceki
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= pageCount}
          onClick={() => setPage(page + 1)}
        >
          Sonraki
        </Button>
      </div>
    </div>
  )
}
