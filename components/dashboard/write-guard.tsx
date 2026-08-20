"use client"

import { useMemo } from "react"
import { usePathname, useSearchParams } from "next/navigation"
import { Eye } from "lucide-react"
import { useDashboardCompany } from "@/components/dashboard/dashboard-company-provider"
import { canEditPage, navHrefsForPath } from "@/lib/page-access"
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

  const owners = navHrefsForPath(pathname, searchParams)
  // Menüde karşılığı olmayan yol (ör. bir alt detay ekranı) kısıtlanmaz: sahibi
  // bilinmeden düğme gizlemek, yetkisi olan kullanıcının ekranını bozardı.
  if (owners.length === 0) return true
  // Cari gibi çok sahipli yollarda BİRİ yeterlidir — `visiblePages` ile aynı mantık.
  return owners.some((href) => canEditPage(pagePermissions, href))
}

/**
 * Yazma işlemi başlatan düğmeleri sarar. Salt-okunur sayfada hiç render EDİLMEZ.
 *
 * Gizlemek, "disabled" bırakmaya yeğlendi: devre dışı bir düğme kullanıcıya neden
 * çalışmadığını söylemez, oysa sayfa başındaki `ReadOnlyBanner` bunu zaten açıklıyor.
 */
export function WriteAction({ children }: { children: React.ReactNode }) {
  return useCanEditHere() ? <>{children}</> : null
}

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
