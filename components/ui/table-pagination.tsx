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
import { pageLinks } from "@/lib/ui/page-links"

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

const fmt = (n: number) => n.toLocaleString("tr-TR")

// Çubuk: bilgi satırı + tek sırada Önceki · sayfa numaraları · Sonraki.
// Hangi numaraların çizileceği `lib/ui/page-links.ts`te (saf kural, testli):
// yalnız Önceki/Sonraki ile 15. sayfaya ulaşmak 14 tıklama istiyordu.
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
  const links = pageLinks(page, pageCount)
  return (
    <div className={`mt-4 flex flex-col items-center gap-3 text-sm ${className ?? ""}`}>
      <span className="text-center text-muted-foreground">
        Toplam {fmt(pageCount)} sayfa içerisinde {fmt(page)}. sayfayı görmektesiniz.{" "}
        <span className="whitespace-nowrap">
          ({total === 0 ? "0 kayıt" : `${fmt(from)}–${fmt(to)} / ${fmt(total)} kayıt`})
        </span>
      </span>
      <div className="flex flex-wrap items-center justify-center gap-1.5">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
          Önceki
        </Button>
        {links.map((n) => (
          <Button
            key={n}
            variant={n === page ? "default" : "outline"}
            size="sm"
            aria-current={n === page ? "page" : undefined}
            className="min-w-9 px-2"
            onClick={() => setPage(n)}
          >
            {fmt(n)}
          </Button>
        ))}
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
