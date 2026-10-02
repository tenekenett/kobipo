"use client"

import { Fragment, useEffect, useMemo, useRef, useState, type ComponentType } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Banknote, FileText, Loader2, Package, ScrollText, Search, UserRound, Users } from "lucide-react"
import { allNavItems, moduleKeyForPath, navGroups } from "@/components/dashboard/nav-config"
import { denemeSayfasiAcikMi, hiddenByShiftMode } from "@/lib/nav/pages"
import { useDashboardCompany, useVisiblePages } from "@/components/dashboard/dashboard-company-provider"
import { MODULE_KEYS } from "@/lib/modules"
import { trFold } from "@/lib/text/tr-fold"
import { withCompanyHref } from "@/lib/company/href"
import { aramaTerimi, type AramaGrubu, type KayitTuru } from "@/lib/arama/kayit-arama-kural"

// href -> menü grubu başlığı (sonuçlarda grup etiketi + grup adıyla arama için).
const GROUP_BY_HREF: Record<string, string> = (() => {
  const map: Record<string, string> = {}
  for (const g of navGroups) for (const href of g.hrefs) map[href] = g.title
  return map
})()

const KAYIT_IKONU: Record<KayitTuru, ComponentType<{ className?: string }>> = {
  cari: Users,
  belge: FileText,
  urun: Package,
  teklif: ScrollText,
  "cek-senet": Banknote,
  personel: UserRound,
}

/** Yazmayı bitirmeyi bekleme süresi — her tuşta sunucuya gidilmesin. */
const BEKLEME_MS = 250

/** Listede tek satır: menü sayfası ya da kayıt. Klavye gezintisi bu düz liste üzerindedir. */
type Satir = {
  key: string
  baslik: string
  alt?: string
  rozet?: string
  /** Sayfalarda menü grubu, kayıtlarda yok. */
  grup?: string
  Icon: ComponentType<{ className?: string }>
  git: () => void
}

/**
 * Üst çubuktaki arama: menü SAYFALARI ve KAYITLAR (cari, belge no, ürün, teklif,
 * çek/senet, personel).
 *
 * Sayfa listesi kenar çubuğuyla AYNI kaynaktan (useVisiblePages) gelir; ayrı
 * hesaplayan bir arama kutusu, menüde gizlenmiş sayfaya giden bir link bırakırdı.
 * Kayıtlar sunucudan (`/api/arama`) gelir ve yalnız kullanıcının AÇABİLDİĞİ
 * kayıtlardır — süzme orada yapılır (lib/arama/kayit-arama-kural.ts).
 *
 * `userRole` yalnızca geriye dönük uyumluluk için duruyor.
 */
export function MenuSearch({ userRole: _userRole }: { userRole: string }) {
  const router = useRouter()
  const visibleHrefs = useVisiblePages()
  const { selectedCompany } = useDashboardCompany()
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [highlighted, setHighlighted] = useState(0)
  const [kayitlar, setKayitlar] = useState<AramaGrubu[]>([])
  const [araniyor, setAraniyor] = useState(false)
  const [kayitHatasi, setKayitHatasi] = useState(false)

  const companyId = selectedCompany?.id ?? null
  // Link param'ı CompanyLink ile aynı: slug varsa o, yoksa id.
  const companyParam = selectedCompany?.slug ?? selectedCompany?.id ?? null

  const results = useMemo(() => {
    // Kullanıcının erişebildiği TÜM menü öğeleri: izin (rol ∩ kısıt listesi) VE modül.
    // Modül filtresi eskiden burada yoktu — kapalı modülün sayfası kenar çubuğunda
    // gizliyken arama kutusunda çıkıyordu.
    const visible = new Set(visibleHrefs)
    const disabled = new Set(selectedCompany ? selectedCompany.disabledModules ?? [] : MODULE_KEYS)
    const items = allNavItems.filter((i) => {
      if (!visible.has(i.href)) return false
      // Kenar çubuğunda gizli olan deneme sayfası aramada da çıkmasın.
      if (!denemeSayfasiAcikMi(i.href, selectedCompany)) return false
      // Çalışma düzeni dışında kalan takvim kenar çubuğunda gizli; aramada çıkarsa
      // kullanıcı menüde bulamadığı bir ekrana buradan girer.
      if (hiddenByShiftMode(i.href, selectedCompany?.workScheduleMode ?? null)) return false
      const moduleKey = i.module ?? moduleKeyForPath(i.href)
      return !(moduleKey && disabled.has(moduleKey))
    })
    const q = trFold(query)
    if (!q) return items
    // Etikete VEYA ait olduğu grup başlığına göre eşleşir (ör. "finans" → tüm grup).
    return items.filter(
      (i) => trFold(i.label).includes(q) || trFold(GROUP_BY_HREF[i.href]).includes(q)
    )
  }, [query, visibleHrefs, selectedCompany])

  // KAYIT araması: terim yeterince uzunsa, yazma durunca; eski istek iptal edilir
  // (geç dönen yanıt yeni terimin sonuçlarını ezmesin).
  useEffect(() => {
    const terim = aramaTerimi(query)
    if (!open || !terim || !companyId) {
      setKayitlar([])
      setAraniyor(false)
      setKayitHatasi(false)
      return
    }
    setAraniyor(true)
    const ctrl = new AbortController()
    const zamanlayici = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/arama?companyId=${encodeURIComponent(companyId)}&q=${encodeURIComponent(terim)}`,
          { signal: ctrl.signal },
        )
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        setKayitlar(Array.isArray(data?.gruplar) ? data.gruplar : [])
        setKayitHatasi(false)
      } catch (error) {
        if (ctrl.signal.aborted) return
        console.error("Kayıt araması başarısız:", error)
        setKayitlar([])
        setKayitHatasi(true)
      } finally {
        if (!ctrl.signal.aborted) setAraniyor(false)
      }
    }, BEKLEME_MS)
    return () => {
      clearTimeout(zamanlayici)
      ctrl.abort()
    }
  }, [query, open, companyId])

  const kapat = () => {
    setOpen(false)
    setQuery("")
  }

  const goPage = (href: string) => {
    kapat()
    // Aktif firma (?company=) ve diğer query paramları korunur.
    const search = typeof window !== "undefined" ? window.location.search : ""
    router.push(href + search)
  }

  const goRecord = (href: string) => {
    kapat()
    // Kayıt sayfası başka bir ekran: yalnız firma bağlamı taşınır (CLAUDE.md).
    router.push(withCompanyHref(href, companyParam))
  }

  // Ekrandaki sırayla düz liste: önce sayfalar, sonra kayıt grupları.
  const bolumler = useMemo(() => {
    const sayfalar: Satir[] = results.map((item) => ({
      key: `sayfa:${item.href}`,
      baslik: item.label,
      grup: GROUP_BY_HREF[item.href],
      Icon: item.icon,
      git: () => goPage(item.href),
    }))
    const kayitBolumleri = kayitlar.map((g) => ({
      etiket: g.etiket,
      satirlar: g.sonuclar.map(
        (s): Satir => ({
          key: `${s.tur}:${s.id}`,
          baslik: s.baslik,
          alt: s.alt,
          rozet: s.rozet,
          Icon: KAYIT_IKONU[s.tur],
          git: () => goRecord(s.href),
        }),
      ),
    }))
    return [{ etiket: "Sayfalar", satirlar: sayfalar }, ...kayitBolumleri].filter((b) => b.satirlar.length > 0)
    // goPage/goRecord her render'da yenidir; listeyi yalnız veri değişince kur.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results, kayitlar, companyParam])

  const duz = useMemo(() => bolumler.flatMap((b) => b.satirlar), [bolumler])

  useEffect(() => {
    setHighlighted(0)
  }, [query, kayitlar])

  // Açılınca input'a odaklan.
  useEffect(() => {
    if (open) requestAnimationFrame(() => inputRef.current?.focus())
  }, [open])

  // Dışarı tıklayınca kapat.
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDoc)
    return () => document.removeEventListener("mousedown", onDoc)
  }, [open])

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      setOpen(false)
      return
    }
    if (duz.length === 0) return
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setHighlighted((h) => (h + 1) % duz.length)
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setHighlighted((h) => (h - 1 + duz.length) % duz.length)
    } else if (e.key === "Enter") {
      e.preventDefault()
      duz[highlighted]?.git()
    }
  }

  const kayitAraniyor = Boolean(aramaTerimi(query))
  // Başlık yalnız iki tür sonuç birden olabilecekse anlamlı.
  const basliklariGoster = kayitAraniyor

  let sira = -1
  return (
    <div ref={containerRef} className="relative">
      <Button
        variant="outline"
        size="icon"
        type="button"
        className="h-9 w-9"
        onClick={() => setOpen((o) => !o)}
        title="Ara: sayfa, cari, belge no, ürün"
        aria-expanded={open}
      >
        <Search className="h-4 w-4" />
      </Button>

      {open && (
        <div className="fixed inset-x-2 top-14 z-50 overflow-hidden rounded-xl border border-kobipo-border bg-white shadow-lg dark:border-border dark:bg-card sm:absolute sm:inset-x-auto sm:right-0 sm:top-auto sm:mt-2 sm:w-96">
          <div className="flex items-center gap-2 border-b border-kobipo-border px-3 py-2 dark:border-border">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Sayfa, cari, belge no, ürün ara…"
              className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            {araniyor && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" aria-label="Aranıyor" />}
          </div>
          <div className="max-h-[60vh] overflow-y-auto p-1">
            {bolumler.map((bolum) => (
              <Fragment key={bolum.etiket}>
                {basliklariGoster && (
                  <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {bolum.etiket}
                  </p>
                )}
                <ul>
                  {bolum.satirlar.map((satir) => {
                    sira += 1
                    const i = sira
                    const Icon = satir.Icon
                    return (
                      <li key={satir.key}>
                        <button
                          type="button"
                          onMouseEnter={() => setHighlighted(i)}
                          onClick={satir.git}
                          className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                            highlighted === i ? "bg-muted" : "hover:bg-muted/60"
                          }`}
                        >
                          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate">{satir.baslik}</span>
                            {satir.alt && (
                              <span className="block truncate text-xs text-muted-foreground">{satir.alt}</span>
                            )}
                          </span>
                          {(satir.rozet || satir.grup) && (
                            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                              {satir.rozet || satir.grup}
                            </span>
                          )}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </Fragment>
            ))}

            {kayitHatasi && (
              <p className="px-3 py-2 text-xs text-orange-700 dark:text-orange-400">
                Kayıt araması yapılamadı; yalnız sayfalar gösteriliyor. Tekrar deneyin.
              </p>
            )}
            {duz.length === 0 && !araniyor && !kayitHatasi && (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">Sonuç bulunamadı</p>
            )}
            {duz.length === 0 && araniyor && (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">Kayıtlar aranıyor…</p>
            )}
            {!kayitAraniyor && query.trim().length > 0 && (
              <p className="px-3 pb-2 pt-1 text-[11px] text-muted-foreground">
                Kayıt aramak için en az 2 karakter yazın.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
