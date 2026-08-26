"use client"

import useSWR from "swr"
import { AlertTriangle, Clock, CreditCard } from "lucide-react"
import { useDashboardCompany } from "@/components/dashboard/dashboard-company-provider"
import { CompanyLink } from "@/components/dashboard/company-link"

type NoticeResponse = {
  notice: {
    kind: "expiring" | "grace" | "expired"
    endsAt: string
    /** Modüllerin gerçekten kapanacağı an; hoşgörü süresi varsa `endsAt`'ten sonradır. */
    locksAt: string
    daysLeft: number
    /** Kilide kalan tam gün — `grace` şeridindeki geri sayım. */
    daysUntilLock: number
    cancelling: boolean
  } | null
  canPurchase: boolean
}

/**
 * Aboneliğin durumunu panelin üstünde duyurur. Üç hâli var:
 *
 *   expiring → dönem bitmek üzere (sarı). Otomatik yenileme gerçekten kuruluysa uç bu
 *              şeridi hiç döndürmez — sorunsuz ödeyen müşteriye her dönem uyarı göstermek
 *              gürültüdür (bkz. app/api/billing/notice/route.ts).
 *   grace    → ödeme alınamadı, erişim sürüyor (kırmızı, geri sayımlı). KAPATILAMAZ:
 *              modüllerin kapanmasına gün sayılıyor, kullanıcı bunu kaçırmamalı.
 *   expired  → erişim kapandı (kırmızı).
 *
 * Şerit yalnız BİLGİLENDİRİR — erişimi kesen bir şey yapmaz. Kapatma butonu bilinçli
 * olarak yok: kaçırılması hâlinde sonucu para/erişim kaybı olan tek bildirim bu.
 *
 * Şube seçiliyken de görünür: abonelik hesap (kök firma) düzeyindedir, şubenin erişimi
 * de aynı dönemde biter.
 */
export function SubscriptionNoticeBanner() {
  const { selectedCompany } = useDashboardCompany()
  const companyParam = selectedCompany?.slug ?? selectedCompany?.id ?? null

  const { data } = useSWR<NoticeResponse>(
    companyParam ? `/api/billing/notice?companyId=${encodeURIComponent(companyParam)}` : null,
    // Bitiş tarihi gün ölçeğinde bir bilgi; her gezinmede yeniden sormaya gerek yok.
    { revalidateIfStale: false, dedupingInterval: 5 * 60 * 1000 },
  )

  const notice = data?.notice
  if (!notice) return null

  const trDate = (iso: string) =>
    new Date(iso).toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric" })
  const endsAt = trDate(notice.endsAt)
  const locksAt = trDate(notice.locksAt)

  // Geri sayım: "yarın" / "bugün" özel hâlleri, aksi halde gün sayısı.
  const inDays = (n: number) => (n <= 0 ? "bugün" : n === 1 ? "yarın" : `${n} gün sonra`)

  let headline: string
  let detail: string
  let tone: string
  let Icon = Clock
  let cta = "Aboneliği yenile"

  if (notice.kind === "grace") {
    Icon = CreditCard
    headline = `Ödemeniz alınamadı — erişiminiz ${inDays(notice.daysUntilLock)} kapanacak`
    detail = data?.canPurchase
      ? `Ödenmiş döneminiz ${endsAt} tarihinde doldu. Modülleriniz ${locksAt} tarihine kadar açık kalmaya devam ediyor; bu tarihe kadar ödeme alınamazsa kapanır. Verileriniz silinmez.`
      : `Ödenmiş dönem ${endsAt} tarihinde doldu. Modüller ${locksAt} tarihine kadar açık; ödeme yetkisi firma yöneticisindedir.`
    tone =
      "border-red-300 bg-red-50 text-red-900 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-100"
    cta = "Ödemeyi tamamla"
  } else if (notice.kind === "expired") {
    Icon = AlertTriangle
    headline = `Aboneliğiniz ${endsAt} tarihinde sona erdi`
    detail = data?.canPurchase
      ? "Satın aldığınız modüller kapandı. Verileriniz duruyor — yeni bir dönem başlattığınızda kaldığınız yerden devam edersiniz."
      : "Satın aldığınız modüller kapandı. Yenileme yetkisi firma yöneticisindedir; dilerseniz yöneticinizi bilgilendirin."
    tone =
      "border-red-300 bg-red-50 text-red-900 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-100"
  } else {
    headline =
      notice.daysLeft === 1
        ? "Aboneliğiniz yarın sona eriyor"
        : `Aboneliğiniz ${notice.daysLeft} gün sonra sona eriyor`
    detail = notice.cancelling
      ? `Aboneliğiniz iptal edildi; modülleriniz ${endsAt} tarihinde kapanacak.`
      : data?.canPurchase
        ? `Kesintisiz devam etmek için yenileyin. Ödeme alınamazsa modülleriniz ${locksAt} tarihinde kapanır.`
        : "Yenileme yetkisi firma yöneticisindedir; dilerseniz yöneticinizi bilgilendirin."
    tone =
      "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100"
  }

  return (
    <div
      className={`mb-4 flex flex-col gap-2 rounded-lg border p-3 text-sm sm:flex-row sm:items-center sm:justify-between ${tone}`}
    >
      <div className="flex items-start gap-2">
        <Icon className="mt-0.5 h-4 w-4 shrink-0" />
        <div>
          <p className="font-semibold">{headline}</p>
          <p className="mt-0.5 opacity-90">{detail}</p>
        </div>
      </div>

      {data?.canPurchase && (
        <CompanyLink
          href="/ayarlar/abonelik"
          className="shrink-0 self-start rounded-lg bg-kobipo-blue px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 sm:self-auto"
        >
          {cta}
        </CompanyLink>
      )}
    </div>
  )
}
