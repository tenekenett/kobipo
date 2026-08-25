"use client"

// Menü ızgarası — Kahveci Satış ve Adisyon ekranlarının ORTAK parçası.
//
// Ayrı bir bileşen olmasının sebebi tekrar değil, AYRIŞMA riski: iki ekranda da
// "menüde hangi ürünler görünür" sorusunun cevabı aynı olmalı (aktif + satılabilir
// + hizmet değil). İki kopya olsaydı biri `isSellable`'ı unuttuğu anda kasiyer bir
// ekranda görüp diğerinde göremediği ürünlerle uğraşırdı — İş 9'daki üç bayrak
// dağınıklığının aynısı.
//
// Rozet (sağ üstteki adet) çağırana bırakılır: satışta sepetteki adet, adisyonda
// adisyondaki adet gösterilir.
//
// FOTOĞRAF: kartın üstünde bant olarak çıkar (Menü & Reçeteler ekranından
// yüklenir). Bant, menüde EN AZ BİR ürünün fotoğrafı varsa açılır — hiç fotoğraf
// yoklayan işletmede ızgara eski kompakt haliyle kalır. Karar `menuProducts`
// üzerinden verilir, ekrandaki filtreli liste üzerinden DEĞİL: aksi halde
// fotoğrafsız bir kategoriye geçince tüm kartlar zıplardı.
//
// Fotoğrafı OLMAYAN ürün, adını renkli bir döşemenin üstünde gösterir
// (bkz. TILE_TONES). Kritik nokta: fotoğraf YARIM benimsenebilir bir özellik —
// işletme 5 ürünü çeker, 50'sini çekmez. Boş yer tutucu göstermek o 50 kartı
// bozuk gösterip herkesi fotoğraf çekmeye mecbur bırakıyordu.

import { useCallback, useMemo, useState } from "react"
import { CompanyLink } from "@/components/dashboard/company-link"
import { ChefHat, CupSoda, MousePointerClick, Search } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { FetchErrorText } from "@/components/ui/fetch-error"
import { Input } from "@/components/ui/input"
import { formatMoney } from "@/lib/format"
import { qty } from "@/lib/format"
import { unitShortLabel } from "@/lib/data/units"
import type { RecipeMap } from "@/lib/stock/recipe-expand"
import type { RefProduct } from "@/lib/swr/use-company-data"
import { cn } from "@/lib/utils"

const ALL_CATEGORIES = "__ALL__"

/**
 * Fotoğrafsız ürünün döşemesi — ürün adı, ada göre SABİT bir renkte.
 *
 * Eskiden burada gri bir zemin üstünde küçük bir "görsel yok" ikonu vardı ve
 * menünün yarısı fotoğrafsızken ızgara bozuk görünüyordu; bu da işletmeyi her
 * ürüne fotoğraf çekmeye MECBUR bırakıyordu. Üretilmiş döşeme bunu bitirir:
 * fotoğrafsız kart eksik değil, kasıtlı görünür.
 *
 * Renk ürün id'sinden türetilir — aynı ürün her açılışta aynı renkte çıkar,
 * kasiyer zamanla rengi de tanır. Sınıf adları TAM metin olarak yazılı; Tailwind
 * derleyicisi birleştirilmiş sınıf adını göremez.
 */
const TILE_TONES = [
  "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
  "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
  "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
  "bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300",
]

function tileToneOf(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 9973
  return TILE_TONES[h % TILE_TONES.length]
}



/** Menüde gösterilen KDV dahil fiyat — kahvecide fiyat listesi brüttür. */
export const grossPrice = (p: { salePrice: number | null; vatRate: number }) =>
  (p.salePrice ?? 0) * (1 + (Number(p.vatRate) || 0) / 100)

/** Menüde görünen ürünler: aktif + satılabilir + hizmet değil. TEK tanım. */
export function menuProductsOf(products: RefProduct[]): RefProduct[] {
  return products.filter((p) => p.isActive && p.isSellable && !p.isService)
}

type MenuGridProps = {
  products: RefProduct[]
  /**
   * Reçetesi olan ürünlerde kaşık ikonu ve kartın altındaki TARİF satırı
   * ("1 Espresso · 200 ml Su") bundan üretilir. Eskiden `Map<string, unknown>`
   * idi — yalnız `has()` çağrılıyordu; tarif için kalemlere bakmak gerekiyor.
   */
  recipeMap?: RecipeMap
  /**
   * Ürünün HAZIRLIK NOTU (reçetenin `note` alanı). Reçete ekranında yazılıyor
   * ("çift shot", "60 ml demleme") ama satış ekranlarında hiç gösterilmiyordu —
   * yani barista notu yalnızca reçeteyi düzenlerken görebiliyordu. Kartın
   * üzerinde duruyor: ürün tam da hazırlanmak üzere seçilirken.
   */
  noteOf?: (productId: string) => string | null | undefined
  isLoading?: boolean
  error?: unknown
  /** Kartın sağ üstündeki adet rozeti; null/0 ise rozet çizilmez. */
  badgeOf?: (productId: string) => number | null | undefined
  onPick: (product: RefProduct) => void
  /**
   * SAĞ TIK — karttan bir adet düşürür. Kasiyer yanlış basınca sepete/adisyona
   * bakıp doğru satırı bulmak zorunda kalmasın: eklediği yerden geri alır.
   * Verilmezse tarayıcının kendi menüsü açılır (davranış değişmez).
   */
  onUnpick?: (product: RefProduct) => void
}

export function MenuGrid({
  products,
  recipeMap,
  noteOf,
  isLoading,
  error,
  badgeOf,
  onPick,
  onUnpick,
}: MenuGridProps) {
  const [search, setSearch] = useState("")
  const [activeCat, setActiveCat] = useState<string>(ALL_CATEGORIES)

  const menuProducts = useMemo(() => menuProductsOf(products), [products])

  /** Menüde tek bir fotoğraf bile varsa kartlar fotoğraflı düzene geçer. */
  const showImages = useMemo(() => menuProducts.some((p) => p.imageUrl), [menuProducts])

  // Bileşen adları için: reçete kalemleri yalnızca id tutar. Arama `products`
  // üzerinden yapılır (menü filtresi UYGULANMAZ) çünkü bileşenler hammaddedir,
  // menüde görünmezler.
  const nameById = useMemo(() => new Map(products.map((p) => [p.id, p.name])), [products])

  /**
   * Kartın altındaki tarif satırı: "1 Espresso · 200 ml Su".
   *
   * Bileşenler AÇILMAZ, reçetede yazdığı gibi listelenir — Americano'nun tarifi
   * "1 Espresso + 200 ml su"dur, "18 gr kahve çekirdeği + 200 ml su" değil.
   * Barista'nın eline bakacağı şey birincisi.
   *
   * Miktar `yieldQuantity`e bölünür: 10 porsiyonluk sos reçetesinde kartta
   * porsiyon başına düşen miktar yazmalı.
   */
  const recipeLineOf = useCallback(
    (productId: string): string | null => {
      const recipe = recipeMap?.get(productId)
      if (!recipe || recipe.items.length === 0) return null
      const perUnit = recipe.yieldQuantity > 0 ? recipe.yieldQuantity : 1
      return recipe.items
        .map((item) => {
          const name = nameById.get(item.componentProductId)
          if (!name) return null
          const amount = qty(item.quantity / perUnit)
          // ADET'te birim yazılmaz: "1 Espresso", "1 Adet Espresso" değil.
          const unit = unitShortLabel(item.unit)
          const showUnit = unit && unit.toLocaleLowerCase("tr-TR") !== "adet"
          return showUnit ? `${amount} ${unit} ${name}` : `${amount} ${name}`
        })
        .filter(Boolean)
        .join(" · ")
        .trim() || null
    },
    [recipeMap, nameById]
  )

  const categories = useMemo(() => {
    const set = new Set<string>()
    for (const p of menuProducts) if (p.category) set.add(p.category)
    return Array.from(set).sort((a, b) => a.localeCompare(b, "tr-TR"))
  }, [menuProducts])

  const visibleProducts = useMemo(() => {
    const q = search.trim().toLocaleLowerCase("tr-TR")
    return menuProducts
      .filter((p) => activeCat === ALL_CATEGORIES || p.category === activeCat)
      .filter(
        (p) =>
          !q ||
          p.name.toLocaleLowerCase("tr-TR").includes(q) ||
          (p.code ?? "").toLocaleLowerCase("tr-TR").includes(q) ||
          (p.barcode ?? "").toLocaleLowerCase("tr-TR").includes(q)
      )
      .sort((a, b) => a.name.localeCompare(b.name, "tr-TR"))
  }, [menuProducts, activeCat, search])

  const catTab = (isActive: boolean) =>
    cn(
      "shrink-0 rounded-full px-4 py-2 text-sm font-semibold transition-colors",
      isActive
        ? "bg-kobipo-blue text-white dark:bg-primary dark:text-primary-foreground"
        : "bg-muted text-muted-foreground hover:bg-muted/70"
    )

  return (
    <Card>
      <CardContent className="space-y-3 p-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <CupSoda className="h-4 w-4 text-kobipo-blue dark:text-primary" />
            <span className="text-sm font-semibold">Menü</span>
            <span className="text-xs text-muted-foreground">
              ({menuProducts.length} ürün · fiyatlar KDV dahil)
            </span>
          </div>
          <div className="flex items-center gap-2">
            {/* Sağ tık keşfedilebilir DEĞİL: parantez içindeki bir cümle
                kaybolduğu için ipucu ayrı bir rozete alındı. Başlıkta duruyor
                çünkü kasiyer yanlış basınca ilk oraya bakıyor. */}
            {onUnpick && (
              <span className="hidden shrink-0 items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground sm:inline-flex">
                <MousePointerClick className="h-3.5 w-3.5" />
                Karta sağ tık: 1 azalt
              </span>
            )}
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Ürün ara…"
                className="h-10 pl-9"
              />
            </div>
          </div>
        </div>

        {categories.length > 0 && (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
            <button
              type="button"
              onClick={() => setActiveCat(ALL_CATEGORIES)}
              className={catTab(activeCat === ALL_CATEGORIES)}
            >
              Tümü
            </button>
            {categories.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setActiveCat(c)}
                className={catTab(activeCat === c)}
              >
                {c}
              </button>
            ))}
          </div>
        )}

        {/* Yükleme ve hata durumu boş menüden AYRI: ürün listesi çekilemediğinde
            "menüde ürün yok" demek kasiyeri yanıltır — menü dolu ama ekran boş. */}
        {error ? (
          <div className="py-12 text-center text-sm text-red-600 dark:text-red-400">
            <FetchErrorText error={error} subject="Menü" />
          </div>
        ) : isLoading && products.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">Menü yükleniyor…</div>
        ) : visibleProducts.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            {menuProducts.length === 0 ? (
              // Kurulum artık tek yerde (Menü & Reçeteler) — iki ayrı yol tarif
              // etmek yerine doğrudan oraya bağlıyoruz.
              <>
                Menüde ürün yok.{" "}
                <CompanyLink
                  href="/restoran/menu"
                  className="font-semibold text-kobipo-blue underline-offset-4 hover:underline dark:text-primary"
                >
                  Menü &amp; Reçeteler
                </CompanyLink>{" "}
                ekranından ürünlerinizi menüye alın.
              </>
            ) : (
              "Bu aramaya/kategoriye uyan ürün yok"
            )}
          </div>
        ) : (
          /* Geniş ekranda sütun sayısı artar: 4 sütunda kartlar 450px'e kadar
             şişiyor, 3:2 bant da 300px'lik dev bir fotoğrafa dönüşüyordu. Daha
             çok sütun hem fotoğrafı makul boyda tutar hem ekrana daha çok ürün
             sığdırır — POS ızgarasında istenen zaten bu. */
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
            {visibleProducts.map((p) => {
              const badge = badgeOf?.(p.id) ?? null
              const prepNote = noteOf?.(p.id)?.trim() || null
              const recipeLine = recipeLineOf(p.id)
              /**
               * Fotoğrafsız kartta ad, renkli alanın ORTASINDA yazılır (baş harf
               * değil) ve alt satırda tekrarlanmaz.
               *
               * Bu daha önce denendi ve kötüydü: ad alttan kalkınca şerit boşalıyor
               * ama YÜKSEKLİĞİ kalıyordu (satırın yüksekliğini fotoğraflı kart
               * belirliyor), dibinde tek başına bir fiyatın durduğu beyaz bant
               * kalıyordu. Farkı şu: artık renkli alan ESNEK (`grow`), alt şerit
               * ise yalnızca içeriği kadar. Artan yükseklik beyaz şeride değil
               * renge gidiyor — boş bant oluşamıyor.
               */
              const nameOnTile = showImages && !p.imageUrl
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => onPick(p)}
                  onContextMenu={
                    onUnpick
                      ? (e) => {
                          // Tarayıcı menüsü açılmasın: kartın sağ tıkı artık
                          // "bir azalt" demek.
                          e.preventDefault()
                          onUnpick(p)
                        }
                      : undefined
                  }
                  title={onUnpick ? `${p.name} — sağ tık: 1 azalt` : undefined}
                  className={cn(
                    "relative flex min-h-[86px] flex-col justify-between gap-2 overflow-hidden rounded-xl border-2 text-left transition-colors",
                    // Fotoğraf bandı kenarlara dayanmalı; iç boşluk metin
                    // bloğuna taşınıyor.
                    showImages ? "p-0" : "p-3",
                    badge
                      ? "border-kobipo-blue bg-kobipo-blue/5 dark:border-primary dark:bg-primary/10"
                      : "border-border hover:border-kobipo-blue hover:bg-kobipo-blue/5 dark:hover:border-primary dark:hover:bg-primary/10"
                  )}
                >
                  {!!badge && (
                    // Fotoğrafın üstüne binebildiği için halka: açık bir görselde
                    // mavi daire kaybolmasın.
                    <span className="absolute right-2 top-2 z-10 flex h-6 min-w-6 items-center justify-center rounded-full bg-kobipo-blue px-1.5 text-xs font-bold text-white ring-2 ring-white/80 dark:bg-primary dark:text-primary-foreground dark:ring-background/80">
                      {qty(badge)}
                    </span>
                  )}
                  {showImages && (
                    // Kutu 3:2 — depoya giden her fotoğraf da tam 3:2 (kırpma
                    // penceresinde öyle üretiliyor). Yani `cover` burada
                    // hiçbir şeyi kırpmaz, birebir oturur; kırpma kararını
                    // CSS'ten alıp kullanıcıya vermenin bütün mesele olduğu yer
                    // burası. `cover` yine de yazılı: bu özellikten ÖNCE
                    // yüklenmiş (serbest oranlı) görseller ızgarayı bozmasın.
                    //
                    // Fotoğrafsız kartta da AYNI kutu var (renkli döşeme):
                    // kaldırılırsa tamamı fotoğrafsız olan satırlar fotoğraflı
                    // satırlardan kısa kalır ve ızgara zıplar.
                    <span
                      className={cn(
                        "flex aspect-[3/2] w-full items-center justify-center overflow-hidden",
                        // Fotoğraf sabit kalmalı (esnerse `cover` daha çok kırpar);
                        // renkli döşeme ise artan yüksekliği emsin diye büyür.
                        p.imageUrl ? "shrink-0 bg-muted/40" : cn("grow", tileToneOf(p.id))
                      )}
                    >
                      {p.imageUrl ? (
                        /* eslint-disable-next-line @next/next/no-img-element --
                           depo URL'i; next/image remotePatterns yapılandırması
                           ister ve görsel zaten tek boyutta saklanıyor.
                           lazy: ızgarada 50 kart olabiliyor, ekran dışındakiler
                           hiç indirilmesin. */
                        <img
                          src={p.imageUrl}
                          alt=""
                          loading="lazy"
                          decoding="async"
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <span className="line-clamp-3 select-none px-3 text-center text-base font-bold leading-snug">
                          {p.name}
                        </span>
                      )}
                    </span>
                  )}
                  <span
                    className={cn(
                      "flex min-w-0 flex-col justify-between gap-2",
                      // Ad renkli alanda yazıyorsa şerit YALNIZCA içeriği kadar
                      // olsun; artan yüksekliği yukarıdaki renkli alan alır.
                      !nameOnTile && "flex-1",
                      showImages && "px-3 pb-3 pt-2"
                    )}
                  >
                    <span className="flex min-w-0 flex-col gap-0.5">
                      {/* Ad renkli alanda yazıyorsa burada tekrarlanmaz. */}
                      {!nameOnTile && (
                        <span
                          className={cn(
                            "line-clamp-2 text-sm font-semibold",
                            // Rozet fotoğrafın üstündeyse başlığa yer açmaya gerek yok.
                            !showImages && "pr-7"
                          )}
                        >
                          {p.name}
                        </span>
                      )}
                      {recipeLine && (
                        // TARİF: "1 Espresso · 200 ml Su". Kartın alt kısmı zaten
                        // boştu; oraya ürünün NEYDEN yapıldığını yazmak hem boşluğu
                        // doldurur hem yeni çalışana kopya verir — menüyü ezberlemek
                        // zorunda kalmadan hazırlar.
                        <span
                          className="line-clamp-2 text-[11px] leading-snug text-muted-foreground"
                          title={recipeLine}
                        >
                          {recipeLine}
                        </span>
                      )}
                      {prepNote && (
                        // Uzun not kartı büyütmesin: iki satırda kesilir, tamamı
                        // title'da durur (dokunmatikte uzun basınca da görünür).
                        <span
                          className="line-clamp-2 text-[11px] leading-snug text-muted-foreground"
                          title={prepNote}
                        >
                          {prepNote}
                        </span>
                      )}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="text-sm font-bold text-kobipo-blue dark:text-primary">
                        {p.salePrice != null ? formatMoney(grossPrice(p), p.currency) : "—"}
                      </span>
                      {recipeMap?.has(p.id) && (
                        <ChefHat
                          className="h-3.5 w-3.5 text-muted-foreground"
                          aria-label="Reçeteli"
                        />
                      )}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
