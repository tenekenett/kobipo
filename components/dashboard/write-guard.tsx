"use client"

import { forwardRef, isValidElement, useMemo, type HTMLAttributes, type ReactNode } from "react"
import { usePathname, useSearchParams } from "next/navigation"
import { Slot } from "@radix-ui/react-slot"
import { Eye } from "lucide-react"
import {
  useDashboardCompany,
  useOptionalDashboardCompany,
} from "@/components/dashboard/dashboard-company-provider"
import { canEditPage, isReadOnlyMembership, navHrefsForPath } from "@/lib/page-access"
import { toast } from "@/components/ui/use-toast"
import { isReadOnlyByNature, navPage, type PageAvailability } from "@/lib/nav/pages"

/**
 * "Görsün ama değiştirmesin" izninin ARAYÜZ karşılığı.
 *
 * `useCanEdit` aylardır yazılıydı ama hiçbir ekran çağırmıyordu: izin seçicide bir
 * sayfayı salt-okunur yapmak hiçbir düğmeyi gizlemiyor, kullanıcı Kaydet'e basıp
 * sunucudan 403 yiyordu (ya da kapı o uçta yoksa gerçekten yazıyordu). Buradaki iki
 * parça o boşluğu kapatır.
 *
 * Sayfa href'i ELLE verilmez: `navHrefsForPath` adres çubuğundan sahibini bulur, böylece
 * her ekranda ayrı bir sabit tutmak (ve unutmak) gerekmez.
 *
 * Bu bir UX katmanıdır, güvenlik sınırı DEĞİL — asıl kapı `ensureCompanyWrite` ve
 * `isApiPathAllowedForUser`. `PermissionGuard`ın kardeşi: o "bu sayfayı göremezsin"
 * der, bu "görebilirsin ama değiştiremezsin".
 */

/**
 * Seçili firmanın modül durumu — yetki seçicilerine "kapalı modülü teklif etme" demek
 * için. Firma çözülmeden `undefined` döner ve süzgeç uygulanmaz (yanlış pozitif olmasın).
 */
export function usePageAvailability(): PageAvailability | undefined {
  const { selectedCompany } = useDashboardCompany()
  return useMemo(
    () =>
      selectedCompany
        ? {
            disabledModules: selectedCompany.disabledModules ?? [],
            isEDonusumEnabled: selectedCompany.isEDonusumEnabled !== false,
          }
        : undefined,
    [selectedCompany]
  )
}

/** Bulunulan sayfada yazma yetkisi var mı? Firma seçilmeden true (yanlış pozitif olmasın). */
export function useCanEditHere(): boolean {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { selectedCompany, pagePermissions } = useDashboardCompany()

  if (!selectedCompany) return true
  // ARŞİV: hesap salt-okunur — rolden bağımsız olarak hiçbir ekranda düzenleme yok.
  // Sunucu kapısı zaten reddediyor (`ensureCompanyWrite`); buradaki kontrol arayüzün
  // kullanıcıya yalan söylememesi için, `useCanExport` bilinçli olarak etkilenmez:
  // veriyi indirebilmek arşivin varlık sebebidir.
  if (selectedCompany.isArchived) return false

  const owners = navHrefsForPath(pathname, searchParams)
  // Menüde karşılığı olmayan yol (ör. bir alt detay ekranı) kısıtlanmaz: sahibi
  // bilinmeden düğme gizlemek, yetkisi olan kullanıcının ekranını bozardı.
  if (owners.length === 0) return true
  // Cari gibi çok sahipli yollarda BİRİ yeterlidir — `visiblePages` ile aynı mantık.
  return owners.some((href) => canEditPage(pagePermissions, href))
}

/**
 * Veriyi ekranın DIŞINA çıkaran eylemler serbest mi: Excel/PDF/CSV dışa aktarma,
 * PDF indirme, yazdırma, belgeyi e-postayla gönderme.
 *
 * Yazma yetkisinden AYRI bir soru ve o yüzden `useCanEditHere` ile karıştırılmamalı:
 * rapor sayfaları doğası gereği salt-okunurdur (`isReadOnlyByNature`), orada "yazamıyorsa
 * dışa aktaramaz" demek YÖNETİCİDEN de dışa aktarmayı alırdı — oysa raporun tek işlevi
 * budur.
 *
 * Karar ÜYELİK düzeyinde veriliyor: hiçbir sayfada düzenleme yetkisi olmayan kullanıcı
 * (enum VIEWER ya da tüm sayfaları salt-okunur tanımlanmış özel rol — Gözlemci kalıbı)
 * veriyi dışarı çıkaramaz; yetkisi ekranda okumakla sınırlıdır. Yazma yetkisi OLAN ama
 * bu sayfada olmayan bir çalışan (ör. raporu yalnız görüntüleyen Satış Temsilcisi) dışa
 * aktarabilir — ondan alınması istenen bir şey değil, kısıt salt-okunur üyeliğe özgü.
 *
 * Sunucu tarafındaki karşılığı `ensureCompanyExport` — ikisi de `isReadOnlyMembership`
 * yordamından besleniyor, ayrışamazlar.
 */
export function useCanExport(): boolean {
  // Sağlayıcı dışında (panel dışı kullanım) kısıt uygulanmaz: firma bağlamı yoksa
  // "salt-okunur mu" sorusunun cevabı da yoktur.
  const ctx = useOptionalDashboardCompany()
  if (!ctx?.selectedCompany) return true
  return !isReadOnlyMembership(ctx.pagePermissions)
}

/**
 * Dışa aktarma/yazdırma düğmelerini sarar. Salt-okunur üyelikte hiç render EDİLMEZ.
 * `WriteAction`ın kardeşi; farkı hangi soruyu sorduğu (bkz. `useCanExport`).
 */
export function ExportAction({
  children,
  fallback = null,
}: {
  children: React.ReactNode
  fallback?: React.ReactNode
}) {
  return useCanExport() ? <>{children}</> : <>{fallback}</>
}

/**
 * Yazma işlemi başlatan düğmeleri sarar. Salt-okunur sayfada hiç render EDİLMEZ.
 *
 * Gizlemek, "disabled" bırakmaya yeğlendi: devre dışı bir düğme kullanıcıya neden
 * çalışmadığını söylemez, oysa sayfa başındaki `ReadOnlyBanner` bunu zaten açıklıyor.
 *
 * `fallback` yalnız VERİ GÖSTEREN bir düzenleyici içindir: çek detayındaki durum
 * seçicisi gibi. Seçiciyi silmek durumu da silerdi; yerine okunur bir rozet basılır.
 * Düğmelerde kullanılmaz — orada doğru davranış hiç basmamak.
 *
 * ÜSTTEN GELEN PROP'LAR GEÇİRİLİR (`Slot`). `<DialogTrigger asChild>` gibi Radix
 * sarmalayıcıları `onClick`/`ref`/`aria-*`'ı DOĞRUDAN çocuğa — yani bu bileşene —
 * klonlar. Fragment döndüren sürüm hepsini sessizce yutuyordu: düğme çiziliyor,
 * tıklanıyor ve HİÇBİR ŞEY olmuyordu (yetkisi tam kullanıcıda bile). Prop gelmediği
 * sürece davranış eskisi gibi saf sarmalayıcıdır; `Slot` yalnız tek bir React
 * elemanı sarıldığında devreye girer.
 */
export const WriteAction = forwardRef<
  HTMLElement,
  HTMLAttributes<HTMLElement> & { children: ReactNode; fallback?: ReactNode }
>(function WriteAction({ children, fallback = null, ...rest }, ref) {
  const canEdit = useCanEditHere()
  if (!canEdit) return <>{fallback}</>
  if ((ref || Object.keys(rest).length > 0) && isValidElement(children)) {
    return (
      <Slot ref={ref} {...rest}>
        {children}
      </Slot>
    )
  }
  return <>{children}</>
})

/** Sayfa başında duran açıklama. Yazma yetkisi varsa hiçbir şey basmaz. */
export function ReadOnlyBanner() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const canEdit = useCanEditHere()
  const owners = navHrefsForPath(pathname, searchParams)
  if (canEdit) return null
  // Rapor/dashboard'da uyarı basmıyoruz: orada zaten kimse yazmıyor.
  if (owners.length > 0 && owners.every(isReadOnlyByNature)) return null

  const label = owners.map((href) => navPage(href)?.label).find(Boolean)

  return (
    <div className="mb-4 flex items-start gap-2.5 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100">
      <Eye className="mt-0.5 h-4 w-4 shrink-0" />
      <span>
        <strong>Salt-okunur:</strong> {label ? `“${label}” sayfasını` : "bu sayfayı"} görüntüleyebilir,
        değişiklik yapamazsınız. Düzenleme yetkisi için firma yöneticinize başvurun.
      </span>
    </div>
  )
}

/**
 * Düğme OLMAYAN yazma yolları için kapı: sürükle-bırak, tuval jesti, masa/satır
 * dokunuşu. Sarılacak bir `<Button>` yok, dolayısıyla `WriteAction` iş görmez —
 * karar koda girer.
 *
 * `refuse()` sessiz durmaz: dokunup hiçbir şey olmayınca kullanıcı ekranın
 * bozulduğunu sanar. Sayfa başındaki şerit "değiştiremezsiniz" der ama jestin
 * neden yutulduğunu ancak dokunulan anda söylemek anlaşılır olur.
 */
export function useWriteGuard(): { canWrite: boolean; refuse: () => void } {
  const canWrite = useCanEditHere()
  return useMemo(
    () => ({
      canWrite,
      refuse: () =>
        toast({
          title: "Salt-okunur yetki",
          description: "Bu sayfayı görüntüleyebilirsiniz, değişiklik yapamazsınız.",
        }),
    }),
    [canWrite],
  )
}

/**
 * Yalnız BASMAK için var olan ekranlar: A4 fiş dökümü, etiket yazdırma.
 *
 * Burada düğme gizlemek YETMEZ — sayfa belgeyi zaten çiziyor, kullanıcı tarayıcının
 * kendi yazdır komutuyla (ya da ekran görüntüsüyle) alabilir. Salt-okunur üyelikte
 * ekran hiç kurulmaz.
 */
export function ExportOnlyScreen({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  if (useCanExport()) return <>{children}</>

  const label = navHrefsForPath(pathname, searchParams)
    .map((href) => navPage(href)?.label)
    .find(Boolean)

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="max-w-md space-y-2 text-center">
        <Eye className="mx-auto h-8 w-8 text-muted-foreground" />
        <h2 className="text-lg font-semibold">
          {label ? `“${label}” çıktısı alınamaz` : "Bu çıktı alınamaz"}
        </h2>
        <p className="text-sm text-muted-foreground">
          Görüntüleme yetkiniz ekranda okumakla sınırlı; yazdırma ve dışa aktarma buna
          dahil değil. Çıktı almanız gerekiyorsa firma yöneticinize başvurun.
        </p>
      </div>
    </div>
  )
}

/**
 * Yalnız YAZMAK için var olan tezgâh ekranları (hızlı satış/alış, kahveci
 * satış). Orada tek tek düğme gizlemek yanlış olurdu: geriye ürünleri sepete
 * atıp tamamlayamayan, kullanılamaz bir tezgâh kalır. Salt-okunur yetkide
 * tezgâh hiç kurulmaz, yerine sebebi yazılır.
 *
 * `ReadOnlyBanner`ın aksine bu bir DUVAR — ama `PermissionGuard`ın duvarı
 * değil: sayfayı görme yetkisi vardır, ekranın kendisi okunacak bir şey
 * üretmiyordur.
 */
export function WriteOnlyScreen({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const canEdit = useCanEditHere()
  if (canEdit) return <>{children}</>

  const label = navHrefsForPath(pathname, searchParams)
    .map((href) => navPage(href)?.label)
    .find(Boolean)

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="max-w-md space-y-2 text-center">
        <Eye className="mx-auto h-8 w-8 text-muted-foreground" />
        <h2 className="text-lg font-semibold">
          {label ? `“${label}” ekranı salt-okunur açılamaz` : "Bu ekran salt-okunur açılamaz"}
        </h2>
        <p className="text-sm text-muted-foreground">
          Bu ekran yalnızca kayıt oluşturmak için vardır; yetkiniz görüntülemekle sınırlı
          olduğu için açılacak bir şey yok. Kullanmanız gerekiyorsa firma yöneticinizden
          bu sayfa için düzenleme yetkisi isteyin.
        </p>
      </div>
    </div>
  )
}
